import type pg from 'pg';
import type { AdvanceRowPayload } from './import-map.js';
import {
  bestNameMatch, matchAdvance, normalizeInvoice, normalizeName, similarity, type ExistingAdvance,
} from './import-match.js';

/**
 * Plans an Advance Book import against the book as it stands: for each row,
 * which client and agency it belongs to, and whether it creates a new advance,
 * updates an existing one (and what changes), or changes nothing.
 *
 * The same plan drives the preview (dry run) and the apply, so what the
 * operator approves is what happens. Blank cells never erase: a value in the
 * sheet replaces what's recorded, an empty one leaves it alone.
 */

export interface BookAdvance extends ExistingAdvance {
  company_id: string;
  debtor_id: string;
  status: string;
  collected_on: string | null;
  closed_on: string | null;
  notes: string | null;
  advance_rate_pct: number;
  received: number | null;
  payment_memo: string | null;
}

export interface Change { field: string; label: string; from: string; to: string }

export interface PlanItem {
  row: number;
  payload: AdvanceRowPayload;
  client: { id: string; company_id: string; name: string };
  debtor: { id: string | null; name: string };
  action: 'create' | 'update' | 'unchanged';
  existing: BookAdvance | null;
  changes: Change[];
  warnings: string[];
}

interface ClientRow { id: string; company_id: string; name: string }
interface DebtorRow { id: string; legal_name: string; dba: string | null }

