import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Download, Loader2, Search, X } from 'lucide-react';
import { factoredInvoiceRef } from '@constructpm/shared';
import { adminApi } from '../../lib/admin-api';
import { formatCurrency, formatDate, todayISO } from '../../lib/api';

/**
 * The advance ledger, as a table: every advance with its dates, amounts,
 * payment and reserve, filterable, sortable, totalled and downloadable.
 * Used for the whole book (Advances tab) and for one client's history.
 */

export interface AdvanceRow {
  id: string; company_id: string; company_name: string; invoice_number: string | null;
  debtor_name: string; job_number: string | null; job_name: string | null;
  face_amount: string; advance_rate_pct: string; advance_amount: string; reserve_amount: string;
  accrued_fee: string; status: string;
  advanced_on: string | null; invoice_due_on: string | null; collected_on: string | null; closed_on: string | null;
  amount_received: string | null; payment_memo: string | null; reserve_released: string | null;
  days_outstanding: number | null; recourse_on: string | null; notes: string | null;
  direct_payment_reported: boolean;
  /** V016: short payment by the agency, the reserve due back (reserve − fees − shortfall), and any balance the client owes. */
  shortfall: string; net_reserve: string; client_owes: string;
}

const STATUS: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Pending', badge: 'badge-gray' },
  advanced: { label: 'Outstanding', badge: 'badge-blue' },
  collected: { label: 'Paid · reserve held', badge: 'badge-yellow' },
  closed: { label: 'Closed', badge: 'badge-green' },
  charged_back: { label: 'Charged back', badge: 'badge-red' },
};

/** Invoice # stays in view while the other columns scroll sideways. */
const PINNED = 'sticky left-0 z-10 bg-inherit shadow-[inset_-1px_0_0_#e2e8f0]';

