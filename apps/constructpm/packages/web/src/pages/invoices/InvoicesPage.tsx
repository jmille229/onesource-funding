import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, FileText, Search, Banknote, Paperclip, Lock, ArrowRight, X } from 'lucide-react';
import { clsx } from 'clsx';
import { api, formatCurrency, formatDate } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import {
  type InvoiceAction, invoiceStatusBadge, invoiceStatusLabel, isAwaitingAgency, nextAction,
  canEditInvoices, canRecordPayments, FUNDING_BADGE, FUNDING_LABEL, daysSince, isFundedOpen,
  fundedBadge, useInvoiceSummary,
} from '../../lib/invoices';

const PAGE_SIZE = 100;
import { useFundingAccount, ADVANCE_MAX, dismiss, dismissedRecently } from '../../lib/funding';
import { LogInvoiceModal } from '../../components/invoices/LogInvoiceModal';
import { InvoiceDrawer } from '../../components/invoices/InvoiceDrawer';
import { InvoiceActionModal, type ActionInvoice } from '../../components/invoices/InvoiceActionModal';
import { RequestFundingModal } from '../../components/RequestFundingModal';

interface InvoiceRow extends ActionInvoice {
  job_name: string | null;
  job_number: string | null;
  contract_reference: string | null;
  submitted_on: string | null;
  approved_on: string | null;
  due_date: string;
  document_count: number;
  has_approval_doc: boolean;
  funded_status: string | null;
  funded_id: string | null;
  funded_on: string | null;
}

