import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FolderKanban, ArrowRight, Banknote, Undo2, FileEdit, Hourglass, CalendarX, CheckCircle2,
  AlertTriangle, FileText,
} from 'lucide-react';
import { api, formatCurrency, formatDate } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';
import type { Job } from '@constructpm/shared';
import { invoiceStatusBadge, invoiceStatusLabel, fundedBadge, useInvoiceSummary, type InvoiceSummary } from '../lib/invoices';
import { useFundingAccount, ADVANCE_MAX } from '../lib/funding';
import { useWorkspace } from '../components/layout/AppLayout';
import { InvoiceDrawer } from '../components/invoices/InvoiceDrawer';

interface InvoiceRow {
  id: string; invoice_number: string; customer_name: string | null; status: string;
  total: string; balance_due: string; issue_date: string; due_date: string;
  submitted_on: string | null; created_at: string; funded_id: string | null; funded_status: string | null;
}

/** How long an agency can sit on an invoice before it's worth a call. */
const SLOW_APPROVAL_DAYS = 30;

const statusColor: Record<string, string> = {
  active: 'badge-green', bidding: 'badge-blue', lead: 'badge-gray',
  awarded: 'badge-yellow', on_hold: 'badge-orange', closed: 'badge-gray',
  substantially_complete: 'badge-green', cancelled: 'badge-red',
};

/**
 * Home, for every company: where its invoices stand and what needs doing.
 * Funding appears for a company that factors (and the way in for one that
 * doesn't); the project cards appear only with the project tools on.
 */
