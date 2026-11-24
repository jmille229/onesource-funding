import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, FolderKanban } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api';
import { leftToBill } from '../../lib/jobs';
import type { Job } from '@constructpm/shared';

const STATUS_OPTIONS = ['','lead','bidding','awarded','active','on_hold','substantially_complete','closed','cancelled'];
const STATUS_COLORS: Record<string, string> = {
  active:'badge-green', bidding:'badge-blue', lead:'badge-gray', awarded:'badge-yellow',
  on_hold:'badge-orange', closed:'badge-gray', substantially_complete:'badge-green', cancelled:'badge-red',
};

export function JobsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', search, status],
    queryFn: () => api.get(`/jobs?search=${search}&status=${status}&per_page=50`).then(r => r.data),
    staleTime: 10_000,
  });

  const jobs: Job[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  return (
    <div className="page max-w-7xl mx-auto">
      <div className="page-header">
        <div>
          <h1>Jobs</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} job{total === 1 ? '' : 's'} · group invoices by contract to see what’s billed and what’s left
          </p>
        </div>
        <Link to="/jobs/new" className="btn-primary">
          <Plus className="w-4 h-4" /> New job
        </Link>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search jobs..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-full sm:w-44" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[40rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-header">Job</th>
              <th className="table-header">Agency</th>
              <th className="table-header">Status</th>
              <th className="table-header text-right">Contract</th>
              <th className="table-header text-right">Billed</th>
              <th className="table-header text-right">Left to bill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Loading...</td></tr>
            )}
            {!isLoading && jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <FolderKanban className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                  {search || status ? (
                    <p className="text-slate-500 text-sm">No jobs match</p>
                  ) : (
                    <>
                      <p className="text-slate-700 text-sm font-medium">Group your invoices by job</p>
                      <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
                        A job is a contract or project. Add its value and every invoice you log against it shows
                        what you’ve billed, what’s been paid, and what’s left to bill. Optional — invoices don’t need one.
                      </p>
                      <Link to="/jobs/new" className="btn-primary btn-sm mt-4 inline-flex">Create your first job</Link>
                      <p className="text-xs text-slate-400 mt-2">You can also create one while logging an invoice.</p>
                    </>
                  )}
                </td>
              </tr>
            )}
            {jobs.map(job => (
              <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                <td className="table-cell">
                  <Link to={`/jobs/${job.id}`} className="font-medium text-brand-600 hover:text-brand-700 hover:underline">{job.name}</Link>
                  <p className="text-xs text-slate-500 mt-0.5">{job.job_number}</p>
                </td>
                <td className="table-cell text-slate-600">{job.customer_name ?? '—'}</td>
                <td className="table-cell">
                  <span className={STATUS_COLORS[job.status] ?? 'badge-gray'}>{job.status.replace(/_/g,' ')}</span>
                </td>
                <td className="table-cell text-right font-medium tabular-nums">
                  {job.contract_amount ? formatCurrency(job.contract_amount) : <span className="text-slate-400">—</span>}
                </td>
                <td className="table-cell text-right tabular-nums">
                  {formatCurrency(job.billed ?? 0)}
                  <p className="text-xs text-slate-500">{job.invoice_count ?? 0} invoice{job.invoice_count === 1 ? '' : 's'}</p>
                </td>
                <td className="table-cell text-right tabular-nums">
                  {(() => {
                    const left = leftToBill(job.contract_amount, job.billed);
                    if (left === null) return <span className="text-slate-400">—</span>;
                    if (left < 0) return <span className="text-amber-700">{formatCurrency(-left)} over</span>;
                    return formatCurrency(left);
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
