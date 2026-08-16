import type pg from 'pg';
import { adminPool, withAdminTransaction } from '../../lib/admin-db.js';
import { logger } from '../../middleware/index.js';
import {
  underwrite, isPlaceholderInvoiceNumber,
  type UnderwritingInputs, type UnderwritingPolicy, type UnderwritingDecision,
} from './underwriting.js';

/**
 * Gathers underwriting inputs and records decisions.
 *
 * Everything here runs on the operator pool, because underwriting is inherently
 * cross-tenant: a client's exposure, an agency's payment record and the open
 * book's concentration are all facts spanning companies. The tenant-facing
 * request handler never touches this pool — it triggers scoring and moves on.
 */

export async function loadPolicy(client: pg.PoolClient): Promise<UnderwritingPolicy> {
  const r = await client.query(
    `SELECT * FROM underwriting_policy ORDER BY version DESC LIMIT 1`);
  const p = r.rows[0];
  if (!p) throw new Error('no underwriting policy is configured');
  const num = (v: unknown) => Number(v);
  return {
    version: num(p['version']),
    auto_approve_enabled: Boolean(p['auto_approve_enabled']),
    auto_approve_ceiling: num(p['auto_approve_ceiling']),
    clean_score: num(p['clean_score']),
    decline_score: num(p['decline_score']),
    starting_limit: num(p['starting_limit']),
    limit_step: num(p['limit_step']),
    max_limit: num(p['max_limit']),
    on_time_days: num(p['on_time_days']),
    impairment_days: num(p['impairment_days']),
    default_advance_rate_pct: num(p['default_advance_rate_pct']),
    min_advance_rate_pct: num(p['min_advance_rate_pct']),
    max_advance_rate_pct: num(p['max_advance_rate_pct']),
    large_invoice_threshold: num(p['large_invoice_threshold']),
    step_up_multiple: num(p['step_up_multiple']),
    debtor_concentration_pct: num(p['debtor_concentration_pct']),
  };
}

interface RequestRow {
  id: string;
  company_id: string;
  invoice_id: string | null;
  requested_amount: string;
  invoice_number: string | null;
  customer_name: string | null;
  debtor_id: string | null;
}

/**
 * Builds the input snapshot for one funding request.
 *
 * Written as a handful of small aggregate queries rather than one join, because
 * each answers a question an operator will also ask directly ("how does this
 * agency pay?", "how much is out with this client?") and the shapes are reused
 * by the console.
 */
