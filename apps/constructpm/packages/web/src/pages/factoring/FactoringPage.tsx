import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, PiggyBank, Clock, FileText, Plus, CheckCircle2, Zap, Download, Printer, Search, Table2, BarChart3,
} from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { api, apiError, formatCurrency, formatDate, todayISO } from '../../lib/api';
import { factoredInvoiceRef } from '@constructpm/shared';
import { FundingOnboardingForm } from '../../components/FundingOnboardingForm';
import { FUNDING_BADGE, FUNDING_LABEL, downloadAttachment } from '../../lib/invoices';
import { ADVANCE_MAX, ADVANCE_TYPICAL } from '../../lib/funding';
import { downloadCsv } from '../../lib/download';
import { useAuthStore } from '../../stores/auth.store';
import { InvoiceDrawer } from '../../components/invoices/InvoiceDrawer';
import { LogInvoiceModal } from '../../components/invoices/LogInvoiceModal';

/**
 * Funding — the extension of Invoices for a company that factors.
 *
 *   Overview         what's available, what's out, what's coming back, what needs attention
 *   Funded invoices  every advance, past and present; each opens its invoice
 *   Statements       a period's activity, as CSV or a printable statement
 *   Insights         volume and cost over time, and how each agency pays
 *
 * A company that doesn't factor sees "Get paid now" here instead.
 */

const STATUS: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Pending', badge: 'badge-gray' },
  advanced: { label: 'Funded', badge: 'badge-blue' },
  collected: { label: 'Agency paid', badge: 'badge-yellow' },
  closed: { label: 'Settled', badge: 'badge-green' },
  charged_back: { label: 'Charged back', badge: 'badge-red' },
};

type Tab = 'overview' | 'invoices' | 'statements' | 'insights';
const TABS: [Tab, string][] = [
  ['overview', 'Overview'], ['invoices', 'Funded invoices'], ['statements', 'Statements'], ['insights', 'Insights'],
];

interface Advance {
  id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  debtor_name: string;
  face_amount: string;
  advance_amount: string;
  reserve_amount: string;
  accrued_fee: string;
  net_expected: string | null;
  status: string;
  advanced_on: string | null;
  collected_on: string | null;
  days_outstanding: number | null;
  days_to_recourse: number | null;
}

interface Summary {
  enabled: boolean; status?: string;
  funding_limit?: number | null; funding_used?: number | null; funding_available?: number | null;
  advanced_outstanding?: string; outstanding_count?: string; reserve_held?: string; net_expected?: string;
  approaching_recourse?: string;
}

