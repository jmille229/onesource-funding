import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, FolderKanban } from 'lucide-react';
import { api, formatCurrency, formatDate } from '../../lib/api';
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
          <p className="text-sm text-slate-500 mt-0.5">{total} total projects</p>
        </div>
        <Link to="/jobs/new" className="btn-primary">
          <Plus className="w-4 h-4" /> New Job
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
              <th className="table-header">Customer</th>
              <th className="table-header">Status</th>
              <th className="table-header text-right">Contract</th>
              <th className="table-header text-right">Budget</th>
              <th className="table-header">Dates</th>
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
                  <p className="text-slate-500 text-sm">No jobs found</p>
                  <Link to="/jobs/new" className="btn-primary btn-sm mt-4 inline-flex">Create your first job</Link>
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
                <td className="table-cell text-right font-medium">{formatCurrency(job.contract_amount)}</td>
                <td className="table-cell text-right">{formatCurrency(job.total_budget)}</td>
                <td className="table-cell text-slate-500 text-xs">
                  {formatDate(job.start_date)} — {formatDate(job.end_date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