export async function gatherInputs(
  client: pg.PoolClient,
  request: RequestRow,
  policy: UnderwritingPolicy,
): Promise<UnderwritingInputs> {
  const amount = Number(request.requested_amount);

  // ── Client standing ──────────────────────────────────────────────────────
  const fc = await client.query(
    `SELECT status, negative_list, credit_limit,
            tax_lien_personal, tax_lien_business, judgement, lawsuit,
            existing_ucc, ucc_is_prior_factor, personal_guarantee,
            uses_subs, does_progress_billing
       FROM factoring_clients WHERE company_id = $1`, [request.company_id]);
  const c = fc.rows[0];

  // Settled = collected or closed. Late is measured against the same on-time
  // window the exposure limit uses, so "earning headroom" and "scoring well"
  // mean the same thing rather than two subtly different rules.
  const hist = await client.query<{
    on_time: string; late: string; impaired: string; open_exposure: string; median_face: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE status IN ('collected','closed')
           AND COALESCE(collected_on, closed_on) - advanced_on <= $2) AS on_time,
       COUNT(*) FILTER (
         WHERE status IN ('collected','closed')
           AND COALESCE(collected_on, closed_on) - advanced_on > $2) AS late,
       COUNT(*) FILTER (
         WHERE status IN ('pending','advanced')
           AND advanced_on IS NOT NULL
           AND CURRENT_DATE - advanced_on > $3) AS impaired,
       COALESCE(SUM(advance_amount) FILTER (WHERE status IN ('pending','advanced')), 0) AS open_exposure,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY face_amount) AS median_face
     FROM factored_invoices
     WHERE company_id = $1 AND status <> 'charged_back'`,
    [request.company_id, policy.on_time_days, policy.impairment_days]);
  const h = hist.rows[0]!;

  // Charged-back advances are excluded from the aggregate above so they cannot
  // flatter a median, but they are unambiguously a late outcome.
  const cb = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM factored_invoices
      WHERE company_id = $1 AND status = 'charged_back'`, [request.company_id]);

  const dupe = request.invoice_number
    ? await client.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM factored_invoices
          WHERE company_id = $1 AND LOWER(BTRIM(invoice_number)) = LOWER(BTRIM($2))
            AND status IN ('pending','advanced')`, [request.company_id, request.invoice_number])
    : { rows: [{ n: '0' }] };

  // ── Debtor standing ──────────────────────────────────────────────────────
  // Operator-entered requests name the debtor directly. In-app ones carry only
  // the invoice's customer name, so match on it; an unmatched name scores as an
  // unknown agency rather than silently inheriting someone else's good record.
  const debtorRow = request.debtor_id
    ? await client.query(`SELECT * FROM factoring_debtors WHERE id = $1`, [request.debtor_id])
    : request.customer_name
      ? await client.query(
          `SELECT * FROM factoring_debtors
            WHERE LOWER(BTRIM(legal_name)) = LOWER(BTRIM($1))
               OR LOWER(BTRIM(COALESCE(dba,''))) = LOWER(BTRIM($1))
            LIMIT 1`, [request.customer_name])
      : { rows: [] as Record<string, unknown>[] };
  const d = debtorRow.rows[0];

  let debtorStats = { settled: 0, median_dso: null as number | null, impaired: 0, open: 0 };
  if (d) {
    const ds = await client.query<{ settled: string; median_dso: string | null; impaired: string; open: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('collected','closed')) AS settled,
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY COALESCE(collected_on, closed_on) - advanced_on)
           FILTER (WHERE status IN ('collected','closed')) AS median_dso,
         COUNT(*) FILTER (
           WHERE status IN ('pending','advanced') AND advanced_on IS NOT NULL
             AND CURRENT_DATE - advanced_on > $2) AS impaired,
         COALESCE(SUM(advance_amount) FILTER (WHERE status IN ('pending','advanced')), 0) AS open
       FROM factored_invoices WHERE debtor_id = $1`,
      [d['id'], policy.impairment_days]);
    const s = ds.rows[0]!;
    debtorStats = {
      settled: Number(s.settled),
      median_dso: s.median_dso === null ? null : Number(s.median_dso),
      impaired: Number(s.impaired),
      open: Number(s.open),
    };
  }

  const book = await client.query<{ open: string }>(
    `SELECT COALESCE(SUM(advance_amount), 0) AS open FROM factored_invoices
      WHERE status IN ('pending','advanced')`);
  const bookOpen = Number(book.rows[0]!.open);

  // ── Agency slowdown ──────────────────────────────────────────────────────
  // An agency counts as slow when its open advances are running materially older
  // than its own settled history AND it is happening across more than one client.
  // Both conditions matter: the multi-client test is what separates "this agency
  // has slowed" from "this one contractor's invoices are not getting paid", and
  // measuring against the agency's own history rather than a fixed number means
  // a habitually slow agency is not permanently flagged.
  const SLOWDOWN = `
    SELECT fi.debtor_id,
           COUNT(DISTINCT fi.company_id) FILTER (WHERE fi.status IN ('pending','advanced')) AS open_clients,
           (
             COUNT(*) FILTER (WHERE fi.status IN ('pending','advanced')) >= 3
             AND COUNT(DISTINCT fi.company_id) FILTER (WHERE fi.status IN ('pending','advanced')) >= 2
             AND PERCENTILE_CONT(0.5) WITHIN GROUP (
                   ORDER BY COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on)
                   FILTER (WHERE fi.status IN ('collected','closed')) IS NOT NULL
             AND PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CURRENT_DATE - fi.advanced_on)
                   FILTER (WHERE fi.status IN ('pending','advanced') AND fi.advanced_on IS NOT NULL)
                 > GREATEST(
                     PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on)
                       FILTER (WHERE fi.status IN ('collected','closed')) * 1.5,
                     PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY COALESCE(fi.collected_on, fi.closed_on) - fi.advanced_on)
                       FILTER (WHERE fi.status IN ('collected','closed')) + 15)
           ) AS in_slowdown
      FROM factored_invoices fi
     GROUP BY fi.debtor_id`;

  const slow = d
    ? await client.query<{ in_slowdown: boolean; open_clients: string }>(
        `WITH s AS (${SLOWDOWN}) SELECT in_slowdown, open_clients FROM s WHERE debtor_id = $1`, [d['id']])
    : { rows: [] as { in_slowdown: boolean; open_clients: string }[] };

  // How many of this client's impaired advances are explained by a slow agency.
  const impairedSlow = await client.query<{ n: string }>(
    `WITH s AS (${SLOWDOWN})
     SELECT COUNT(*) AS n
       FROM factored_invoices fi
       JOIN s ON s.debtor_id = fi.debtor_id
      WHERE fi.company_id = $1
        AND fi.status IN ('pending','advanced')
        AND fi.advanced_on IS NOT NULL
        AND CURRENT_DATE - fi.advanced_on > $2
        AND s.in_slowdown`, [request.company_id, policy.impairment_days]);

  const docs = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM file_attachments
      WHERE entity_type = 'funding_request' AND entity_id = $1`, [request.id]);

  const screening = (v: unknown) => (v === 'clean' || v === 'present' ? v : 'unknown') as
    'unknown' | 'clean' | 'present';
  const confirmation = (v: unknown) =>
    (v === 'confirmed' || v === 'purchase_order' ? v : 'none') as 'none' | 'confirmed' | 'purchase_order';

  return {
    request: {
      requested_amount: amount,
      invoice_number: request.invoice_number,
      has_document: Number(docs.rows[0]!.n) > 0,
    },
    client: {
      status: (c?.['status'] as string) ?? 'prospect',
      negative_list: Boolean(c?.['negative_list']),
      credit_limit_override: c?.['credit_limit'] === null || c?.['credit_limit'] === undefined
        ? null : Number(c['credit_limit']),
      tax_lien_personal: screening(c?.['tax_lien_personal']),
      tax_lien_business: screening(c?.['tax_lien_business']),
      judgement: screening(c?.['judgement']),
      lawsuit: screening(c?.['lawsuit']),
      existing_ucc: screening(c?.['existing_ucc']),
      ucc_is_prior_factor: Boolean(c?.['ucc_is_prior_factor']),
      personal_guarantee: Boolean(c?.['personal_guarantee']),
      uses_subs: c?.['uses_subs'] === null || c?.['uses_subs'] === undefined
        ? null : Boolean(c['uses_subs']),
      does_progress_billing: c?.['does_progress_billing'] === null || c?.['does_progress_billing'] === undefined
        ? null : Boolean(c['does_progress_billing']),
      settled_on_time: Number(h.on_time),
      settled_late: Number(h.late) + Number(cb.rows[0]!.n),
      impaired_count: Number(h.impaired),
      impaired_in_slow_agencies: Number(impairedSlow.rows[0]!.n),
      open_exposure: Number(h.open_exposure),
      trailing_median_invoice: h.median_face === null ? null : Number(h.median_face),
      duplicate_open_invoice: Number(dupe.rows[0]!.n) > 0,
    },
    debtor: {
      known: Boolean(d),
      portal_visibility: Boolean(d?.['portal_visibility']),
      invoice_confirmation: confirmation(d?.['invoice_confirmation']),
      ach_change: Boolean(d?.['ach_change']),
      staff_communication: Boolean(d?.['staff_communication']),
      settled_count: debtorStats.settled,
      median_dso: debtorStats.median_dso,
      impaired_count: debtorStats.impaired,
      share_of_open_book_pct: bookOpen > 0 ? (debtorStats.open / bookOpen) * 100 : 0,
      in_slowdown: Boolean(slow.rows[0]?.in_slowdown),
      slowdown_clients_affected: Number(slow.rows[0]?.open_clients ?? 0),
    },
  };
}

/** Scores a request and records the decision. Returns null when factoring is not configured. */
export async function scoreRequest(requestId: string): Promise<UnderwritingDecision | null> {
  if (!adminPool) return null;

  return withAdminTransaction(async (client) => {
    const rr = await client.query<RequestRow>(
      `SELECT id, company_id, invoice_id, requested_amount, invoice_number, customer_name, debtor_id
         FROM funding_requests WHERE id = $1`, [requestId]);
    const request = rr.rows[0];
    if (!request) return null;

    const policy = await loadPolicy(client);
    const inputs = await gatherInputs(client, request, policy);
    const decision = underwrite(inputs, policy);

    await client.query(
      `INSERT INTO underwriting_decisions
         (funding_request_id, company_id, policy_version, score, action, auto_applied,
          hard_stops, referrals, factors, inputs, recommended_advance_rate_pct,
          exposure_limit, exposure_current, exposure_headroom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [request.id, request.company_id, policy.version, decision.score, decision.action,
       decision.auto_applied, JSON.stringify(decision.hard_stops), JSON.stringify(decision.referrals),
       JSON.stringify(decision.factors),
       JSON.stringify(inputs), decision.recommended_advance_rate_pct,
       decision.exposure_limit, decision.exposure_current, decision.exposure_headroom]);

    // Auto-approval is off by default; when enabled the engine advances the
    // request itself and the operator sees a decided request rather than a queue
    // item. The audit row is written by the caller that funds it.
    if (decision.auto_applied) {
      await client.query(
        `UPDATE funding_requests SET status = 'approved', reviewed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'submitted'`, [request.id]);
    }

    return decision;
  });
}

/**
 * Fire-and-forget scoring for the tenant request path.
 *
 * The request is already durably committed by the time this runs, so a failure
 * here must not surface to the client — same contract as the outbound mailer.
 * An unscored request simply appears in the operator queue without a
 * recommendation, and can be re-scored from the console.
 */
export function scoreRequestInBackground(requestId: string): void {
  void scoreRequest(requestId).catch((err) => {
    logger.error({ err, requestId }, 'underwriting scoring failed');
  });
}

export { isPlaceholderInvoiceNumber };
