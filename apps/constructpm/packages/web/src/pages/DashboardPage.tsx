import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FolderKanban, ArrowRight, Banknote, Undo2, FileEdit, Hourglass, CalendarX, CheckCircle2,
  AlertTriangle, FileText,
} from 'lucide-react';
import { api, formatCurrency, formatDate, todayISO } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';
import type { Job } from '@constructpm/shared';
import { invoiceStatusBadge, invoiceStatusLabel, isAwaitingAgency, daysSince, fundedBadge } from '../lib/invoices';
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
  const { data: invoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices', ''],
    queryFn: () => api.get('/invoices?status=').then((r) => r.data.data),
  });
  const { data: requests = [] } = useQuery<{ invoice_id: string; status: string }[]>({
    queryKey: ['factoring-requests'],
    queryFn: () => api.get('/factoring/requests').then((r) => r.data.data).catch(() => []),
    enabled: funding.isActive,
  });

  const today = todayISO();
  const open = invoices.filter((i) => !['draft', 'paid', 'void'].includes(i.status));
  const sum = (rows: InvoiceRow[]) => rows.reduce((s, i) => s + Number(i.balance_due), 0);
  const awaiting = invoices.filter((i) => isAwaitingAgency(i.status));
  const approved = invoices.filter((i) => ['approved', 'partially_paid'].includes(i.status) && Number(i.balance_due) > 0);
  const billedThisMonth = invoices
    .filter((i) => !['draft', 'void'].includes(i.status) && i.issue_date.slice(0, 7) === today.slice(0, 7))
    .reduce((s, i) => s + Number(i.total), 0);

  // Needs attention, most actionable first.
  const returned = invoices.filter((i) => i.status === 'returned');
  const drafts = invoices.filter((i) => i.status === 'draft');
  const slow = awaiting.filter((i) => (daysSince(i.submitted_on) ?? 0) > SLOW_APPROVAL_DAYS);
  // Funded ones aren't the client's to chase: One Source collects open ones
  // (the recourse warning covers those), and a settled one's leftover
  // balance is a short payment already squared away through the reserve.
  const pastDue = approved.filter((i) => i.due_date.slice(0, 10) < today && !i.funded_id);
  const inFlight = new Set(requests.filter((r) => ['submitted', 'under_review', 'approved'].includes(r.status)).map((r) => r.invoice_id));
  const readyToFund = invoices.filter((i) => i.status === 'approved' && Number(i.balance_due) > 0 && !i.funded_id && !inFlight.has(i.id));
  const nearingRecourse = Number(funding.summary?.['approaching_recourse'] ?? 0);
  const prospectApproved = funding.isProspect ? invoices.filter((i) => i.status === 'approved' && Number(i.balance_due) > 0) : [];

  const attention: { key: string; icon: typeof Undo2; tone: string; text: string; sub?: string; to: string }[] = [];
  if (returned.length) attention.push({ key: 'returned', icon: Undo2, tone: 'text-orange-600',
    text: `${returned.length} returned by the agency`, sub: 'Fix and resubmit', to: '/invoices?status=returned' });
  if (nearingRecourse) attention.push({ key: 'recourse', icon: AlertTriangle, tone: 'text-orange-600',
    text: `${nearingRecourse} funded invoice${nearingRecourse === 1 ? '' : 's'} nearing recourse`, sub: 'Chase the agency for payment', to: '/funding' });
  if (pastDue.length) attention.push({ key: 'pastdue', icon: CalendarX, tone: 'text-red-600',
    text: `${pastDue.length} approved but past due`, sub: `${formatCurrency(sum(pastDue))} still unpaid`, to: '/invoices?status=approved' });
  if (slow.length) attention.push({ key: 'slow', icon: Hourglass, tone: 'text-amber-600',
    text: `${slow.length} waiting over ${SLOW_APPROVAL_DAYS} days for approval`, sub: 'Worth a call to the agency', to: '/invoices?status=sent' });
  if (funding.isActive && readyToFund.length) attention.push({ key: 'fund', icon: Banknote, tone: 'text-green-600',
    text: `${readyToFund.length} approved invoice${readyToFund.length === 1 ? '' : 's'} ready to fund`,
    sub: `Up to ${formatCurrency(sum(readyToFund) * ADVANCE_MAX)}`, to: '/invoices?view=eligible' });
  if (drafts.length) attention.push({ key: 'drafts', icon: FileEdit, tone: 'text-slate-500',
    text: `${drafts.length} not submitted yet`, sub: 'Mark them submitted once billed', to: '/invoices?status=draft' });

  const recent = [...invoices].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
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
      {funding.isProspect && sum(prospectApproved) > 0 && (
        <Link to="/funding"
              className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-4 sm:p-5 hover:border-emerald-300">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
            <Banknote className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-slate-900">
              {formatCurrency(sum(prospectApproved))} approved by agencies and not yet paid
            </p>
            <p className="text-sm text-slate-600">
              Get up to {formatCurrency(sum(prospectApproved) * ADVANCE_MAX)} of it now with One Source — often the same day.
            </p>
          </div>
          <span className="btn btn-sm bg-emerald-600 text-white self-start sm:self-center">
            Get paid now <ArrowRight className="w-4 h-4" />
          </span>
        </Link>
      )}

      {/* Invoices */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Outstanding" value={formatCurrency(sum(open))} sub={`${open.length} invoice${open.length === 1 ? '' : 's'} with agencies`} to="/invoices" />
        <Stat label="Waiting on approval" value={formatCurrency(sum(awaiting))} sub={`${awaiting.length} submitted`} to="/invoices?status=sent" />
        <Stat label="Approved, awaiting payment" value={formatCurrency(sum(approved))} sub={`${approved.length} approved`} to="/invoices?status=approved" />
        <Stat label="Billed this month" value={formatCurrency(billedThisMonth)}
              sub={new Date(`${today}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })} />
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
              <p className="text-sm">{invoices.length ? 'Nothing needs you right now.' : 'Log an invoice to start tracking it.'}</p>
              {!invoices.length && <Link to="/invoices" className="btn-primary btn-sm mt-3 inline-flex">Go to Invoices</Link>}
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
