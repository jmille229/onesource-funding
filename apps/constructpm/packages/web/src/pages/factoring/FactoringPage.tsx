import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Banknote, AlertTriangle, PiggyBank, Clock, FolderKanban } from 'lucide-react';
import { api, formatCurrency, formatDate } from '../../lib/api';

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-gray',
  advanced: 'badge-blue',
  collected: 'badge-yellow',
  closed: 'badge-green',
  charged_back: 'badge-red',
};

interface Advance {
  id: string;
  invoice_number: string;
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

  // Not a factoring client — say so plainly rather than showing empty tiles.
  if (!summary?.enabled) {
    return (
      <div className="page max-w-3xl mx-auto">
        <h1>Funding</h1>
        <div className="card p-8 mt-6 text-center">
          <Banknote className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-600 font-medium">No factoring facility on this account</p>
          <p className="text-sm text-slate-500 mt-1">
            Once OneSource funds an invoice for you, your advances and reserve will appear here.
          </p>
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
            Invoices factored with OneSource Funding
          </p>
        </div>
      </div>

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
                <td className="table-cell font-medium">{a.invoice_number}</td>
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
