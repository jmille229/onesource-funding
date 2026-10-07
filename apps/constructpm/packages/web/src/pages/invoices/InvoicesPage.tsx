import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, FileText, Search, Banknote, Paperclip } from 'lucide-react';
import { api, formatCurrency, formatDate } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import {
  type InvoiceAction, invoiceStatusBadge, invoiceStatusLabel, isAwaitingAgency, nextAction,
  canEditInvoices, canRecordPayments, canSeeFunding, FUNDING_BADGE, FUNDING_LABEL, daysSince,
} from '../../lib/invoices';
import { LogInvoiceModal } from '../../components/invoices/LogInvoiceModal';
import { InvoiceDrawer } from '../../components/invoices/InvoiceDrawer';
import { InvoiceActionModal, type ActionInvoice } from '../../components/invoices/InvoiceActionModal';
import { RequestFundingModal } from '../../components/RequestFundingModal';

interface InvoiceRow extends ActionInvoice {
  job_name: string | null;
  job_number: string | null;
  submitted_on: string | null;
  approved_on: string | null;
  due_date: string;
  document_count: number;
  has_approval_doc: boolean;
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

/** "Where is it with the agency" in a few words, for the list. */
function stageNote(inv: InvoiceRow): string {
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
 * records each step — submitted, approved or returned, paid — and opens
 * funding once the agency approves.
 */
export function InvoicesPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ invoice: InvoiceRow; action: InvoiceAction } | null>(null);
  const [fundingFor, setFundingFor] = useState<InvoiceRow | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const showFunding = canSeeFunding(role);

  // Which invoices already have a funding request, so the row shows its status
  // instead of offering to request again.
  const { data: fundingRequests } = useQuery({
    queryKey: ['factoring-requests'],
    queryFn: () => api.get('/factoring/requests').then((r) => r.data.data).catch(() => []),
    enabled: showFunding,
  });
  const fundingByInvoice: Record<string, string> = Object.fromEntries(
    (fundingRequests ?? [])
      .filter((r: Record<string, string>) => r['status'] !== 'withdrawn')
      .map((r: Record<string, string>) => [r['invoice_id'], r['status']])
  );

  // Funding clients get "Request funding" as the next step on approved
  // invoices. Software-only users get "Record payment"; funding stays one click
  // away inside the invoice, without being pushed on every row.
  const { data: fundingSummary } = useQuery({
    queryKey: ['factoring-summary'],
    queryFn: () => api.get('/factoring/summary').then((r) => r.data.data).catch(() => null),
    enabled: showFunding,
  });
  const isFundingClient = showFunding && fundingSummary?.enabled === true && fundingSummary?.status === 'active';

  const { data, isLoading } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices', statusFilter],
    queryFn: () => api.get(`/invoices?status=${encodeURIComponent(statusFilter)}`).then((r) => r.data.data),
  });

  const invoices = data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? invoices.filter((i) =>
        [i.invoice_number, i.customer_name, i.job_name, i.agency_reference]
          .some((v) => v?.toLowerCase().includes(q)))
    : invoices;

  const outstanding = invoices
    .filter((i) => !['draft', 'paid', 'void'].includes(i.status))
    .reduce((s, i) => s + Number(i.balance_due ?? 0), 0);
  const awaiting = invoices.filter((i) => isAwaitingAgency(i.status)).length;
  const approvedUnpaid = invoices.filter((i) => i.status === 'approved').length;

  const canQuick = (a: InvoiceAction) => (a === 'payment' ? canRecordPayments(role) : canEditInvoices(role));

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

      {invoices.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Outstanding</p>
            <p className="text-xl font-bold tabular-nums mt-1">{formatCurrency(outstanding)}</p>
            <p className="text-xs text-slate-500">Submitted and not yet paid</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Waiting on approval</p>
            <p className="text-xl font-bold tabular-nums mt-1">{awaiting}</p>
            <p className="text-xs text-slate-500">With the agency</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Approved, awaiting payment</p>
            <p className="text-xl font-bold tabular-nums mt-1">{approvedUnpaid}</p>
            <p className="text-xs text-slate-500">{isFundingClient ? 'Eligible for funding' : 'Agency has approved'}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar mb-0">
        <div className="relative w-full sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search number, agency, job, ref…" value={search}
                 onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
        </div>
        <select className="input w-full sm:w-56" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
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
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-slate-600 font-medium">{invoices.length ? 'No invoices match' : 'No invoices yet'}</p>
                  {!invoices.length && (
                    <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                      Bill the agency the way you normally do, then log the invoice here to track it
                      through approval and payment.
                    </p>
                  )}
                  {!invoices.length && canEditInvoices(role) && (
                    <button onClick={() => setShowNew(true)} className="btn-primary btn-sm mt-4">
                      <Plus className="w-4 h-4" /> Log your first invoice
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((inv) => {
                const next = nextAction(inv.status);
                const funding = fundingByInvoice[inv.id];
                const note = stageNote(inv);
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="table-cell">
                      <button className="font-mono text-sm font-medium text-brand-600 hover:underline text-left"
                              onClick={() => setOpenId(inv.id)}>
                        {inv.invoice_number}
                      </button>
                      {inv.document_count > 0 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-slate-400"
                              title={`${inv.document_count} document${inv.document_count === 1 ? '' : 's'}`}>
                          <Paperclip className="w-3 h-3" />{inv.document_count}
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      {inv.customer_name}
                      {inv.job_name && (
                        <div className="text-xs text-slate-500 truncate max-w-[14rem]">{inv.job_name}</div>
                      )}
                    </td>
                    <td className="table-cell text-slate-500">
                      {inv.submitted_on ? formatDate(inv.submitted_on) : '—'}
                      {note && <div className="text-xs text-slate-400">{note}</div>}
                    </td>
                    <td className="table-cell text-right tabular-nums">
                      <span className="font-semibold">{formatCurrency(inv.total)}</span>
                      {Number(inv.balance_due) !== Number(inv.total) && inv.status !== 'void' && (
                        <div className="text-xs text-slate-500">{formatCurrency(inv.balance_due)} due</div>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={invoiceStatusBadge(inv.status)}>{invoiceStatusLabel(inv.status)}</span>
                      {showFunding && funding && (
                        <div className="mt-1">
                          <span className={FUNDING_BADGE[funding] ?? 'badge-gray'}>{FUNDING_LABEL[funding] ?? funding}</span>
                        </div>
                      )}
                    </td>
                    <td className="table-cell text-right">
                      {isFundingClient && !funding && inv.status === 'approved' && Number(inv.balance_due) > 0 ? (
                        <button className="btn-primary btn-sm" onClick={() => setFundingFor(inv)}>
                          <Banknote className="w-3.5 h-3.5" /> Request funding
                        </button>
                      ) : next && canQuick(next.action) ? (
                        <button className="btn-secondary btn-sm" onClick={() => setQuick({ invoice: inv, action: next.action })}>
                          {next.label}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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
