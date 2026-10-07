import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, AlertTriangle, PiggyBank, Clock, FolderKanban, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError, formatCurrency, formatDate } from '../../lib/api';
import { factoredInvoiceRef } from '@constructpm/shared';
import { FundingOnboardingForm } from '../../components/FundingOnboardingForm';
import { FUNDING_BADGE, FUNDING_LABEL } from '../../lib/invoices';

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-gray',
  advanced: 'badge-blue',
  collected: 'badge-yellow',
  closed: 'badge-green',
  charged_back: 'badge-red',
};

interface Advance {
  id: string;
  invoice_number: string | null;
  debtor_name: string;
  face_amount: string;
  advance_amount: string;
  reserve_amount: string;
  accrued_fee: string;
  net_expected: string;
  status: string;
  advanced_on: string | null;
  invoice_due_on: string | null;
  days_outstanding: number | null;
  days_to_recourse: number | null;
  job_id: string | null;
  job_name: string | null;
  job_number: string | null;
}

/**
 * Funding limit and remaining headroom.
 *
 * Shown because a contractor needs to know what they can draw before they go
 * looking for an invoice to fund — and because a limit that visibly grows is the
 * thing that brings them back for the second and twentieth advance. The reasons
 * behind any individual decision stay internal.
 */
function FundingLimitCard({ limit, used, available }: {
  limit: number; used: number; available: number;
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tight = available <= 0;

  return (
    <div className="card p-4 sm:p-5 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Available to fund</p>
          <p className={`text-2xl sm:text-3xl font-bold mt-0.5 tabular-nums ${
            tight ? 'text-slate-400' : 'text-green-700'}`}>
            {formatCurrency(available)}
          </p>
        </div>
        <p className="text-sm text-slate-500 tabular-nums">
          {formatCurrency(used)} of {formatCurrency(limit)} in use
        </p>
      </div>

      <div
        className="h-2 rounded-full bg-slate-100 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Funding limit used"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            pct >= 90 ? 'bg-orange-500' : 'bg-brand-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs text-slate-500 mt-2">
        {tight
          ? 'Your limit is fully drawn. It frees up as your open advances are collected.'
          : 'Your limit grows as advances are repaid on time.'}
      </p>
    </div>
  );
}

/** Recourse countdown is the number that actually matters, so it gets colour. */
function RecourseCell({ days }: { days: number | null }) {
  if (days === null) return <span className="text-slate-400">—</span>;
  const tone = days < 0 ? 'text-red-600 font-semibold'
    : days <= 14 ? 'text-orange-600 font-semibold'
    : 'text-slate-600';
  return <span className={tone}>{days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}</span>;
}

export function FactoringPage() {
  const [scope, setScope] = useState('outstanding');

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['factoring-summary'],
    queryFn: () => api.get('/factoring/summary').then(r => r.data.data),
  });

  const { data: advances, isLoading } = useQuery<Advance[]>({
    queryKey: ['factoring-invoices', scope],
    queryFn: () => api.get(`/factoring/invoices?status=${scope}`).then(r => r.data.data),
    enabled: summary?.enabled === true,
  });

  if (loadingSummary) {
    return (
      <div className="page max-w-7xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/3" />
          <div className="h-24 bg-slate-200 rounded" />
        </div>
      </div>
    );
  }

  // Not set up for funding yet: explain it in a sentence and offer the way in,
  // rather than a dead end.
  if (!summary?.enabled || summary.status !== 'active') {
    return (
      <div className="page max-w-3xl mx-auto">
        <h1>Funding</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Get paid on invoices the agency has approved, instead of waiting 30, 60 or 90+ days.
        </p>
        <div className="card p-5 sm:p-6 mt-6">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
              <Banknote className="w-5 h-5 text-brand-600" />
            </div>
            <div className="text-sm text-slate-600 space-y-1">
              <p className="font-medium text-slate-800">How it works</p>
              <p>Once the agency approves an invoice, request funding from it here. One Source
                 advances most of its value — typically 80% — and sends the rest, less a fee, when
                 the agency pays. Tell us where to reach you and we&rsquo;ll take it from there.</p>
            </div>
          </div>
          <FundingOnboardingForm showIntro={false} />
        </div>
      </div>
    );
  }

  const rows = advances ?? [];

  return (
    <div className="page max-w-7xl mx-auto">
      <div className="page-header">
        <div>
          <h1>Funding</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Invoices funded by One Source
          </p>
        </div>
      </div>

      {/* The funding limit sits above the position, because it is the number that
          answers "can I fund the invoice on my desk right now?" — and the one
          that earns the next request. The client sees the figures, never the
          reasoning behind a decision. */}
      {summary.funding_limit !== null && summary.funding_limit !== undefined && (
        <FundingLimitCard
          limit={Number(summary.funding_limit)}
          used={Number(summary.funding_used ?? 0)}
          available={Number(summary.funding_available ?? 0)}
        />
      )}

      {/* Headline position. Currency cards go full width on phones — see index.css. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Advanced outstanding</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {formatCurrency(summary.advanced_outstanding)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{summary.outstanding_count} open advances</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Reserve held</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {formatCurrency(summary.reserve_held)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Net expected</p>
          <p className="text-xl sm:text-2xl font-bold text-green-700 mt-1 tabular-nums">
            {formatCurrency(summary.net_expected)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Reserve less {formatCurrency(summary.fees_accrued)} fees to date
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Approaching recourse</p>
          <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums ${
            Number(summary.approaching_recourse) > 0 ? 'text-orange-600' : 'text-slate-900'}`}>
            {summary.approaching_recourse}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">within 14 days</p>
        </div>
      </div>

      {Number(summary.approaching_recourse) > 0 && (
        <div className="card p-4 mb-5 border-orange-200 bg-orange-50 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-900">
              {summary.approaching_recourse} advance{Number(summary.approaching_recourse) === 1 ? '' : 's'} nearing recourse
            </p>
            <p className="text-sm text-orange-800 mt-0.5">
              If the customer hasn’t paid by the recourse date, the advance may be charged back.
              Chasing payment now is the cheapest fix.
            </p>
          </div>
        </div>
      )}

      <FundingRequests />

      <h2 className="text-base font-semibold text-slate-900 mb-3">Funded invoices</h2>
      <div className="filter-bar">
        <select
          className="input w-full sm:w-48"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="Filter advances"
        >
          <option value="outstanding">Outstanding</option>
          <option value="closed">Settled</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[52rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-header">Invoice</th>
              <th className="table-header">Customer</th>
              <th className="table-header">Job</th>
              <th className="table-header text-right">Face</th>
              <th className="table-header text-right">Advanced</th>
              <th className="table-header text-right">Reserve</th>
              <th className="table-header text-right">Net expected</th>
              <th className="table-header text-right">Days out</th>
              <th className="table-header text-right">Recourse</th>
              <th className="table-header">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500 text-sm">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <PiggyBank className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                  <p className="text-slate-500 text-sm">No advances in this view</p>
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="table-cell font-medium font-mono">{factoredInvoiceRef(a)}</td>
                <td className="table-cell">{a.debtor_name}</td>
                <td className="table-cell">
                  {a.job_id ? (
                    <Link to={`/jobs/${a.job_id}`} className="text-brand-600 hover:underline inline-flex items-center gap-1">
                      <FolderKanban className="w-3.5 h-3.5" />
                      {a.job_number ?? a.job_name}
                    </Link>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(a.face_amount)}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(a.advance_amount)}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(a.reserve_amount)}</td>
                <td className="table-cell text-right tabular-nums font-medium text-green-700">
                  {formatCurrency(a.net_expected)}
                </td>
                <td className="table-cell text-right tabular-nums">
                  {a.days_outstanding === null
                    ? <span className="text-slate-400">—</span>
                    : <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-400" />{a.days_outstanding}d</span>}
                </td>
                <td className="table-cell text-right tabular-nums">
                  <RecourseCell days={a.days_to_recourse} />
                </td>
                <td className="table-cell">
                  <span className={STATUS_BADGE[a.status] ?? 'badge-gray'}>
                    {a.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500 mt-3">
        Net expected is your reserve less fees accrued to date, and updates daily while an
        invoice is outstanding. Final figures are confirmed when the customer pays.
      </p>
    </div>
  );
}

interface FundingRequestRow {
  id: string; invoice_id: string; invoice_number: string | null; customer_name: string | null;
  requested_amount: string; status: string; requested_at: string; reviewed_at: string | null;
  decline_reason: string | null;
}

/**
 * Requests not yet turned into an advance: what's waiting on One Source, and
 * what was declined and why. Funded ones move to the table below.
 */
function FundingRequests() {
  const qc = useQueryClient();
  const { data } = useQuery<FundingRequestRow[]>({
    queryKey: ['factoring-requests'],
    queryFn: () => api.get('/factoring/requests').then((r) => r.data.data),
  });
  // Open requests, plus declines from the last 60 days.
  const cutoff = Date.now() - 60 * 86400_000;
  const rows = (data ?? []).filter((r) =>
    ['submitted', 'under_review'].includes(r.status)
    || (r.status === 'declined' && Date.parse(r.reviewed_at ?? r.requested_at) >= cutoff));

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
      {rows.length === 0 ? (
        <div className="card p-5 text-sm text-slate-500 flex items-center gap-3">
          <Send className="w-5 h-5 text-slate-300 flex-shrink-0" />
          <span>
            Nothing waiting. To request funding, open an invoice the agency has approved on the{' '}
            <Link to="/invoices" className="text-brand-600 hover:underline">Invoices</Link> page.
          </span>
        </div>
      ) : (
        <div className="card overflow-x-auto">
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
      )}
    </section>
  );
}
