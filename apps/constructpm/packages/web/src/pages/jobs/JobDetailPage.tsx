import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Calendar, DollarSign, MapPin, User, ClipboardList,
  BarChart3, FileText, Clock, Building2, ExternalLink
} from 'lucide-react';
import { api, formatCurrency, formatDate, formatPct } from '../../lib/api';

const STATUS_COLORS: Record<string, string> = {
  active: 'badge-green', bidding: 'badge-blue', lead: 'badge-gray',
  awarded: 'badge-yellow', on_hold: 'badge-orange', closed: 'badge-gray',
  substantially_complete: 'badge-green', cancelled: 'badge-red',
};

const CONTRACT_LABELS: Record<string, string> = {
  lump_sum: 'Lump Sum', gmp: 'GMP', cost_plus_fixed: 'Cost Plus Fixed Fee',
  cost_plus_pct: 'Cost Plus %', time_and_materials: 'T&M', unit_price: 'Unit Price',
};

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: jobData, isLoading } = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.get(`/jobs/${id}`).then(r => r.data.data),
  });

  const { data: summaryData } = useQuery({
    queryKey: ['job-summary', id],
    queryFn: () => api.get(`/jobs/${id}/summary`).then(r => r.data.data),
    enabled: !!id,
  });

  const { data: tasksData } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => api.get(`/tasks?job_id=${id}`).then(r => r.data.data),
    enabled: !!id,
  });

  const { data: logsData } = useQuery({
    queryKey: ['daily-logs', id],
    queryFn: () => api.get(`/daily-logs?job_id=${id}&per_page=5`).then(r => r.data.data),
    enabled: !!id,
  });

  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', id],
    queryFn: () => api.get(`/invoices?job_id=${id}`).then(r => r.data.data),
    enabled: !!id,
  });

  if (isLoading) return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-slate-200 rounded w-1/3" />
        <div className="h-40 bg-slate-200 rounded" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-200 rounded" />)}
        </div>
      </div>
    </div>
  );

  if (!jobData) return (
    <div className="p-6 max-w-7xl mx-auto text-center text-slate-500">Job not found</div>
  );

  const job = jobData;
  const summary = summaryData;
  const fin = summary?.financial;
  const tasks = tasksData?.tasks ?? [];
  const logs = Array.isArray(logsData) ? logsData : [];
  const invoices = Array.isArray(invoicesData) ? invoicesData : [];

  const taskStats = summary?.tasks ?? { total: 0, completed: 0, pct_complete: 0 };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/jobs')} className="btn-ghost btn-sm mt-1">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-sm font-mono text-slate-500">{job.job_number}</span>
            <span className={STATUS_COLORS[job.status] ?? 'badge-gray'}>{job.status?.replace('_', ' ')}</span>
            {job.contract_type && (
              <span className="badge badge-gray">{CONTRACT_LABELS[job.contract_type]}</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{job.name}</h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 flex-wrap">
            {job.customer_name && (
              <span className="flex items-center gap-1"><Building2 className="w-4 h-4" />{job.customer_name}</span>
            )}
            {(job.city || job.state_code) && (
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{[job.city, job.state_code].filter(Boolean).join(', ')}</span>
            )}
            {job.project_manager_name && (
              <span className="flex items-center gap-1"><User className="w-4 h-4" />{job.project_manager_name}</span>
            )}
            {job.start_date && (
              <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />{formatDate(job.start_date)}{job.end_date ? ` – ${formatDate(job.end_date)}` : ''}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link to={`/jobs/${id}/tasks`} className="btn-secondary btn-sm">
            <ClipboardList className="w-4 h-4" /> Tasks
          </Link>
          <Link to={`/jobs/${id}/budget`} className="btn-secondary btn-sm">
            <BarChart3 className="w-4 h-4" /> Budget
          </Link>
        </div>
      </div>

      {/* Financial KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Contract Value</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {job.contract_amount ? formatCurrency(job.contract_amount) : '—'}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Budget Cost</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {fin ? formatCurrency(fin.budget_cost) : '—'}
          </p>
          {fin?.budget_price && (
            <p className="text-xs text-green-600 mt-0.5">
              {formatCurrency(fin.gross_profit)} GP ({formatPct((fin.gross_profit / fin.budget_price) * 100)})
            </p>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Actual Cost</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {fin ? formatCurrency(fin.actual) : '—'}
          </p>
          {fin?.budget_cost > 0 && (
            <p className="text-xs text-slate-500 mt-0.5">
              {formatPct((fin.actual / fin.budget_cost) * 100)} of budget
            </p>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Invoiced</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {fin ? formatCurrency(fin.invoiced) : '—'}
          </p>
          {job.retainage_held > 0 && (
            <p className="text-xs text-orange-600 mt-0.5">{formatCurrency(job.retainage_held)} retainage held</p>
          )}
        </div>
      </div>

      {/* Task Progress */}
      {taskStats.total > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-700">Task Progress</h3>
            <Link to={`/jobs/${id}/tasks`} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
              View all <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-600 rounded-full transition-all"
                  style={{ width: `${taskStats.pct_complete}%` }}
                />
              </div>
            </div>
            <span className="text-sm font-semibold text-slate-900 w-12 text-right">
              {taskStats.pct_complete}%
            </span>
            <span className="text-xs text-slate-500">
              {taskStats.completed}/{taskStats.total} complete
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Daily Logs */}
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 text-sm">Recent Daily Logs</h3>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          {logs.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No logs yet</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {logs.slice(0, 4).map((log: Record<string, string>) => (
                <li key={log['id']} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-slate-500">{formatDate(log['log_date'])}</span>
                    {log['weather'] && <span className="text-xs text-slate-400">{log['weather']}</span>}
                  </div>
                  <p className="text-sm text-slate-700 line-clamp-2">{log['summary']}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent Invoices */}
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 text-sm">Invoices</h3>
            <Link to="/invoices" className="text-xs text-brand-600 hover:underline">View all</Link>
          </div>
          {invoices.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No invoices yet</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {invoices.slice(0, 4).map((inv: Record<string, unknown>) => (
                <li key={inv['id'] as string} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{inv['invoice_number'] as string}</p>
                    <p className="text-xs text-slate-500">Due {formatDate(inv['due_date'] as string)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatCurrency(inv['total'] as number)}</p>
                    <span className={
                      inv['status'] === 'paid' ? 'badge-green' :
                      inv['status'] === 'overdue' ? 'badge-red' :
                      inv['status'] === 'sent' ? 'badge-blue' : 'badge-gray'
                    }>{inv['status'] as string}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Job Details */}
      <div className="card p-4">
        <h3 className="font-semibold text-slate-900 mb-3 text-sm">Job Details</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Contract Type</p>
            <p className="font-medium">{CONTRACT_LABELS[job.contract_type] ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Retainage</p>
            <p className="font-medium">{job.retainage_pct ?? 10}%</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Prevailing Wage</p>
            <p className="font-medium">{job.prevailing_wage_required ? 'Yes' : 'No'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Created</p>
            <p className="font-medium">{formatDate(job.created_at)}</p>
          </div>
        </div>
        {job.description && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-1">Description</p>
            <p className="text-sm text-slate-700">{job.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