export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const funding = useFundingAccount();
  const projectTools = useWorkspace()?.projectTools ?? false;
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: company } = useQuery({
    queryKey: ['company-settings', user?.company_id],
    queryFn: () => api.get('/settings/company').then((r) => r.data.data as { name: string }),
  });
  // Totals over every invoice, from the server; and the six most recently logged.
  const { data: sm } = useInvoiceSummary();
  const { data: recent = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices', 'recent'],
    queryFn: () => api.get('/invoices', { params: { sort: 'created', per_page: 6 } }).then((r) => r.data.data),
  });

  const nearingRecourse = Number(funding.summary?.['approaching_recourse'] ?? 0);
  const n = (k: keyof InvoiceSummary) => Number(sm?.[k] ?? 0);

  // Needs attention, most actionable first. Past due leaves out funded
  // invoices: One Source collects open ones (the recourse warning covers
  // those), and a settled one's leftover balance is a short payment already
  // squared away through the reserve.
  const attention: { key: string; icon: typeof Undo2; tone: string; text: string; sub?: string; to: string }[] = [];
  if (n('returned_count')) attention.push({ key: 'returned', icon: Undo2, tone: 'text-orange-600',
    text: `${n('returned_count')} returned by the agency`, sub: 'Fix and resubmit', to: '/invoices?status=returned' });
  if (nearingRecourse) attention.push({ key: 'recourse', icon: AlertTriangle, tone: 'text-orange-600',
    text: `${nearingRecourse} funded invoice${nearingRecourse === 1 ? '' : 's'} nearing recourse`, sub: 'Chase the agency for payment', to: '/funding' });
  if (n('past_due_count')) attention.push({ key: 'pastdue', icon: CalendarX, tone: 'text-red-600',
    text: `${n('past_due_count')} approved but past due`, sub: `${formatCurrency(n('past_due_amount'))} still unpaid`, to: '/invoices?status=approved' });
  if (n('slow_count')) attention.push({ key: 'slow', icon: Hourglass, tone: 'text-amber-600',
    text: `${n('slow_count')} waiting over ${SLOW_APPROVAL_DAYS} days for approval`, sub: 'Worth a call to the agency', to: '/invoices?status=sent' });
  if (funding.isActive && n('eligible_count')) attention.push({ key: 'fund', icon: Banknote, tone: 'text-green-600',
    text: `${n('eligible_count')} approved invoice${n('eligible_count') === 1 ? '' : 's'} ready to fund`,
    sub: `Up to ${formatCurrency(n('eligible_amount') * ADVANCE_MAX)}`, to: '/invoices?view=eligible' });
  if (n('draft_count')) attention.push({ key: 'drafts', icon: FileEdit, tone: 'text-slate-500',
    text: `${n('draft_count')} not submitted yet`, sub: 'Mark them submitted once billed', to: '/invoices?status=draft' });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{greeting}, {user?.first_name}</h1>
        <p className="text-slate-500 mt-0.5">
          Here&rsquo;s where your invoices stand{company?.name ? ` at ${company.name}` : ''}
        </p>
      </div>

      {/* The way in, for a company that doesn't factor yet. */}
      {funding.isProspect && n('approved_unfunded_amount') > 0 && (
        <Link to="/funding"
              className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-4 sm:p-5 hover:border-emerald-300">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
            <Banknote className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-slate-900">
              {formatCurrency(n('approved_unfunded_amount'))} approved by agencies and not yet paid
            </p>
            <p className="text-sm text-slate-600">
              Get up to {formatCurrency(n('approved_unfunded_amount') * ADVANCE_MAX)} of it now with One Source — often the same day.
            </p>
          </div>
          <span className="btn btn-sm bg-emerald-600 text-white self-start sm:self-center">
            Get paid now <ArrowRight className="w-4 h-4" />
          </span>
        </Link>
      )}

      {/* Invoices */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Outstanding" value={formatCurrency(n('outstanding_amount'))} sub={`${n('outstanding_count')} invoice${n('outstanding_count') === 1 ? '' : 's'} with agencies`} to="/invoices" />
        <Stat label="Waiting on approval" value={formatCurrency(n('awaiting_amount'))} sub={`${n('awaiting_count')} submitted`} to="/invoices?status=sent" />
        <Stat label="Approved, awaiting payment" value={formatCurrency(n('payable_amount'))} sub={`${n('payable_count')} approved`} to="/invoices?status=approved" />
        <Stat label="Billed this month" value={formatCurrency(n('billed_this_month'))}
              sub={new Date().toLocaleDateString('en-US', { month: 'long' })} />
      </div>

      {/* Funding, for a company that factors */}
      {funding.isClient && funding.summary && (
        <Link to="/funding" className="card p-4 sm:p-5 block hover:border-brand-300">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Banknote className="w-4 h-4 text-brand-600" /> Funding
            </h2>
            <span className="text-sm text-brand-600">Open Funding →</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Figure label="Available to fund" value={funding.summary['funding_available'] as number | null | undefined} tone="green" />
            <Figure label="Out with agencies" value={funding.summary['advanced_outstanding'] as string}
                    sub={`${Number(funding.summary['outstanding_count'] ?? 0)} advance${Number(funding.summary['outstanding_count'] ?? 0) === 1 ? '' : 's'}`} />
            <Figure label="Net expected back" value={funding.summary['net_expected'] as string} />
            <div>
              <p className="text-xs text-slate-500">Nearing recourse</p>
              <p className={`text-lg font-bold tabular-nums ${nearingRecourse ? 'text-orange-600' : 'text-slate-900'}`}>{nearingRecourse}</p>
              <p className="text-xs text-slate-400">within 14 days</p>
            </div>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="px-5 py-4 border-b border-slate-200"><h3>Needs attention</h3></div>
          {attention.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-500">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
              <p className="text-sm">{n('total_count') ? 'Nothing needs you right now.' : 'Log an invoice to start tracking it.'}</p>
              {!n('total_count') && <Link to="/invoices" className="btn-primary btn-sm mt-3 inline-flex">Go to Invoices</Link>}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                    <a.icon className={`w-5 h-5 flex-shrink-0 ${a.tone}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{a.text}</p>
                      {a.sub && <p className="text-xs text-slate-500">{a.sub}</p>}
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3>Recent invoices</h3>
            <Link to="/invoices" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {recent.length === 0 && (
              <div className="px-5 py-8 text-center text-slate-500">
                <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm">No invoices yet</p>
              </div>
            )}
            {recent.map((inv) => {
              const funded = funding.isClient ? fundedBadge(inv.funded_status) : null;
              return (
                <button key={inv.id} onClick={() => setOpenId(inv.id)}
                        className="w-full flex items-center px-5 py-3.5 text-left hover:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 font-mono">{inv.invoice_number}</p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{inv.customer_name} · Due {formatDate(inv.due_date)}</p>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <p className="text-sm font-medium tabular-nums">{formatCurrency(inv.total)}</p>
                    <span className={invoiceStatusBadge(inv.status)}>{invoiceStatusLabel(inv.status)}</span>
                    {funded && <span className={`${funded.badge} ml-1`}>{funded.label}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {projectTools && <ProjectCards />}

      {openId && <InvoiceDrawer invoiceId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Stat({ label, value, sub, to }: { label: string; value: string; sub?: string; to?: string }) {
  const body = (
    <>
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </>
  );
  return to
    ? <Link to={to} className="card p-4 block hover:border-brand-300">{body}</Link>
    : <div className="card p-4">{body}</div>;
}

function Figure({ label, value, sub, tone }: { label: string; value: number | string | null | undefined; sub?: string; tone?: 'green' }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'green' ? 'text-green-700' : 'text-slate-900'}`}>
        {value === null || value === undefined ? '—' : formatCurrency(value)}
      </p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

/** Jobs, contract value and hours — for companies with the project tools on. */
function ProjectCards() {
  const { data: dash } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/reports/dashboard').then((r) => r.data.data),
  });
  const { data: jobsData } = useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api.get('/jobs?status=active&per_page=5').then((r) => r.data),
  });
  const jobs: Job[] = jobsData?.data ?? [];
  const jobStats = (dash?.jobs ?? []) as Record<string, unknown>[];
  const activeJobs = jobStats.find((j) => j['status'] === 'active')?.['count'] ?? 0;
  const totalValue = jobStats.reduce((s, j) => s + Number(j['total_value'] ?? 0), 0);

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Projects</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Active jobs" value={String(activeJobs)} sub={`${jobStats.reduce((s, j) => s + Number(j['count'] ?? 0), 0)} total`} to="/jobs" />
        <Stat label="Contract value" value={formatCurrency(totalValue, { short: true })} sub="All jobs" />
        <Stat label="Hours (30 days)" value={String(dash?.time_last_30d?.hours ?? 0)} sub={`${dash?.time_last_30d?.ot_hours ?? 0} overtime`} />
      </div>
      <div className="card">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3>Active jobs</h3>
          <Link to="/jobs" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {jobs.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-500">
              <FolderKanban className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="text-sm">No active jobs</p>
              <Link to="/jobs/new" className="btn-primary btn-sm mt-3 inline-flex">Create job</Link>
            </div>
          )}
          {jobs.map((job) => (
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
      <p className="text-xs text-slate-400">Project tools are on. You can turn them off in Settings.</p>
    </section>
  );
}
