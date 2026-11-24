import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Calendar, MapPin, User, ClipboardList, BarChart3, Building2, HardHat, Plus, Clock, ExternalLink,
} from 'lucide-react';
import { api, formatCurrency, formatDate, formatPct } from '../../lib/api';
import { invoiceStatusBadge, invoiceStatusLabel, canEditInvoices, fundedBadge } from '../../lib/invoices';
import { useFundingAccount } from '../../lib/funding';
import { billedPct } from '../../lib/jobs';
import { LogInvoiceModal } from '../../components/invoices/LogInvoiceModal';
import { InvoiceDrawer } from '../../components/invoices/InvoiceDrawer';
import { useAuthStore } from '../../stores/auth.store';

const STATUS_COLORS: Record<string, string> = {
  active: 'badge-green', bidding: 'badge-blue', lead: 'badge-gray',
  awarded: 'badge-yellow', on_hold: 'badge-orange', closed: 'badge-gray',
  substantially_complete: 'badge-green', cancelled: 'badge-red',
};

const CONTRACT_LABELS: Record<string, string> = {
  lump_sum: 'Lump sum', gmp: 'GMP', cost_plus_fixed: 'Cost plus fixed fee',
  cost_plus_pct: 'Cost plus %', time_and_materials: 'T&M', unit_price: 'Unit price',
};

interface Billing {
  contract_amount: number | null; billed: number; paid: number; outstanding: number; funded: number;
  invoice_count: number; draft_count: number; left_to_bill: number | null;
}
interface Summary {
  billing: Billing;
  financial: { budget: number; price: number; committed: number; actual: number; invoiced: number };
  tasks: { total: number; completed: number; in_progress: number; pct: number };
}
interface InvoiceRow {
  id: string; invoice_number: string; status: string; total: string; balance_due: string;
  due_date: string | null; funded_status?: string | null;
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-nums">{value}</p>
      {sub && <p className={tone === 'warn' ? 'text-xs text-amber-700 mt-0.5' : 'text-xs text-slate-500 mt-0.5'}>{sub}</p>}
    </div>
  );
}

/**
 * A job, invoicing first: what the contract is worth, what's been billed and
 * paid against it, and its invoices. The project tools (budget, tasks,
 * subcontractors, daily logs) sit below, showing their figures once used.
 */