// Filter options, in the order an invoice moves through them.
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'draft', label: 'Not submitted' },
  { value: 'sent', label: 'Submitted to agency' },
  { value: 'returned', label: 'Returned for correction' },
  { value: 'approved', label: 'Approved by agency' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

type FundingView = 'all' | 'funded' | 'not_funded' | 'eligible';

/** "Where is it with the agency" in a few words, for the list. */
function stageNote(inv: InvoiceRow): string {
  if (isFundedOpen(inv.funded_status) && ['approved', 'partially_paid'].includes(inv.status)) {
    return 'Funded · agency pays One Source';
  }
  if (isAwaitingAgency(inv.status) && inv.submitted_on) {
    const d = daysSince(inv.submitted_on);
    return d === 0 ? 'Submitted today' : `Waiting ${d} day${d === 1 ? '' : 's'}`;
  }
  if (inv.status === 'approved' && inv.approved_on) return `Approved ${formatDate(inv.approved_on)}`;
  return '';
}

/**
 * Invoices: a tracker for what has been billed to each agency and where it
 * stands. The contractor bills the agency however they already do; this page
 * records each step — submitted, approved or returned, paid.
 *
 * Funding is a layer on the same list, never a separate place:
 *   a company that factors sees which invoices One Source funded (history
 *     included), can filter to them, and requests funding from approved ones;
 *   a company that doesn't sees what its approved invoices could turn into
 *     now, and the way in.
 */
export function InvoicesPage() {
  const role = useAuthStore((s) => s.user?.role);
  const funding = useFundingAccount();
  // Jobs are a project-tools idea: with them off, an invoice shows its contract.
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ invoice: InvoiceRow; action: InvoiceAction } | null>(null);
  const [fundingFor, setFundingFor] = useState<InvoiceRow | null>(null);
  const [search, setSearch] = useState('');

  // ?view=eligible and ?status=returned etc., so the dashboard and the
  // Funding page can link straight to a filtered list.
  const [params] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(() =>
    STATUS_FILTERS.some((f) => f.value === params.get('status')) ? params.get('status')! : '');
  const [view, setView] = useState<FundingView>(() => {
    const v = params.get('view');
    return v === 'funded' || v === 'not_funded' || v === 'eligible' ? v : 'all';
  });
  const [bannerHidden, setBannerHidden] = useState(() => dismissedRecently('get-paid-banner', 14));

  // Which invoices already have a funding request, so the row shows its status
  // instead of offering to request again.
  const { data: fundingRequests } = useQuery({
    queryKey: ['factoring-requests'],
    queryFn: () => api.get('/factoring/requests').then((r) => r.data.data).catch(() => []),
    enabled: funding.isClient,
  });
  // The API lists newest first; keep the latest non-withdrawn request per invoice.
  const fundingByInvoice: Record<string, string> = {};
  for (const r of (fundingRequests ?? []) as Record<string, string>[]) {
    if (r['status'] !== 'withdrawn' && !(r['invoice_id']! in fundingByInvoice)) {
      fundingByInvoice[r['invoice_id']!] = r['status']!;
    }
  }
  /** Approved, unpaid, not funded, and no request in flight (a declined one can be retried). */
  const canRequestFunding = (inv: InvoiceRow) => {
    const f = fundingByInvoice[inv.id];
    return inv.status === 'approved' && Number(inv.balance_due) > 0 && !inv.funded_id
      && (!f || f === 'declined');
  };

  // Totals over every invoice, from the server — not just the page on screen.
  const { data: summary } = useInvoiceSummary();

  // One page of the list, filtered and searched on the server.
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [statusFilter, view]);
  const { data, isLoading } = useQuery<{ data: InvoiceRow[]; meta: { total: number; page: number; per_page: number } }>({
    queryKey: ['invoices', 'list', { statusFilter, view, q, page }],
    queryFn: () => api.get('/invoices', { params: {
      status: statusFilter || undefined, funding: view === 'all' ? undefined : view, q: q || undefined, page, per_page: PAGE_SIZE,
    } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const anyInvoices = (summary?.total_count ?? 0) > 0;
  const eligibleCount = summary?.eligible_count ?? 0;

  const canQuick = (a: InvoiceAction) => (a === 'payment' ? canRecordPayments(role) : canEditInvoices(role));

  const showBanner = funding.isProspect && !bannerHidden && anyInvoices;
  const approvedWaitingTotal = summary?.approved_unfunded_amount ?? 0;
  const approvedWaitingCount = summary?.approved_unfunded_count ?? 0;

  return (
    <div className="page max-w-7xl mx-auto space-y-5">
      <div className="page-header mb-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Invoices</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Track what you&rsquo;ve billed each agency, from submission to payment.
          </p>
        </div>
        {canEditInvoices(role) && (
          <button onClick={() => setShowNew(true)} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Log invoice
          </button>
        )}
      </div>

      {/* The way in, for a company that doesn't factor yet. */}
      {showBanner && (
        <div className="relative rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-4 sm:p-5 pr-12">
          <button className="absolute right-2 top-2 p-2 rounded-md text-slate-400 hover:bg-white" aria-label="Hide for now"
                  onClick={() => { dismiss('get-paid-banner'); setBannerHidden(true); }}>
            <X className="w-4 h-4" />
          </button>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
              <Banknote className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              {approvedWaitingTotal > 0 ? (
                <>
                  <p className="font-semibold text-slate-900">
                    {formatCurrency(approvedWaitingTotal)} is approved and waiting on the agency
                    {approvedWaitingCount > 1 ? ` (${approvedWaitingCount} invoices)` : ''}.
                  </p>
                  <p className="text-sm text-slate-600 mt-0.5">
                    One Source can advance up to {formatCurrency(approvedWaitingTotal * ADVANCE_MAX)} of it now —
                    often the same day — instead of you waiting 30, 60 or 90+ days.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-slate-900">Tired of waiting on agencies to pay?</p>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Once an agency approves an invoice, One Source can advance up to 90% of it —
                    often the same day.
                  </p>
                </>
              )}
            </div>
            <Link to="/funding" className="btn bg-emerald-600 text-white hover:bg-emerald-700 btn-sm whitespace-nowrap self-start sm:self-center">
              Get paid now <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      {anyInvoices && summary && (
        <div className={clsx('grid grid-cols-1 sm:grid-cols-2 gap-3', funding.isClient ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Outstanding</p>
            <p className="text-xl font-bold tabular-nums mt-1">{formatCurrency(summary.outstanding_amount)}</p>
            <p className="text-xs text-slate-500">Submitted and not yet paid</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Waiting on approval</p>
            <p className="text-xl font-bold tabular-nums mt-1">{summary.awaiting_count}</p>
            <p className="text-xs text-slate-500">With the agency</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Approved, awaiting payment</p>
            <p className="text-xl font-bold tabular-nums mt-1">{summary.approved_count}</p>
            <p className="text-xs text-slate-500">
              {funding.isActive ? (
                eligibleCount > 0
                  ? <button className="text-brand-600 hover:underline" onClick={() => setView('eligible')}>
                      {eligibleCount} eligible for funding
                    </button>
                  : 'None waiting to be funded'
              ) : 'Agency has approved'}
            </p>
          </div>
          {funding.isClient && (
            <div className="card p-4">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Funded, with the agency</p>
              <p className="text-xl font-bold tabular-nums mt-1">
                {formatCurrency(summary.funded_open_amount)}
              </p>
              <p className="text-xs text-slate-500">
                {summary.funded_open_count} invoice{summary.funded_open_count === 1 ? '' : 's'} ·{' '}
                <Link to="/funding" className="text-brand-600 hover:underline">Funding overview</Link>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar mb-0 flex-wrap">
        <div className="relative w-full sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search number, agency, contract, ref…" value={search}
                 onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
        </div>
        <select className="input w-full sm:w-56" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {funding.isClient && (
          <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-sm" role="group" aria-label="Funding">
            {([
              ['all', 'All'],
              ['funded', `Funded${summary?.funded_count ? ` (${summary.funded_count})` : ''}`],
              ['not_funded', 'Not funded'],
              ...(funding.isActive ? [['eligible', `Eligible to fund${eligibleCount ? ` (${eligibleCount})` : ''}`]] : []),
            ] as [FundingView, string][]).map(([v, label]) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}
                      className={clsx('px-3 py-1.5 rounded whitespace-nowrap',
                        view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table. relative: keeps the sr-only header label inside the scroll box,
          or it widens the whole page on a phone. */}
      <div className="card overflow-x-auto relative">
        <table className="w-full min-w-[46rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-header">Invoice</th>
              <th className="table-header">Agency</th>
              <th className="table-header">Submitted</th>
              <th className="table-header text-right">Amount</th>
              <th className="table-header">Status</th>
              <th className="table-header"><span className="sr-only">Next step</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={6} className="table-cell text-center py-8 text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-slate-600 font-medium">{anyInvoices ? 'No invoices match' : 'No invoices yet'}</p>
                  {!anyInvoices && (
                    <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                      Bill the agency the way you normally do, then log the invoice here to track it
                      through approval and payment.
                    </p>
                  )}
                  {!anyInvoices && canEditInvoices(role) && (
                    <button onClick={() => setShowNew(true)} className="btn-primary btn-sm mt-4">
                      <Plus className="w-4 h-4" /> Log your first invoice
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((inv) => {
                const next = nextAction(inv.status, inv.funded_status);
                const request = !inv.funded_id ? fundingByInvoice[inv.id] : undefined;
                const funded = funding.isClient ? fundedBadge(inv.funded_status) : null;
                const note = stageNote(inv);
                const prospectCanAsk = funding.isProspect && inv.status === 'approved' && Number(inv.balance_due) > 0;
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="table-cell">
                      <button className="font-mono text-sm font-medium text-brand-600 hover:underline text-left"
                              onClick={() => setOpenId(inv.id)}>
                        {inv.invoice_number}
                      </button>
                      {inv.funded_id && (
                        <Lock className="inline w-3 h-3 ml-1.5 text-slate-400" aria-label="Funded — details locked" />
                      )}
                      {inv.document_count > 0 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-slate-400"
                              title={`${inv.document_count} document${inv.document_count === 1 ? '' : 's'}`}>
                          <Paperclip className="w-3 h-3" />{inv.document_count}
                        </span>
                      )}
                    </td>
                    <td className="table-cell-wrap min-w-[11rem] max-w-[17rem]">
                      {inv.customer_name}
                      {(inv.job_name || inv.contract_reference) && (
                        <div className="text-xs text-slate-500 truncate">
                          {inv.job_name ? inv.job_name : `Contract ${inv.contract_reference}`}
                        </div>
                      )}
                    </td>
                    <td className="table-cell text-slate-500">
                      {inv.submitted_on ? formatDate(inv.submitted_on) : '—'}
                      {note && <div className="text-xs text-slate-400">{note}</div>}
                    </td>
                    <td className="table-cell text-right tabular-nums">
                      <span className="font-semibold">{formatCurrency(inv.total)}</span>
                      {Number(inv.balance_due) !== Number(inv.total) && !['void', 'paid'].includes(inv.status) && (
                        <div className="text-xs text-slate-500">{formatCurrency(inv.balance_due)} due</div>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={invoiceStatusBadge(inv.status)}>{invoiceStatusLabel(inv.status)}</span>
                      {funded ? (
                        <div className="mt-1"><span className={funded.badge}>{funded.label}</span></div>
                      ) : request && funding.isClient ? (
                        <div className="mt-1">
                          <span className={FUNDING_BADGE[request] ?? 'badge-gray'}>{FUNDING_LABEL[request] ?? request}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="table-cell text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        {next && canQuick(next.action) && !(funding.isActive && canRequestFunding(inv)) && (
                          <button className="btn-secondary btn-sm" onClick={() => setQuick({ invoice: inv, action: next.action })}>
                            {next.label}
                          </button>
                        )}
                        {funding.isActive && canRequestFunding(inv) && (
                          <button className="btn-primary btn-sm" onClick={() => setFundingFor(inv)}>
                            <Banknote className="w-3.5 h-3.5" /> Request funding
                          </button>
                        )}
                        {prospectCanAsk && (
                          <button className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700"
                                  onClick={() => setFundingFor(inv)}>
                            <Banknote className="w-3.5 h-3.5" /> Get paid now
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span className="tabular-nums">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn-secondary btn-sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}

      {showNew && <LogInvoiceModal onClose={() => setShowNew(false)} />}
      {openId && (
        <InvoiceDrawer invoiceId={openId} fundingStatus={fundingByInvoice[openId]} onClose={() => setOpenId(null)} />
      )}
      {quick && <InvoiceActionModal invoice={quick.invoice} action={quick.action} onClose={() => setQuick(null)} />}
      {fundingFor && (
        <RequestFundingModal
          invoice={{ id: fundingFor.id, invoice_number: fundingFor.invoice_number, total: fundingFor.total,
                     customer_name: fundingFor.customer_name ?? undefined }}
          onClose={() => setFundingFor(null)}
        />
      )}
    </div>
  );
}