const money = (n: number | null) => (n === null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const checkMemo = (check: string | null) => (check ? `Check #${check}` : null);

export async function planImport(
  c: pg.PoolClient,
  rows: { row: number; payload: AdvanceRowPayload }[],
): Promise<{ items: PlanItem[]; errors: { row: number; message: string }[] }> {
  const [clients, debtors] = await Promise.all([
    c.query<ClientRow>(`SELECT fc.id, fc.company_id, co.name FROM factoring_clients fc JOIN companies co ON co.id = fc.company_id`),
    c.query<DebtorRow>(`SELECT id, legal_name, dba FROM factoring_debtors`),
  ]);
  const books = new Map<string, BookAdvance[]>();
  const loadBook = async (companyId: string) => {
    const hit = books.get(companyId);
    if (hit) return hit;
    const r = await c.query(
      `SELECT fi.id, fi.company_id, fi.invoice_number, fi.advanced_on::text AS advanced_on, fi.face_amount::float AS face_amount,
              fi.debtor_id, fi.debtor_name, fi.status, fi.collected_on::text AS collected_on, fi.closed_on::text AS closed_on,
              fi.notes, fi.advance_rate_pct::float AS advance_rate_pct,
              (SELECT SUM(fe.amount)::float FROM factoring_events fe
                WHERE fe.factored_invoice_id = fi.id AND fe.event_type = 'payment_received') AS received,
              (SELECT string_agg(fe.memo, '; ' ORDER BY fe.occurred_on) FROM factoring_events fe
                WHERE fe.factored_invoice_id = fi.id AND fe.event_type = 'payment_received') AS payment_memo
         FROM factored_invoices fi WHERE fi.company_id = $1 AND fi.advanced_on IS NOT NULL`, [companyId]);
    books.set(companyId, r.rows as BookAdvance[]);
    return r.rows as BookAdvance[];
  };

  const items: PlanItem[] = [];
  const errors: { row: number; message: string }[] = [];
  const claimed = new Map<string, number>();     // existing advance id → row that updates it
  const newKeys = new Map<string, number>();     // a new advance's identity → row that creates it

  for (const { row, payload } of rows) {
    const warnings: string[] = [];

    // Client: must already be set up (fee schedule, limit) — never created here.
    const cm = bestNameMatch(payload.borrower, clients.rows, (x) => [x.name], 0.88);
    if (!cm) {
      const near = bestNameMatch(payload.borrower, clients.rows, (x) => [x.name], 0.6);
      errors.push({ row, message: `Borrower "${payload.borrower}" isn't a set-up client${near ? ` (closest: ${near.item.name})` : ''}` });
      continue;
    }
    if (!cm.exact) warnings.push(`Borrower "${payload.borrower}" matched to client ${cm.item.name}`);
    const client = cm.item;

    // Agency: matched by name (legal name or DBA); a new one is created on apply.
    const dm = bestNameMatch(payload.creditor, debtors.rows, (x) => [x.legal_name, x.dba ?? ''], 0.88, 'agency');
    if (dm && !dm.exact) warnings.push(`Agency "${payload.creditor}" matched to ${dm.item.legal_name}`);
    let debtor: { id: string | null; name: string } =
      dm ? { id: dm.item.id, name: dm.item.legal_name } : { id: null, name: payload.creditor.trim() };

    if (payload.collection && payload.collection.collected_on < payload.advanced_on) {
      errors.push({ row, message: 'Date Paid Back is before Adv Date' });
      continue;
    }

    const book = await loadBook(client.company_id);
    const m = matchAdvance(
      { invoice_number: payload.invoice_number, advanced_on: payload.advanced_on, face_amount: payload.face_amount, creditor: payload.creditor },
      book);

    if (m.kind === 'ambiguous') {
      errors.push({ row, message: `Matches more than one advance for ${client.name} (${m.candidates
        .map((x) => `${x.invoice_number ?? 'no invoice #'} on ${x.advanced_on}`).join('; ')}) — fix the sheet or the book so it's clear which` });
      continue;
    }

    if (m.kind === 'none') {
      if (m.warning) warnings.push(m.warning);
      if (!debtor.id) warnings.push(`New agency "${debtor.name}" will be added`);
      const key = [client.company_id, normalizeInvoice(payload.invoice_number)
        ?? `${payload.advanced_on}|${payload.face_amount}|${normalizeName(payload.creditor)}`, payload.advanced_on].join('|');
      const dupOf = newKeys.get(key);
      if (dupOf) { errors.push({ row, message: `Same advance as row ${dupOf} — remove one` }); continue; }
      newKeys.set(key, row);
      items.push({ row, payload, client, debtor, action: 'create', existing: null, changes: [], warnings });
      continue;
    }

    const e = m.existing;
    const prior = claimed.get(e.id);
    if (prior) {
      errors.push({ row, message: `Same advance as row ${prior} (${e.invoice_number ?? 'no invoice #'}, ${e.advanced_on}) — remove one` });
      continue;
    }
    claimed.set(e.id, row);
    if (m.fuzzy) warnings.push(`Matched ${e.invoice_number ?? 'advance'} of ${e.advanced_on}: ${m.reason}`);

    // An agency name the book doesn't know, on an advance it already has:
    // if it looks like the advance's current agency written differently, keep
    // that agency rather than re-pointing the advance at a new one.
    if (!debtor.id) {
      const sim = similarity(normalizeName(payload.creditor, 'agency'), normalizeName(e.debtor_name, 'agency'));
      if (sim >= 0.7) {
        warnings.push(`Agency written as "${payload.creditor.trim()}" — kept ${e.debtor_name}`);
        debtor = { id: e.debtor_id, name: e.debtor_name };
      } else {
        warnings.push(`New agency "${debtor.name}" will be added, replacing ${e.debtor_name} on this advance`);
      }
    }

    const changes: Change[] = [];
    const add = (field: string, label: string, from: string, to: string) => changes.push({ field, label, from, to });
    if (payload.invoice_number && normalizeInvoice(payload.invoice_number) !== normalizeInvoice(e.invoice_number)) {
      add('invoice_number', 'Invoice #', e.invoice_number ?? '—', payload.invoice_number);
    }
    if (debtor.id !== e.debtor_id) add('debtor', 'Agency', e.debtor_name, debtor.name);
    if (Math.abs(payload.face_amount - e.face_amount) >= 0.005) {
      add('face_amount', 'Invoice amount', money(e.face_amount), money(payload.face_amount));
    }
    if (payload.advanced_on !== e.advanced_on) add('advanced_on', 'Advance date', e.advanced_on, payload.advanced_on);
    if (payload.notes && payload.notes !== (e.notes ?? '')) add('notes', 'Notes', e.notes ?? '—', payload.notes);
    const col = payload.collection;
    if (col) {
      if (col.collected_on !== e.collected_on) add('collected_on', 'Paid on', e.collected_on ?? '—', col.collected_on);
      if (e.received === null || Math.abs(col.amount_received - e.received) >= 0.005) {
        add('amount_received', 'Amount received', money(e.received), money(col.amount_received));
      }
      const memo = checkMemo(col.check_number);
      if (memo && memo !== e.payment_memo) add('check', 'Check #', e.payment_memo ?? '—', memo);
    }
    if (e.collected_on && !col && payload.advanced_on > e.collected_on) {
      errors.push({ row, message: `Adv Date ${payload.advanced_on} is after the recorded payment on ${e.collected_on}` });
      continue;
    }
    if (changes.length && e.status === 'closed' && changes.some((x) => ['face_amount', 'collected_on', 'amount_received'].includes(x.field))) {
      warnings.push(`Already closed — the reserve released on ${e.closed_on} stays as recorded`);
    }
    if (e.status === 'charged_back' && changes.length) warnings.push('This advance was charged back; only its details are updated');

    items.push({ row, payload, client, debtor, action: changes.length ? 'update' : 'unchanged', existing: e, changes, warnings });
  }

  return { items, errors };
}
