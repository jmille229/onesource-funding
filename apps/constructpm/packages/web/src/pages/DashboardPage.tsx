import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DollarSign, FolderKanban, Clock, TrendingUp, ArrowRight, AlertCircle } from 'lucide-react';
import { api, formatCurrency, formatDate } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';
import type { Job, Invoice } from '@constructpm/shared';

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: React.ElementType; color: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

const statusColor: Record<string, string> = {
  active: 'badge-green', bidding: 'badge-blue', lead: 'badge-gray',
  awarded: 'badge-yellow', on_hold: 'badge-orange', closed: 'badge-gray',
  substantially_complete: 'badge-green', cancelled: 'badge-red',
};
const invoiceColor: Record<string, string> = {
  paid: 'badge-green', sent: 'badge-blue', draft: 'badge-gray',
  overdue: 'badge-red', partially_paid: 'badge-yellow', void: 'badge-gray',
};

export function DashboardPage() {
  const user = useAuthStore(s => s.user);

  const { data: dash } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/reports/dashboard').then(r => r.data.data),
  });
  const { data: jobsData } = useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api.get('/jobs?status=active&per_page=5').then(r => r.data),
  });
  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', 'recent'],
    queryFn: () => api.get('/invoices?per_page=5').then(r => r.data),
  });

  const jobs: Job[] = jobsData?.data ?? [];
  const invoices: Invoice[] = invoicesData?.data ?? [];
  const jobStats = dash?.jobs ?? [];
  const invStats = dash?.invoices ?? [];

  const activeJobs = jobStats.find((j: Record<string,unknown>) => j['status'] === 'active')?.count ?? 0;
  const totalValue = jobStats.reduce((s: number, j: Record<string,unknown>) => s + Number(j['total_value'] ?? 0), 0);
  const openAR = invStats.reduce((s: number, i: Record<string,unknown>) => s + Number(i['balance_due'] ?? 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Good morning, {user?.first_name} 👋</h1>
        <p className="text-slate-500 mt-0.5">Here's what's happening at Hartwell Construction today</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Jobs" value={String(activeJobs)} sub={`${jobStats.length} total projects`} icon={FolderKanban} color="bg-blue-50 text-blue-600" />
        <StatCard label="Portfolio Value" value={formatCurrency(totalValue, { short: true })} sub="Total contract value" icon={TrendingUp} color="bg-green-50 text-green-600" />
        <StatCard label="Open Receivables" value={formatCurrency(openAR, { short: true })} sub="Outstanding invoices" icon={DollarSign} color="bg-orange-50 text-orange-600" />
        <StatCard label="Hours (30d)" value={String(dash?.time_last_30d?.hours ?? 0)} sub={`${dash?.time_last_30d?.ot_hours ?? 0} OT hours`} icon={Clock} color="bg-purple-50 text-purple-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Jobs */}
        <div className="card">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3>Active Jobs</h3>
            <Link to="/jobs" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {jobs.length === 0 && (
              <div className="px-5 py-8 text-center text-slate-500">
                <FolderKanban className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm">No active jobs</p>
                <Link to="/jobs/new" className="btn-primary btn-sm mt-3 inline-flex">Create Job</Link>
              </div>
            )}
            {jobs.map(job => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center px-5 py-3.5 hover:bg-slate-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{job.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{job.job_number} · {job.customer_name ?? 'No customer'}</p>
                </div>
                <div className="text-right ml-4 flex-shrink-0">
                  <p className="text-sm font-medium text-slate-900">{formatCurrency(job.contract_amount, { short: true })}</p>
                  <span className={statusColor[job.status] ?? 'badge-gray'}>{job.status.replace('_', ' ')}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="card">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3>Recent Invoices</h3>
            <Link to="/invoices" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {invoices.length === 0 && (
              <div className="px-5 py-8 text-center text-slate-500">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm">No invoices yet</p>
              </div>
            )}
            {invoices.map(inv => (
              <div key={inv.id} className="flex items-center px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{inv.invoice_number}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{inv.customer_name} · Due {formatDate(inv.due_date)}</p>
                </div>
                <div className="text-right ml-4 flex-shrink-0">
                  <p className="text-sm font-medium">{formatCurrency(inv.total)}</p>
                  <span className={invoiceColor[inv.status] ?? 'badge-gray'}>{inv.status.replace('_', ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