export function FactoringPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);

  const { data: summary, isLoading } = useQuery<Summary>({
    queryKey: ['factoring-summary'],
    queryFn: () => api.get('/factoring/summary').then((r) => r.data.data),
  });

  if (isLoading) {
    return (
      <div className="page max-w-7xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/3" />
          <div className="h-24 bg-slate-200 rounded" />
        </div>
      </div>
    );
  }

  // Not a client yet: the way in.
  if (!summary?.enabled) return <GetPaidNow />;
  const active = summary.status === 'active';

  return (
    <div className="page max-w-7xl mx-auto">
      <div className="page-header mb-4">
        <div>
          <h1>Funding</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your invoices funded by One Source</p>
        </div>
        {active && (
          <button className="btn-primary" onClick={() => setFunding(true)}>
            <Plus className="w-4 h-4" /> Fund an invoice
          </button>
        )}
      </div>

      {!active && (
        <div className="card p-4 mb-5 bg-slate-50 text-sm text-slate-600">
          Your funding account is paused, so new requests are off for now. Your funded history is all here —
          contact One Source to pick it back up.
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={clsx('px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px',
                    tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview summary={summary} onOpen={setOpenInvoice} />}
      {tab === 'invoices' && <FundedInvoices onOpen={setOpenInvoice} />}
      {tab === 'statements' && <Statements onOpen={setOpenInvoice} />}
      {tab === 'insights' && <Insights />}

      {openInvoice && <InvoiceDrawer invoiceId={openInvoice} onClose={() => setOpenInvoice(null)} />}
      {funding && <LogInvoiceModal fund onClose={() => setFunding(false)} />}
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({ summary, onOpen }: { summary: Summary; onOpen: (invoiceId: string) => void }) {
  const { data: outstanding = [], isLoading } = useQuery<Advance[]>({
    queryKey: ['factoring-invoices', 'outstanding'],
    queryFn: () => api.get('/factoring/invoices?status=outstanding').then((r) => r.data.data),
  });
  const { data: invoices = [] } = useQuery<{ id: string; status: string; balance_due: string; funded_id: string | null }[]>({
    queryKey: ['invoices', ''],
    queryFn: () => api.get('/invoices?status=').then((r) => r.data.data),
  });
  const { data: requests = [] } = useQuery<FundingRequestRow[]>({
    queryKey: ['factoring-requests'],
    queryFn: () => api.get('/factoring/requests').then((r) => r.data.data),
  });
  const inFlight = new Set(requests.filter((r) => ['submitted', 'under_review', 'approved'].includes(r.status)).map((r) => r.invoice_id));
  const ready = invoices.filter((i) => i.status === 'approved' && Number(i.balance_due) > 0 && !i.funded_id && !inFlight.has(i.id));
  const readyTotal = ready.reduce((s, i) => s + Number(i.balance_due), 0);
  const approaching = Number(summary.approaching_recourse ?? 0);

  return (
    <>
      {summary.funding_limit !== null && summary.funding_limit !== undefined && (
        <FundingLimitCard
          limit={Number(summary.funding_limit)}
          used={Number(summary.funding_used ?? 0)}
          available={Number(summary.funding_available ?? 0)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Advanced outstanding</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-nums">{formatCurrency(summary.advanced_outstanding)}</p>
          <p className="text-xs text-slate-500 mt-0.5">{summary.outstanding_count} open advances</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Reserve held</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-nums">{formatCurrency(summary.reserve_held)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Net expected</p>
          <p className="text-xl sm:text-2xl font-bold text-green-700 mt-1 tabular-nums">{formatCurrency(summary.net_expected)}</p>
          <p className="text-xs text-slate-500 mt-0.5">Reserve less fees to date and any short payment</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Approaching recourse</p>
          <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums ${approaching > 0 ? 'text-orange-600' : 'text-slate-900'}`}>
            {approaching}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">within 14 days</p>
        </div>
      </div>

      {approaching > 0 && (
        <div className="card p-4 mb-5 border-orange-200 bg-orange-50 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-900">
              {approaching} advance{approaching === 1 ? '' : 's'} nearing recourse
            </p>
            <p className="text-sm text-orange-800 mt-0.5">
              If the agency hasn’t paid by the recourse date, the advance may be charged back.
              Chasing payment now is the cheapest fix.
            </p>
          </div>
        </div>
      )}

      {summary.status === 'active' && ready.length > 0 && (
        <Link to="/invoices?view=eligible"
              className="card p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:border-brand-300">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
          <p className="flex-1 text-sm text-slate-700">
            <strong className="text-slate-900">{ready.length} approved invoice{ready.length === 1 ? '' : 's'}</strong>{' '}
            ({formatCurrency(readyTotal)}) ready to fund — up to {formatCurrency(readyTotal * ADVANCE_MAX)}.
          </p>
          <span className="text-sm font-medium text-brand-600">Choose which →</span>
        </Link>
      )}

      <FundingRequests rows={requests} />

      <h2 className="text-base font-semibold text-slate-900 mb-3">Out with agencies now</h2>
      <AdvanceTable rows={outstanding} loading={isLoading} onOpen={onOpen} empty="Nothing funded is waiting on an agency." />
      <p className="text-xs text-slate-500 mt-3">
        Net expected is your reserve less fees accrued to date and, if an agency paid less than the invoice,
        the difference. It updates daily while an invoice is outstanding.
      </p>

      <OnboardingDocuments />
    </>
  );
}

/**
 * Funding limit and remaining headroom: what can be drawn before going looking
 * for an invoice to fund, and a limit that visibly grows with on-time repayment.
 */
function FundingLimitCard({ limit, used, available }: { limit: number; used: number; available: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tight = available <= 0;
  return (
    <div className="card p-4 sm:p-5 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Available to fund</p>
          <p className={`text-2xl sm:text-3xl font-bold mt-0.5 tabular-nums ${tight ? 'text-slate-400' : 'text-green-700'}`}>
            {formatCurrency(available)}
          </p>
        </div>
        <p className="text-sm text-slate-500 tabular-nums">{formatCurrency(used)} of {formatCurrency(limit)} in use</p>
      </div>
      <div className="h-2 rounded-full bg-brand-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)}
           aria-valuemin={0} aria-valuemax={100} aria-label="Funding limit used">
        <div className={`h-full rounded-full transition-[width] duration-500 ${pct >= 90 ? 'bg-orange-500' : 'bg-brand-600'}`}
             style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-500 mt-2">
        {tight ? 'Your limit is fully drawn. It frees up as your open advances are collected.'
               : 'Your limit grows as advances are repaid on time.'}
      </p>
    </div>
  );
}

interface FundingRequestRow {
  id: string; invoice_id: string; invoice_number: string | null; customer_name: string | null;
  requested_amount: string; status: string; requested_at: string; reviewed_at: string | null;
  decline_reason: string | null;
}

/** Requests not yet turned into an advance: waiting on One Source, or recently declined. */
function FundingRequests({ rows: all }: { rows: FundingRequestRow[] }) {
  const qc = useQueryClient();
  const cutoff = Date.now() - 60 * 86400_000;
  const rows = all.filter((r) => ['submitted', 'under_review'].includes(r.status)
    || (r.status === 'declined' && Date.parse(r.reviewed_at ?? r.requested_at) >= cutoff));
  if (!rows.length) return null;

  const withdraw = async (id: string) => {
    if (!window.confirm('Withdraw this funding request?')) return;
    try {
      await api.patch(`/factoring/requests/${id}/withdraw`);
      toast.success('Request withdrawn');
      qc.invalidateQueries({ queryKey: ['factoring-requests'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e) {
      toast.error(apiError(e, 'Could not withdraw the request'));
    }
  };

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-slate-900 mb-3">Funding requests</h2>
      <div className="card overflow-x-auto relative">
        <table className="w-full min-w-[40rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-header">Invoice</th>
              <th className="table-header">Agency</th>
              <th className="table-header text-right">Amount</th>
              <th className="table-header">Requested</th>
              <th className="table-header">Status</th>
              <th className="table-header"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 align-top">
                <td className="table-cell font-mono font-medium">{r.invoice_number ?? '—'}</td>
                <td className="table-cell">{r.customer_name ?? '—'}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(r.requested_amount)}</td>
                <td className="table-cell text-slate-500">{formatDate(r.requested_at)}</td>
                <td className="table-cell-wrap">
                  <span className={FUNDING_BADGE[r.status] ?? 'badge-gray'}>{FUNDING_LABEL[r.status] ?? r.status}</span>
                  {r.status === 'declined' && r.decline_reason && (
                    <p className="text-xs text-slate-600 mt-1 max-w-xs">{r.decline_reason}</p>
                  )}
                </td>
                <td className="table-cell text-right">
                  {r.status === 'submitted' && (
                    <button className="btn-ghost btn-sm" onClick={() => void withdraw(r.id)}>Withdraw</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Recourse countdown is the number that actually matters, so it gets colour. */
function RecourseCell({ days }: { days: number | null }) {
  if (days === null) return <span className="text-slate-400">—</span>;
  const tone = days < 0 ? 'text-red-600 font-semibold' : days <= 14 ? 'text-orange-600 font-semibold' : 'text-slate-600';
  return <span className={tone}>{days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}</span>;
}

/** Advances as a table; each row opens its invoice. */
function AdvanceTable({ rows, loading, onOpen, empty }: {
  rows: Advance[]; loading: boolean; onOpen: (invoiceId: string) => void; empty: string;
}) {
  return (
    <div className="card overflow-x-auto relative">
      <table className="w-full min-w-[54rem]">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="table-header">Invoice</th>
            <th className="table-header">Agency</th>
            <th className="table-header">Funded</th>
            <th className="table-header text-right">Invoice</th>
            <th className="table-header text-right">Advanced</th>
            <th className="table-header text-right">Fees</th>
            <th className="table-header text-right">Net expected</th>
            <th className="table-header text-right">Days out</th>
            <th className="table-header text-right">Recourse</th>
            <th className="table-header">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500 text-sm">Loading…</td></tr>}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-10 text-center">
                <PiggyBank className="w-9 h-9 mx-auto text-slate-300 mb-2" />
                <p className="text-slate-500 text-sm">{empty}</p>
              </td>
            </tr>
          )}
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <td className="table-cell">
                {a.invoice_id ? (
                  <button className="font-mono font-medium text-brand-600 hover:underline" onClick={() => onOpen(a.invoice_id!)}>
                    {factoredInvoiceRef(a)}
                  </button>
                ) : <span className="font-mono font-medium">{factoredInvoiceRef(a)}</span>}
              </td>
              <td className="table-cell-wrap min-w-[10rem] max-w-[16rem]">{a.debtor_name}</td>
              <td className="table-cell text-slate-500">{a.advanced_on ? formatDate(a.advanced_on) : '—'}</td>
              <td className="table-cell text-right tabular-nums">{formatCurrency(a.face_amount)}</td>
              <td className="table-cell text-right tabular-nums">{formatCurrency(a.advance_amount)}</td>
              <td className="table-cell text-right tabular-nums text-slate-600">{formatCurrency(a.accrued_fee)}</td>
              <td className="table-cell text-right tabular-nums font-medium text-green-700">
                {['advanced', 'collected', 'pending'].includes(a.status) && a.net_expected !== null
                  ? formatCurrency(a.net_expected) : <span className="text-slate-400 font-normal">—</span>}
              </td>
              <td className="table-cell text-right tabular-nums">
                {a.days_outstanding === null ? <span className="text-slate-400">—</span>
                  : <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-400" />{a.days_outstanding}d</span>}
              </td>
              <td className="table-cell text-right tabular-nums"><RecourseCell days={a.days_to_recourse} /></td>
              <td className="table-cell">
                <span className={STATUS[a.status]?.badge ?? 'badge-gray'}>{STATUS[a.status]?.label ?? a.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Funded invoices (full history) ───────────────────────────────────────────

function FundedInvoices({ onOpen }: { onOpen: (invoiceId: string) => void }) {
  const [scope, setScope] = useState<'all' | 'outstanding' | 'closed'>('all');
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery<Advance[]>({
    queryKey: ['factoring-invoices', scope],
    queryFn: () => api.get(`/factoring/invoices?status=${scope}`).then((r) => r.data.data),
  });
  const needle = q.trim().toLowerCase();
  const rows = needle
    ? data.filter((a) => [a.invoice_number, a.debtor_name].some((v) => v?.toLowerCase().includes(needle)))
    : data;
  const total = (k: keyof Advance) => rows.reduce((s, a) => s + Number(a[k] ?? 0), 0);

  const exportCsv = () => downloadCsv(`funded-invoices-${todayISO()}.csv`,
    ['Invoice #', 'Agency', 'Funded on', 'Invoice amount', 'Advanced', 'Reserve', 'Fees', 'Agency paid on',
     'Net expected', 'Days outstanding', 'Status'],
    rows.map((a) => [factoredInvoiceRef(a), a.debtor_name, a.advanced_on?.slice(0, 10), Number(a.face_amount).toFixed(2),
      Number(a.advance_amount).toFixed(2), Number(a.reserve_amount).toFixed(2), Number(a.accrued_fee).toFixed(2),
      a.collected_on?.slice(0, 10), ['advanced', 'collected', 'pending'].includes(a.status) && a.net_expected !== null
        ? Number(a.net_expected).toFixed(2) : '', a.days_outstanding, STATUS[a.status]?.label ?? a.status]));

  return (
    <>
      <div className="filter-bar flex-wrap">
        <div className="relative w-full sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search invoice or agency" value={q}
                 onChange={(e) => setQ(e.target.value)} aria-label="Search funded invoices" />
        </div>
        <select className="input w-full sm:w-44" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}
                aria-label="Which advances">
          <option value="all">All</option>
          <option value="outstanding">Out with agencies</option>
          <option value="closed">Settled</option>
        </select>
        <button className="btn-secondary sm:ml-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download className="w-4 h-4" /> Download CSV
        </button>
      </div>
      {rows.length > 0 && (
        <p className="text-sm text-slate-600 mb-3 tabular-nums">
          {rows.length} invoice{rows.length === 1 ? '' : 's'} · {formatCurrency(total('face_amount'))} funded ·{' '}
          {formatCurrency(total('advance_amount'))} advanced · {formatCurrency(total('accrued_fee'))} in fees
        </p>
      )}
      <AdvanceTable rows={rows} loading={isLoading} onOpen={onOpen} empty="No funded invoices match." />
    </>
  );
}

// ─── Statements ───────────────────────────────────────────────────────────────

interface StatementData {
  from: string; to: string;
  lines: { date: string; type: string; amount: number | null; memo: string | null;
           invoice_id: string | null; invoice_number: string | null; agency: string }[];
  totals: { advanced: number; agency_paid: number; reserve_released: number; charged_back: number;
            fees_on_settled: number; short_paid_on_settled: number; settled_count: number };
  open_at_end: { count: number; advanced: number; reserve: number; fees_accrued: number };
}

const LINE_LABEL: Record<string, string> = {
  advance: 'Advance sent to you',
  payment_received: 'Agency paid One Source',
  reserve_release: 'Reserve released to you',
  chargeback: 'Charged back',
  direct_payment_reported: 'You reported a direct payment',
};

type Period = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year' | 'custom';
const PERIODS: [Period, string][] = [
  ['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'],
  ['last_quarter', 'Last quarter'], ['this_year', 'Year to date'], ['last_year', 'Last year'], ['custom', 'Custom dates'],
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** [from, to] for a named period, in UTC calendar days. */
function periodRange(p: Period, today = new Date()): [string, string] {
  const y = today.getUTCFullYear(); const m = today.getUTCMonth();
  const q = Math.floor(m / 3) * 3;
  const day = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm, dd)));
  switch (p) {
    case 'last_month': return [day(y, m - 1, 1), day(y, m, 0)];
    case 'this_quarter': return [day(y, q, 1), iso(today)];
    case 'last_quarter': return [day(y, q - 3, 1), day(y, q, 0)];
    case 'this_year': return [day(y, 0, 1), iso(today)];
    case 'last_year': return [day(y - 1, 0, 1), day(y - 1, 11, 31)];
    default: return [day(y, m, 1), iso(today)];
  }
}

function Statements({ onOpen }: { onOpen: (invoiceId: string) => void }) {
  const user = useAuthStore((s) => s.user);
  const [period, setPeriod] = useState<Period>('last_month');
  const [custom, setCustom] = useState<[string, string]>(periodRange('this_month'));
  const [from, to] = period === 'custom' ? custom : periodRange(period);
  const { data: company } = useQuery({
    queryKey: ['company-settings', user?.company_id],
    queryFn: () => api.get('/settings/company').then((r) => r.data.data as { name: string }),
  });
  const { data: s, isLoading, isError } = useQuery<StatementData>({
    queryKey: ['factoring-statement', from, to],
    queryFn: () => api.get(`/factoring/statement?from=${from}&to=${to}`).then((r) => r.data.data),
    enabled: from <= to,
  });

  const exportCsv = () => s && downloadCsv(`funding-statement-${from}-to-${to}.csv`,
    ['Date', 'Invoice #', 'Agency', 'Activity', 'Amount', 'Reference'],
    s.lines.map((l) => [l.date, l.invoice_number, l.agency, LINE_LABEL[l.type] ?? l.type,
      l.amount === null ? '' : l.amount.toFixed(2), l.memo]));

  return (
    <>
      <div className="filter-bar flex-wrap items-end">
        <div>
          <label className="label" htmlFor="st-period">Period</label>
          <select id="st-period" className="input w-full sm:w-48" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map(([p, label]) => <option key={p} value={p}>{label}</option>)}
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div>
              <label className="label" htmlFor="st-from">From</label>
              <input id="st-from" type="date" className="input" value={custom[0]} max={custom[1]}
                     onChange={(e) => setCustom([e.target.value, custom[1]])} />
            </div>
            <div>
              <label className="label" htmlFor="st-to">To</label>
              <input id="st-to" type="date" className="input" value={custom[1]} min={custom[0]}
                     onChange={(e) => setCustom([custom[0], e.target.value])} />
            </div>
          </>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <button className="btn-secondary" onClick={exportCsv} disabled={!s}>
            <Download className="w-4 h-4" /> CSV
          </button>
          <button className="btn-secondary" onClick={() => s && printStatement(s, company?.name ?? '')} disabled={!s}>
            <Printer className="w-4 h-4" /> Print or save PDF
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500 mb-4">{formatDate(from)} – {formatDate(to)}</p>

      {isError && <div className="card p-5 text-sm text-red-700">Couldn’t load this statement.</div>}
      {isLoading && <div className="card p-8 text-center text-sm text-slate-500">Loading…</div>}
      {s && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Tile label="Advanced to you" value={s.totals.advanced} />
            <Tile label="Agencies paid One Source" value={s.totals.agency_paid} />
            <Tile label="Reserve released to you" value={s.totals.reserve_released} tone="green" />
            <Tile label="Fees" value={s.totals.fees_on_settled}
                  sub={`on ${s.totals.settled_count} invoice${s.totals.settled_count === 1 ? '' : 's'} settled`} />
          </div>
          {(s.totals.short_paid_on_settled > 0 || s.totals.charged_back > 0) && (
            <p className="text-sm text-slate-600 mb-4">
              {s.totals.short_paid_on_settled > 0 && <>Agencies short-paid {formatCurrency(s.totals.short_paid_on_settled)} on invoices settled in this period, taken from the reserve. </>}
              {s.totals.charged_back > 0 && <>{formatCurrency(s.totals.charged_back)} was charged back.</>}
            </p>
          )}
          <div className="card p-4 mb-6 text-sm text-slate-700">
            <span className="font-medium text-slate-900">Open on {formatDate(to)}:</span>{' '}
            {s.open_at_end.count} invoice{s.open_at_end.count === 1 ? '' : 's'} with agencies ·{' '}
            {formatCurrency(s.open_at_end.advanced)} advanced · {formatCurrency(s.open_at_end.reserve)} reserve held ·{' '}
            {formatCurrency(s.open_at_end.fees_accrued)} fees accrued
          </div>

          <h2 className="text-base font-semibold text-slate-900 mb-3">Activity</h2>
          <div className="card overflow-x-auto relative">
            <table className="w-full min-w-[40rem]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="table-header">Date</th>
                  <th className="table-header">Invoice</th>
                  <th className="table-header">Agency</th>
                  <th className="table-header">Activity</th>
                  <th className="table-header text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.lines.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No funding activity in this period.</td></tr>
                )}
                {s.lines.map((l, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="table-cell text-slate-500">{formatDate(l.date)}</td>
                    <td className="table-cell">
                      {l.invoice_id ? (
                        <button className="font-mono text-brand-600 hover:underline" onClick={() => onOpen(l.invoice_id!)}>
                          {l.invoice_number ?? '—'}
                        </button>
                      ) : <span className="font-mono">{l.invoice_number ?? '—'}</span>}
                    </td>
                    <td className="table-cell-wrap min-w-[10rem]">{l.agency}</td>
                    <td className="table-cell">
                      {LINE_LABEL[l.type] ?? l.type}
                      {l.memo && <span className="text-slate-400"> · {l.memo}</span>}
                    </td>
                    <td className="table-cell text-right tabular-nums">{l.amount === null ? '—' : formatCurrency(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'green' }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={clsx('text-lg sm:text-xl font-bold mt-1 tabular-nums', tone === 'green' ? 'text-green-700' : 'text-slate-900')}>
        {formatCurrency(value)}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/** A printable statement in its own window; the browser's print dialog saves it as a PDF. */
function printStatement(s: StatementData, company: string) {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const money = (n: number | null) => (n === null ? '—' : formatCurrency(n));
  const rows = s.lines.map((l) => `<tr><td>${esc(formatDate(l.date))}</td><td class="mono">${esc(l.invoice_number ?? '—')}</td>
    <td>${esc(l.agency)}</td><td>${esc(LINE_LABEL[l.type] ?? l.type)}${l.memo ? ` · ${esc(l.memo)}` : ''}</td>
    <td class="num">${esc(money(l.amount))}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Funding statement ${esc(s.from)} to ${esc(s.to)}</title>
<style>
  body { font: 13px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; color: #0f172a; margin: 32px; }
  h1 { font-size: 20px; margin: 0; } .muted { color: #64748b; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
  .tile { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
  .tile b { display: block; font-size: 16px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  .num { text-align: right; font-variant-numeric: tabular-nums; } .mono { font-family: ui-monospace, monospace; }
  @media print { body { margin: 12mm; } }
</style></head><body>
<p class="muted">One Source Funding · Funding statement</p>
<h1>${esc(company)}</h1>
<p class="muted">${esc(formatDate(s.from))} – ${esc(formatDate(s.to))}</p>
<div class="tiles">
  <div class="tile">Advanced to you<b>${esc(money(s.totals.advanced))}</b></div>
  <div class="tile">Agencies paid One Source<b>${esc(money(s.totals.agency_paid))}</b></div>
  <div class="tile">Reserve released to you<b>${esc(money(s.totals.reserve_released))}</b></div>
  <div class="tile">Fees (${s.totals.settled_count} settled)<b>${esc(money(s.totals.fees_on_settled))}</b></div>
</div>
<p>Open on ${esc(formatDate(s.to))}: ${s.open_at_end.count} invoice(s) with agencies · ${esc(money(s.open_at_end.advanced))} advanced ·
  ${esc(money(s.open_at_end.reserve))} reserve held · ${esc(money(s.open_at_end.fees_accrued))} fees accrued</p>
${s.totals.short_paid_on_settled > 0 ? `<p>Short payments taken from the reserve: ${esc(money(s.totals.short_paid_on_settled))}</p>` : ''}
<table><thead><tr><th>Date</th><th>Invoice</th><th>Agency</th><th>Activity</th><th class="num">Amount</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="muted">No funding activity in this period.</td></tr>'}</tbody></table>
<p class="muted" style="margin-top:24px">Generated ${esc(formatDate(todayISO()))}. Figures are from One Source's ledger.</p>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast.error('Allow pop-ups to print the statement'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

// ─── Insights ─────────────────────────────────────────────────────────────────

interface InsightsData {
  months: { month: string; billed: number; funded: number; advanced: number; fees: number }[];
  share_funded_12m: number | null;
  lifetime: { funded_count: number; funded: number; advanced: number; fees: number;
              effective_fee_rate: number | null; avg_days_to_pay: number | null; since: string | null };
  agencies: { agency: string; funded_count: number; funded: number; open_count: number;
              avg_days_to_pay: number | null; slowest_days: number | null; short_paid: number }[];
}

const monthLabel = (m: string, long = false) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined, timeZone: 'UTC' });
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`);

function Insights() {
  const [asTable, setAsTable] = useState(false);
  const { data: d, isLoading } = useQuery<InsightsData>({
    queryKey: ['factoring-insights'],
    queryFn: () => api.get('/factoring/insights').then((r) => r.data.data),
  });
  if (isLoading || !d) return <div className="card p-8 text-center text-sm text-slate-500">Loading…</div>;
  const fees12 = d.months.reduce((s, m) => s + m.fees, 0);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Funded to date</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{formatCurrency(d.lifetime.funded)}</p>
          <p className="text-xs text-slate-500">
            {d.lifetime.funded_count} invoices{d.lifetime.since ? ` since ${formatDate(d.lifetime.since)}` : ''}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Fees</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{formatCurrency(d.lifetime.fees)}</p>
          <p className="text-xs text-slate-500">
            {pct(d.lifetime.effective_fee_rate)} of funded · {formatCurrency(fees12)} in the last 12 months
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Agencies take</p>
          <p className="text-xl font-bold mt-1 tabular-nums">
            {d.lifetime.avg_days_to_pay === null ? '—' : `${d.lifetime.avg_days_to_pay} days`}
          </p>
          <p className="text-xs text-slate-500">on average to pay a funded invoice</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Share of billing funded</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{pct(d.share_funded_12m)}</p>
          <p className="text-xs text-slate-500">last 12 months, of invoices logged here</p>
        </div>
      </div>

      <section className="card p-4 sm:p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Funded each month</h2>
            <p className="text-xs text-slate-500">Invoice value funded by One Source, last 12 months</p>
          </div>
          <button className="btn-ghost btn-sm" onClick={() => setAsTable((v) => !v)}>
            {asTable ? <><BarChart3 className="w-4 h-4" /> Chart</> : <><Table2 className="w-4 h-4" /> Table</>}
          </button>
        </div>
        {asTable ? (
          <div className="overflow-x-auto relative">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="table-header">Month</th>
                  <th className="table-header text-right">Billed</th>
                  <th className="table-header text-right">Funded</th>
                  <th className="table-header text-right">Share</th>
                  <th className="table-header text-right">Fees</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.months.map((m) => (
                  <tr key={m.month}>
                    <td className="table-cell">{monthLabel(m.month, true)}</td>
                    <td className="table-cell text-right tabular-nums">{formatCurrency(m.billed)}</td>
                    <td className="table-cell text-right tabular-nums">{formatCurrency(m.funded)}</td>
                    <td className="table-cell text-right tabular-nums">{m.billed > 0 ? pct(Math.min(1, m.funded / m.billed)) : '—'}</td>
                    <td className="table-cell text-right tabular-nums">{formatCurrency(m.fees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <MonthlyChart months={d.months} />}
      </section>

      <h2 className="text-base font-semibold text-slate-900 mb-3">How each agency pays</h2>
      <div className="card overflow-x-auto relative">
        <table className="w-full min-w-[44rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-header">Agency</th>
              <th className="table-header text-right">Invoices funded</th>
              <th className="table-header text-right">Funded</th>
              <th className="table-header text-right">Average days to pay</th>
              <th className="table-header text-right">Slowest</th>
              <th className="table-header text-right">Open now</th>
              <th className="table-header text-right">Short-paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d.agencies.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">Nothing funded yet.</td></tr>
            )}
            {d.agencies.map((a) => (
              <tr key={a.agency} className="hover:bg-slate-50">
                <td className="table-cell-wrap min-w-[12rem]">{a.agency}</td>
                <td className="table-cell text-right tabular-nums">{a.funded_count}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(a.funded)}</td>
                <td className="table-cell text-right tabular-nums">{a.avg_days_to_pay === null ? '—' : `${a.avg_days_to_pay} days`}</td>
                <td className="table-cell text-right tabular-nums text-slate-500">{a.slowest_days === null ? '—' : `${a.slowest_days} days`}</td>
                <td className="table-cell text-right tabular-nums">{a.open_count || '—'}</td>
                <td className="table-cell text-right tabular-nums text-slate-500">{a.short_paid > 0 ? formatCurrency(a.short_paid) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Twelve monthly columns, one series (no legend; the heading names it). Thin
 * columns with a rounded top, a recessive grid, and a tooltip per month that
 * also carries what was billed, the share funded and the fees.
 */
function MonthlyChart({ months }: { months: InsightsData['months'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, L = 52, R = 8, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(...months.map((m) => m.funded), 0);
  const top = useMemo(() => niceCeil(max), [max]);
  const band = iw / months.length;
  const bw = Math.min(24, band * 0.55);
  const y = (v: number) => T + ih - (top > 0 ? (v / top) * ih : 0);
  const ticks = [0, top / 2, top];
  const h = hover === null ? null : months[hover]!;

  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[34rem] h-auto" role="img"
           aria-label="Invoice value funded each month for the last 12 months" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">
              {formatCurrency(t, { short: true })}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = L + i * band + (band - bw) / 2;
          const yt = y(m.funded);
          const hgt = T + ih - yt;
          const r = Math.min(4, hgt);
          return (
            <g key={m.month}>
              {m.funded > 0 && (
                <path fill={hover === null || hover === i ? '#2563eb' : '#93c5fd'}
                      d={`M${x},${T + ih} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${T + ih} Z`} />
              )}
              <text x={L + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#64748b">
                {monthLabel(m.month)}
              </text>
              {/* Hit target: the whole month's band, not just the column. */}
              <rect x={L + i * band} y={T} width={band} height={ih} fill="transparent"
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                    aria-label={`${monthLabel(m.month, true)}: ${formatCurrency(m.funded)} funded`} />
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
             style={hover < months.length / 2
               // Beside the column, never over it: right of it in the first half, left in the second.
               ? { left: `calc(${((L + hover * band + band / 2 + bw / 2) / W) * 100}% + 10px)`, width: 170 }
               : { left: `calc(${((L + hover * band + band / 2 - bw / 2) / W) * 100}% - 180px)`, width: 170 }}>
          <p className="font-semibold text-slate-900 mb-1">{monthLabel(h.month, true)}</p>
          <p className="flex justify-between"><span className="text-slate-500">Funded</span><span className="tabular-nums">{formatCurrency(h.funded)}</span></p>
          <p className="flex justify-between"><span className="text-slate-500">Billed</span><span className="tabular-nums">{formatCurrency(h.billed)}</span></p>
          <p className="flex justify-between"><span className="text-slate-500">Share</span><span className="tabular-nums">{h.billed > 0 ? pct(Math.min(1, h.funded / h.billed)) : '—'}</span></p>
          <p className="flex justify-between"><span className="text-slate-500">Fees</span><span className="tabular-nums">{formatCurrency(h.fees)}</span></p>
        </div>
      )}
    </div>
  );
}

/** A round axis top just above the largest value: 1, 2 or 5 × a power of ten. */
function niceCeil(v: number): number {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

// ─── Application documents ────────────────────────────────────────────────────

/** What the client provided when they applied, kept with their account. */
function OnboardingDocuments() {
  const { data } = useQuery({
    queryKey: ['onboarding-documents'],
    queryFn: () => api.get('/factoring/onboarding-documents').then((r) => r.data.data as {
      id: string; original_name: string; created_at: string;
    }[]),
  });
  if (!data?.length) return null;
  return (
    <details className="card mt-8">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">
        Your application documents ({data.length})
      </summary>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {data.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
            <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="text-sm text-slate-800 truncate flex-1 min-w-0">{d.original_name}</span>
            <button className="btn-ghost btn-sm"
                    onClick={() => void downloadAttachment(`/files/${d.id}/download`, d.original_name)
                      .catch(() => toast.error('Download failed'))}>
              Download
            </button>
          </li>
        ))}
      </ul>
      <p className="px-4 py-3 text-xs text-slate-500 border-t border-slate-100">
        To update one of these, send the new version to One Source.
      </p>
    </details>
  );
}

// ─── Not a client yet ─────────────────────────────────────────────────────────

/**
 * "Get paid now" — the Funding page for a company that doesn't factor yet.
 * Leads with their own numbers: what the agencies have approved and not paid,
 * and what One Source could advance on it today.
 */
function GetPaidNow() {
  const { data: invoices = [] } = useQuery<{ status: string; balance_due: string; funded_id: string | null }[]>({
    queryKey: ['invoices', ''],
    queryFn: () => api.get('/invoices?status=').then((r) => r.data.data),
  });
  const approved = invoices.filter((i) => i.status === 'approved' && Number(i.balance_due) > 0 && !i.funded_id);
  const approvedTotal = approved.reduce((s, i) => s + Number(i.balance_due), 0);
  const waiting = invoices.filter((i) => ['sent', 'viewed', 'overdue'].includes(i.status))
    .reduce((s, i) => s + Number(i.balance_due), 0);

  return (
    <div className="page max-w-4xl mx-auto">
      <h1>Get paid now</h1>
      <p className="text-sm text-slate-500 mt-0.5">
        Stop waiting 30, 60 or 90+ days on agencies. One Source advances up to 90% of an approved invoice,
        often the same day.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        <div className="card p-5 border-emerald-200 bg-emerald-50">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Approved, waiting on the agency</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{formatCurrency(approvedTotal)}</p>
          <p className="text-sm text-slate-700 mt-1">
            {approvedTotal > 0
              ? <>Up to <strong className="tabular-nums">{formatCurrency(approvedTotal * ADVANCE_MAX)}</strong> could be in your account now
                 ({approved.length} invoice{approved.length === 1 ? '' : 's'}).</>
              : 'Mark invoices approved in Invoices as agencies approve them, and they show up here.'}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Submitted, awaiting approval</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{formatCurrency(waiting)}</p>
          <p className="text-sm text-slate-600 mt-1">Eligible once the agency approves it.</p>
        </div>
      </div>

      <div className="card p-5 sm:p-6 mt-4">
        <p className="font-semibold text-slate-900 mb-3">How it works</p>
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-slate-600">
          <li className="flex gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span><strong className="text-slate-800">The agency approves your invoice.</strong> You keep tracking it here, exactly as now.</span>
          </li>
          <li className="flex gap-2">
            <Zap className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span><strong className="text-slate-800">Request funding from the invoice.</strong> One Source advances
              {' '}{Math.round(ADVANCE_TYPICAL * 100)}–{Math.round(ADVANCE_MAX * 100)}%, often the same day.</span>
          </li>
          <li className="flex gap-2">
            <PiggyBank className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span><strong className="text-slate-800">The agency pays One Source.</strong> You get the rest,
              less a fee, and the invoice is marked paid for you.</span>
          </li>
        </ol>
        <p className="text-xs text-slate-500 mt-4">
          You choose invoice by invoice. Anything you don&rsquo;t fund stays exactly as it is.
        </p>
      </div>

      <div className="card p-5 sm:p-6 mt-4">
        <p className="font-semibold text-slate-900">Set up funding</p>
        <p className="text-sm text-slate-500 mt-0.5 mb-4">Tell us where to reach you. No commitment.</p>
        <FundingOnboardingForm showIntro={false} />
      </div>
    </div>
  );
}