export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const funding = useFundingAccount();
  const [logging, setLogging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: job, isLoading } = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.get(`/jobs/${id}`).then((r) => r.data.data),
  });
  const { data: summary } = useQuery<Summary>({
    // Under ['invoices', …]: the figures come from the invoices, so anything
    // that changes an invoice (logging, paying, voiding) refreshes them too.
    queryKey: ['invoices', 'job-summary', id],
    queryFn: () => api.get(`/jobs/${id}/summary`).then((r) => r.data.data),
    enabled: !!id,
  });
  const { data: invoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices', 'job', id],
    queryFn: () => api.get('/invoices', { params: { job_id: id, per_page: 100, sort: 'created' } }).then((r) => r.data.data),
    enabled: !!id,
  });
  const { data: logs = [] } = useQuery<Record<string, string>[]>({
    queryKey: ['daily-logs', id],
    queryFn: () => api.get(`/daily-logs?job_id=${id}&per_page=5`).then((r) => (Array.isArray(r.data.data) ? r.data.data : [])),
    enabled: !!id,
  });

  if (isLoading) return (
    <div className="page max-w-7xl mx-auto">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-slate-200 rounded w-1/3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-200 rounded" />)}
        </div>
        <div className="h-40 bg-slate-200 rounded" />
      </div>
    </div>
  );
  if (!job) return <div className="page max-w-7xl mx-auto text-center text-slate-500">Job not found</div>;

  const b = summary?.billing;
  const fin = summary?.financial;
  const tasks = summary?.tasks;
  const pct = billedPct(job.contract_amount, b?.billed);
  const showFunded = funding.isClient && (b?.funded ?? 0) > 0;
  const usesBudget = (fin?.budget ?? 0) > 0 || (fin?.price ?? 0) > 0;
  const usesTasks = (tasks?.total ?? 0) > 0;

  return (
    <div className="page max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <button onClick={() => navigate('/jobs')} className="btn-ghost btn-sm mt-1" aria-label="Back to jobs">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0 basis-64">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-mono text-slate-500">{job.job_number}</span>
            <span className={STATUS_COLORS[job.status] ?? 'badge-gray'}>{job.status?.replace(/_/g, ' ')}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{job.name}</h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 flex-wrap">
            {job.customer_name && <span className="flex items-center gap-1"><Building2 className="w-4 h-4" />{job.customer_name}</span>}
            {(job.city || job.state_code) && (
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{[job.city, job.state_code].filter(Boolean).join(', ')}</span>
            )}
            {job.project_manager_name && <span className="flex items-center gap-1"><User className="w-4 h-4" />{job.project_manager_name}</span>}
            {job.start_date && (
              <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />
                {formatDate(job.start_date)}{job.end_date ? ` – ${formatDate(job.end_date)}` : ''}</span>
            )}
          </div>
        </div>
        {canEditInvoices(role) && (
          <button onClick={() => setLogging(true)} className="btn-primary w-full sm:w-auto">
            <Plus className="w-4 h-4" /> Log invoice
          </button>
        )}
      </div>

      {/* Billing against the contract */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Figure label="Contract value" value={job.contract_amount ? formatCurrency(job.contract_amount) : '—'}
                sub={b?.left_to_bill == null ? 'No contract value set'
                  : b.left_to_bill < 0 ? `${formatCurrency(-b.left_to_bill)} billed over the contract`
                  : `${formatCurrency(b.left_to_bill)} left to bill`}
                tone={b?.left_to_bill != null && b.left_to_bill < 0 ? 'warn' : undefined} />
        <Figure label="Billed" value={formatCurrency(b?.billed ?? 0)}
                sub={`${b?.invoice_count ?? 0} invoice${b?.invoice_count === 1 ? '' : 's'}${b?.draft_count ? ` · ${b.draft_count} not sent yet` : ''}`} />
        <Figure label="Paid" value={formatCurrency(b?.paid ?? 0)}
                sub={b && b.paid > 0 && b.billed > 0 ? `${formatPct((b.paid / b.billed) * 100)} of billed` : 'Nothing paid yet'} />
        <Figure label="Outstanding" value={formatCurrency(b?.outstanding ?? 0)}
                sub={showFunded ? `${formatCurrency(b!.funded)} funded by One Source` : 'Owed by the agency'} />
      </div>
      {pct !== null && (
        <div className="card p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-slate-700">Billed against the contract</span>
            <span className="tabular-nums text-slate-600">{pct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-600 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Invoices */}
      <section className="card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900 text-sm">Invoices</h2>
          {canEditInvoices(role) && (
            <button onClick={() => setLogging(true)} className="text-sm text-brand-600 hover:underline">Log invoice</button>
          )}
        </div>
        {invoices.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            No invoices on this job yet. Log one here, or pick this job when you log an invoice.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invoices.map((inv) => {
              const funded = funding.isClient ? fundedBadge(inv.funded_status) : null;
              return (
                <li key={inv.id}>
                  <button onClick={() => setOpenId(inv.id)}
                          className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 font-mono truncate">{inv.invoice_number}</p>
                      <p className="text-xs text-slate-500">{inv.due_date ? `Due ${formatDate(inv.due_date)}` : 'No due date'}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{formatCurrency(inv.total)}</p>
                      <div className="flex gap-1 justify-end mt-0.5 flex-wrap">
                        <span className={invoiceStatusBadge(inv.status)}>{invoiceStatusLabel(inv.status)}</span>
                        {funded && <span className={funded.badge}>{funded.label}</span>}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Details */}
      <section className="card p-4">
        <h2 className="font-semibold text-slate-900 mb-3 text-sm">Job details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div><p className="text-xs text-slate-500 mb-0.5">Contract type</p><p className="font-medium">{CONTRACT_LABELS[job.contract_type] ?? '—'}</p></div>
          <div><p className="text-xs text-slate-500 mb-0.5">Retainage</p><p className="font-medium">{job.retainage_pct ?? 10}%</p></div>
          <div><p className="text-xs text-slate-500 mb-0.5">Prevailing wage</p><p className="font-medium">{job.prevailing_wage_required ? 'Yes' : 'No'}</p></div>
          <div><p className="text-xs text-slate-500 mb-0.5">Created</p><p className="font-medium">{formatDate(job.created_at)}</p></div>
        </div>
        {job.description && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-1">Description</p>
            <p className="text-sm text-slate-700">{job.description}</p>
          </div>
        )}
      </section>

      {/* Project tools: always reachable, figures once they're in use */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Project tools</h2>
            <p className="text-sm text-slate-500">Budget, tasks and subcontractors for this job, if you track them here.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link to={`/jobs/${id}/budget`} className="btn-secondary btn-sm"><BarChart3 className="w-4 h-4" /> Budget</Link>
            <Link to={`/jobs/${id}/tasks`} className="btn-secondary btn-sm"><ClipboardList className="w-4 h-4" /> Tasks</Link>
            <Link to={`/jobs/${id}/subcontracts`} className="btn-secondary btn-sm"><HardHat className="w-4 h-4" /> Subcontractors</Link>
          </div>
        </div>

        {usesBudget && fin && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Figure label="Budgeted cost" value={formatCurrency(fin.budget)}
                    sub={fin.price > 0 ? `${formatCurrency(fin.price - fin.budget)} planned profit` : undefined} />
            <Figure label="Committed" value={formatCurrency(fin.committed)} />
            <Figure label="Actual cost" value={formatCurrency(fin.actual)}
                    sub={fin.budget > 0 ? `${formatPct((fin.actual / fin.budget) * 100)} of budget` : undefined}
                    tone={fin.budget > 0 && fin.actual > fin.budget ? 'warn' : undefined} />
          </div>
        )}

        {usesTasks && tasks && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-700">Task progress</h3>
              <Link to={`/jobs/${id}/tasks`} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                View all <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-brand-600 rounded-full" style={{ width: `${tasks.pct}%` }} />
              </div>
              <span className="text-sm font-semibold text-slate-900 w-12 text-right">{tasks.pct}%</span>
              <span className="text-xs text-slate-500">{tasks.completed}/{tasks.total} complete</span>
            </div>
          </div>
        )}

        {logs.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900 text-sm">Recent daily logs</h3>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <ul className="divide-y divide-slate-100">
              {logs.slice(0, 4).map((log) => (
                <li key={log['id']} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-slate-500">{formatDate(log['log_date'])}</span>
                    {log['weather'] && <span className="text-xs text-slate-400">{log['weather']}</span>}
                  </div>
                  <p className="text-sm text-slate-700 line-clamp-2">{log['summary']}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {logging && id && <LogInvoiceModal defaultJobId={id} onClose={() => setLogging(false)} />}
      {openId && <InvoiceDrawer invoiceId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