const day = (d: string | null) => (d ? d.slice(0, 10) : '');
const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? 0 : Number(v));
/** "Check #1234" → "1234"; anything else is shown as written. */
const checkRef = (memo: string | null) => (memo ? memo.replace(/^check\s*#\s*/i, '') : '');
const jobLabel = (r: AdvanceRow) => [r.job_number, r.job_name && r.job_name !== r.job_number ? r.job_name : null].filter(Boolean).join(' · ');
const daysToRecourse = (r: AdvanceRow) => {
  if (r.status !== 'advanced' || !r.recourse_on) return null;
  return Math.round((Date.parse(day(r.recourse_on)) - Date.parse(todayISO())) / 86400000);
};

type SortKey = 'company_name' | 'invoice' | 'debtor_name' | 'job' | 'advanced_on' | 'invoice_due_on' | 'face_amount'
  | 'advance_amount' | 'accrued_fee' | 'collected_on' | 'amount_received' | 'days_outstanding' | 'closed_on' | 'status';

const sortValue = (r: AdvanceRow, k: SortKey): string | number => {
  switch (k) {
    case 'invoice': return factoredInvoiceRef({ id: r.id, invoice_number: r.invoice_number }).toLowerCase();
    case 'job': return jobLabel(r).toLowerCase();
    case 'face_amount': case 'advance_amount': case 'accrued_fee': case 'amount_received': return num(r[k]);
    case 'days_outstanding': return r.days_outstanding ?? -1;
    case 'company_name': case 'debtor_name': case 'status': return String(r[k] ?? '').toLowerCase();
    default: return day(r[k]);
  }
};

export function AdvancesTable({ companyId, hideClient = false }: { companyId?: string; hideClient?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<AdvanceRow[]>({
    queryKey: ['admin-invoices', companyId ?? 'all'],
    queryFn: () => adminApi.get(`/invoices${companyId ? `?company_id=${companyId}` : ''}`).then((r) => r.data.data),
  });
  const rows = data ?? [];

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [client, setClient] = useState('');
  const [agency, setAgency] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'advanced_on', dir: -1 });
  const [acting, setActing] = useState<{ id: string; kind: 'collect' | 'close' } | null>(null);

  const clients = useMemo(() => [...new Set(rows.map((r) => r.company_name))].sort(), [rows]);
  const agencies = useMemo(() => [...new Set(rows.map((r) => r.debtor_name))].sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) =>
      (!status || r.status === status)
      && (!client || r.company_name === client)
      && (!agency || r.debtor_name === agency)
      && (!from || day(r.advanced_on) >= from)
      && (!to || (day(r.advanced_on) && day(r.advanced_on) <= to))
      && (!needle || [factoredInvoiceRef({ id: r.id, invoice_number: r.invoice_number }), r.company_name, r.debtor_name,
                      jobLabel(r), r.payment_memo ?? '', r.notes ?? ''].some((s) => s.toLowerCase().includes(needle))));
    return out.sort((a, b) => {
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, q, status, client, agency, from, to, sort]);

  const totals = useMemo(() => filtered.reduce((t, r) => ({
    face: t.face + num(r.face_amount), advance: t.advance + num(r.advance_amount), fees: t.fees + num(r.accrued_fee),
    received: t.received + num(r.amount_received), released: t.released + num(r.reserve_released),
  }), { face: 0, advance: 0, fees: 0, received: 0, released: 0 }), [filtered]);

  const filtering = Boolean(q || status || client || agency || from || to);
  const clear = () => { setQ(''); setStatus(''); setClient(''); setAgency(''); setFrom(''); setTo(''); };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-invoices'] });
    qc.invalidateQueries({ queryKey: ['admin-clients'] });
    qc.invalidateQueries({ queryKey: ['admin-client-history'] });
  };

  const header = (k: SortKey, label: string, right = false, pinned = false) => (
    <th className={`table-header ${right ? 'text-right' : ''} ${pinned ? PINNED : ''}`}>
      <button className={`inline-flex items-center gap-1 uppercase hover:text-slate-800 ${right ? 'flex-row-reverse' : ''}`}
              onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : (right || k.endsWith('_on') ? -1 : 1) }))}>
        {label}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );
  const colCount = hideClient ? 15 : 16;

  return (
    <div className="space-y-3">
      <div className="card p-3 flex flex-col lg:flex-row lg:flex-wrap lg:items-end gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input className="input pl-9" placeholder="Search invoice #, client, agency, check #, notes" value={q}
                 onChange={(e) => setQ(e.target.value)} aria-label="Search advances" />
        </div>
        <select className="input lg:w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
        {!hideClient && (
          <select className="input lg:w-56" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select className="input lg:w-56" value={agency} onChange={(e) => setAgency(e.target.value)} aria-label="Agency">
          <option value="">All agencies</option>
          {agencies.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex items-end gap-2">
          <label className="text-xs text-slate-500">Advanced from
            <input type="date" className="input mt-0.5" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">to
            <input type="date" className="input mt-0.5" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="flex gap-2">
          {filtering && <button className="btn-ghost" onClick={clear}><X className="w-4 h-4" /> Clear</button>}
          <button className="btn-secondary" disabled={!filtered.length}
                  onClick={() => downloadCsv(filtered, hideClient ? filtered[0]?.company_name : undefined)}>
            <Download className="w-4 h-4" /> Download CSV
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 px-1">
        {isLoading ? 'Loading…' : `${filtered.length === rows.length ? `${rows.length}` : `${filtered.length} of ${rows.length}`} advance${rows.length === 1 ? '' : 's'}`}
        {' · '}Click a column heading to sort.
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[96rem] text-sm">
          <thead className="border-b border-slate-200">
            <tr className="bg-slate-50">
              {header('invoice', 'Invoice #', false, true)}
              {!hideClient && header('company_name', 'Client')}
              {header('debtor_name', 'Agency')}
              {header('job', 'Job / contract')}
              {header('advanced_on', 'Advanced')}
              {header('invoice_due_on', 'Due')}
              {header('face_amount', 'Invoice amt', true)}
              {header('advance_amount', 'Advance', true)}
              {header('accrued_fee', 'Fees', true)}
              {header('collected_on', 'Paid on')}
              {header('amount_received', 'Received', true)}
              <th className="table-header">Check #</th>
              {header('days_outstanding', 'Days', true)}
              {header('closed_on', 'Reserve released')}
              {header('status', 'Status')}
              <th className="table-header">Notes</th>
              <th className="table-header"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={colCount + 1} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={colCount + 1} className="px-4 py-12 text-center text-slate-500">
                {rows.length ? 'No advances match these filters' : 'No advances yet'}
              </td></tr>
            )}
            {filtered.map((r) => {
              const toRecourse = daysToRecourse(r);
              const short = r.amount_received !== null && num(r.amount_received) < num(r.face_amount) - 0.005;
              return (
                <Fragment key={r.id}>
                  <tr className="bg-white hover:bg-slate-50 align-top">
                    <td className={`table-cell font-mono font-medium ${PINNED}`}>{factoredInvoiceRef({ id: r.id, invoice_number: r.invoice_number })}</td>
                    {!hideClient && <td className="table-cell">{r.company_name}</td>}
                    <td className="table-cell">{r.debtor_name}</td>
                    <td className="table-cell text-slate-600 max-w-[12rem] truncate" title={jobLabel(r) || undefined}>
                      {r.job_number ?? r.job_name ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="table-cell tabular-nums">{r.advanced_on ? formatDate(r.advanced_on) : '—'}</td>
                    <td className="table-cell tabular-nums text-slate-600">{r.invoice_due_on ? formatDate(r.invoice_due_on) : '—'}</td>
                    <td className="table-cell text-right tabular-nums">{formatCurrency(r.face_amount)}</td>
                    <td className="table-cell text-right tabular-nums">{formatCurrency(r.advance_amount)}</td>
                    <td className="table-cell text-right tabular-nums">
                      {formatCurrency(r.accrued_fee)}
                      {r.status === 'advanced' && <span className="block text-[11px] text-slate-400">accruing</span>}
                    </td>
                    <td className="table-cell tabular-nums">{r.collected_on ? formatDate(r.collected_on) : <span className="text-slate-300">—</span>}</td>
                    <td className="table-cell text-right tabular-nums">
                      {r.amount_received !== null ? formatCurrency(r.amount_received) : <span className="text-slate-300">—</span>}
                      {short && <span className="block text-[11px] text-orange-600">short {formatCurrency(num(r.face_amount) - num(r.amount_received))}</span>}
                    </td>
                    <td className="table-cell font-mono text-slate-600">{checkRef(r.payment_memo) || <span className="text-slate-300">—</span>}</td>
                    <td className="table-cell text-right tabular-nums">
                      {r.days_outstanding ?? '—'}
                      {toRecourse !== null && toRecourse <= 14 && (
                        <span className={`block text-[11px] ${toRecourse < 0 ? 'text-red-600 font-medium' : 'text-orange-600'}`}>
                          {toRecourse < 0 ? `${-toRecourse}d past recourse` : `recourse in ${toRecourse}d`}
                        </span>
                      )}
                    </td>
                    <td className="table-cell tabular-nums">
                      {r.closed_on ? (
                        <>
                          {formatDate(r.closed_on)}
                          {r.reserve_released !== null && <span className="block text-[11px] text-slate-500">{formatCurrency(r.reserve_released)} to client</span>}
                        </>
                      ) : r.status === 'collected' ? (
                        <span className="text-[11px] text-slate-500">
                          {formatCurrency(r.net_reserve)} due to client
                          {num(r.client_owes) > 0 && <span className="block text-red-600">client owes {formatCurrency(r.client_owes)}</span>}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="table-cell">
                      <span className={STATUS[r.status]?.badge ?? 'badge-gray'}>{STATUS[r.status]?.label ?? r.status}</span>
                      {r.direct_payment_reported && ['pending', 'advanced'].includes(r.status) && (
                        <span className="badge-orange block mt-1 w-max" title="The client reports the agency paid them directly">client paid directly</span>
                      )}
                    </td>
                    <td className="table-cell-wrap text-slate-600 max-w-[16rem]">
                      {r.notes ? <span className="line-clamp-2" title={r.notes}>{r.notes}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="table-cell text-right">
                      {r.status === 'advanced' && (
                        <button className="btn-secondary btn-sm" onClick={() => setActing({ id: r.id, kind: 'collect' })}>Mark paid</button>
                      )}
                      {r.status === 'collected' && (
                        <button className="btn-secondary btn-sm" onClick={() => setActing({ id: r.id, kind: 'close' })}>Release reserve</button>
                      )}
                    </td>
                  </tr>
                  {acting?.id === r.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={colCount + 1} className="px-4 py-3">
                        {/* Pinned to the visible part of the table, so the buttons
                            aren't off to the right when the table is wide. */}
                        <div className="sticky left-4 w-[min(60rem,calc(100vw-6rem))]">
                          {acting.kind === 'collect'
                            ? <CollectForm row={r} onDone={() => { setActing(null); refresh(); }} onCancel={() => setActing(null)} />
                            : <CloseForm row={r} onDone={() => { setActing(null); refresh(); }} onCancel={() => setActing(null)} />}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 font-semibold">
              <tr className="bg-slate-50">
                <td className={`table-cell ${PINNED}`}>Total</td>
                <td className="table-cell font-normal text-slate-600" colSpan={hideClient ? 4 : 5}>
                  {filtered.length} advance{filtered.length === 1 ? '' : 's'}{filtering ? ' (filtered)' : ''}
                </td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(totals.face)}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(totals.advance)}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(totals.fees)}</td>
                <td className="table-cell" />
                <td className="table-cell text-right tabular-nums">{formatCurrency(totals.received)}</td>
                <td className="table-cell" colSpan={2} />
                <td className="table-cell tabular-nums text-slate-600 font-normal">{formatCurrency(totals.released)} released</td>
                <td className="table-cell" colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

type ErrorLike = { response?: { data?: { message?: string } } };
const errMsg = (e: unknown, fallback: string) => (e as ErrorLike).response?.data?.message ?? fallback;

/** Record the agency's payment: when, how much, and the check or reference. */
function CollectForm({ row, onDone, onCancel }: { row: AdvanceRow; onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(String(num(row.face_amount)));
  const [check, setCheck] = useState('');
  const save = useMutation({
    mutationFn: () => adminApi.post(`/invoices/${row.id}/collect`, {
      collected_on: date, amount: Number(amount.replace(/[$,\s]/g, '')),
      memo: check.trim() ? (/^\d[\w-]*$/.test(check.trim()) ? `Check #${check.trim()}` : check.trim()) : null,
    }),
    onSuccess: () => { toast.success('Payment recorded'); onDone(); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t record the payment')),
  });
  const amt = Number(amount.replace(/[$,\s]/g, ''));
  return (
    <form className="flex flex-col md:flex-row md:items-end gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="text-sm font-medium text-slate-800 md:self-center">Record the agency’s payment</p>
      <label className="text-xs text-slate-600">Paid on
        <input type="date" className="input mt-0.5" value={date} onChange={(e) => setDate(e.target.value)} required
               min={day(row.advanced_on) || undefined} max={todayISO()} />
      </label>
      <label className="text-xs text-slate-600">Amount received
        <input className="input mt-0.5 w-40" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </label>
      <label className="text-xs text-slate-600">Check # or reference
        <input className="input mt-0.5 w-44" value={check} onChange={(e) => setCheck(e.target.value)} maxLength={100} placeholder="e.g. 40121 or ACH 0915" />
      </label>
      {Number.isFinite(amt) && amt > 0 && amt < num(row.face_amount) - 0.005 && (
        <p className="text-xs text-orange-700 md:self-center">{formatCurrency(num(row.face_amount) - amt)} short of the invoice amount</p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" disabled={save.isPending || !(amt > 0)}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save</button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Release the reserve to the client: the reserve less fees and less any short
 * payment. A different amount needs a reason, which goes on the ledger.
 */
function CloseForm({ row, onDone, onCancel }: { row: AdvanceRow; onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState(String(num(row.net_reserve)));
  const [reason, setReason] = useState('');
  const net = num(row.net_reserve);
  const shortfall = num(row.shortfall);
  const owes = num(row.client_owes);
  const amt = Number(amount.replace(/[$,\s]/g, ''));
  const save = useMutation({
    mutationFn: () => adminApi.post(`/invoices/${row.id}/close`, {
      closed_on: date,
      ...(override ? { release_amount: amt, override_reason: reason.trim() } : {}),
    }),
    onSuccess: () => { toast.success('Reserve released'); onDone(); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t release the reserve')),
  });
  const invalid = override && (!Number.isFinite(amt) || amt < 0 || amt > num(row.reserve_amount) || reason.trim().length < 3);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="text-sm text-slate-800">
        <p className="font-medium">Release the reserve</p>
        <p className="tabular-nums text-slate-600 mt-0.5">
          Reserve {formatCurrency(row.reserve_amount)} − fees {formatCurrency(row.accrued_fee)}
          {shortfall > 0 && <> − <span className="text-orange-700">short payment {formatCurrency(shortfall)}</span></>}
          {' '}= <strong className="text-slate-900">{formatCurrency(net)}</strong> to the client
        </p>
        {owes > 0 && (
          <p className="text-red-700 mt-0.5">
            Fees and the short payment exceed the reserve: the client owes One Source {formatCurrency(owes)}.
          </p>
        )}
      </div>
      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <label className="text-xs text-slate-600">Released on
          <input type="date" className="input mt-0.5" value={date} onChange={(e) => setDate(e.target.value)} required
                 min={day(row.collected_on) || undefined} max={todayISO()} />
        </label>
        {override && (
          <>
            <label className="text-xs text-slate-600">Amount to release
              <input className="input mt-0.5 w-40" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            <label className="text-xs text-slate-600 flex-1 min-w-[14rem] max-w-md">Why a different amount? (recorded)
              <input className="input mt-0.5" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500}
                     placeholder="e.g. Agency withheld for its own error; reissuing" />
            </label>
          </>
        )}
        <div className="flex gap-2">
          <button className="btn-primary btn-sm" disabled={save.isPending || invalid}>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Release {formatCurrency(override && Number.isFinite(amt) ? amt : net)}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
      <button type="button" className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
              onClick={() => { setOverride((v) => !v); setAmount(String(net)); setReason(''); }}>
        {override ? 'Release the calculated amount instead' : 'Release a different amount…'}
      </button>
    </form>
  );
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function downloadCsv(rows: AdvanceRow[], clientName?: string) {
  const cols: [string, (r: AdvanceRow) => string | number][] = [
    ['Client', (r) => r.company_name],
    ['Invoice #', (r) => factoredInvoiceRef({ id: r.id, invoice_number: r.invoice_number })],
    ['Agency', (r) => r.debtor_name],
    ['Job #', (r) => r.job_number ?? ''],
    ['Job name', (r) => r.job_name ?? ''],
    ['Advance date', (r) => day(r.advanced_on)],
    ['Due date', (r) => day(r.invoice_due_on)],
    ['Invoice amount', (r) => num(r.face_amount).toFixed(2)],
    ['Advance rate %', (r) => num(r.advance_rate_pct)],
    ['Advance', (r) => num(r.advance_amount).toFixed(2)],
    ['Reserve', (r) => num(r.reserve_amount).toFixed(2)],
    ['Fees', (r) => num(r.accrued_fee).toFixed(2)],
    ['Paid on', (r) => day(r.collected_on)],
    ['Amount received', (r) => (r.amount_received === null ? '' : num(r.amount_received).toFixed(2))],
    ['Check # / reference', (r) => checkRef(r.payment_memo)],
    ['Days outstanding', (r) => r.days_outstanding ?? ''],
    ['Recourse date', (r) => day(r.recourse_on)],
    ['Reserve released on', (r) => day(r.closed_on)],
    ['Short payment', (r) => (num(r.shortfall) > 0 ? num(r.shortfall).toFixed(2) : '')],
    ['Reserve released amount', (r) => (r.reserve_released === null ? '' : num(r.reserve_released).toFixed(2))],
    ['Reserve due to client', (r) => (r.status === 'collected' ? num(r.net_reserve).toFixed(2) : '')],
    ['Client owes', (r) => (num(r.client_owes) > 0 && ['collected', 'closed'].includes(r.status) ? num(r.client_owes).toFixed(2) : '')],
    ['Status', (r) => STATUS[r.status]?.label ?? r.status],
    ['Client reports paid directly', (r) => (r.direct_payment_reported ? 'Yes' : '')],
    ['Notes', (r) => r.notes ?? ''],
  ];
  const cell = (v: string | number) => {
    const s = String(v);
    // Quote, and neutralise leading = + - @ so a spreadsheet never runs a cell as a formula.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [cols.map(([h]) => h), ...rows.map((r) => cols.map(([, f]) => f(r)))]
    .map((line) => line.map(cell).join(',')).join('\r\n');
  // BOM so Excel reads the file as UTF-8 (agency names have dashes and accents).
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = clientName ? `${clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-` : '';
  a.href = url; a.download = `advances-${slug}${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
