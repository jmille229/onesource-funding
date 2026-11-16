import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  X, Download, Trash2, Upload, Loader2, Banknote, CheckCircle2, Send, Undo2, CircleDollarSign, FolderKanban,
  Lock, FileSignature, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { DOC_TYPES, DOC_TYPE_LABELS, SUBMISSION_METHOD_LABELS, type DocType, type SubmissionMethod } from '@constructpm/shared';
import { api, apiError, formatCurrency, formatDate } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import {
  type InvoiceAction, type InvoiceDocument, invoiceStatusBadge, invoiceStatusLabel, isAwaitingAgency,
  nextAction, uploadInvoiceDocument, downloadAttachment, canEditInvoices, canRecordPayments,
  canVoid, FUNDING_BADGE, FUNDING_LABEL, daysSince, isFundedOpen, fundedBadge,
} from '../../lib/invoices';
import { useFundingAccount, ADVANCE_MAX } from '../../lib/funding';
import { useWorkspace } from '../layout/AppLayout';
import { InvoiceActionModal, type ActionInvoice } from './InvoiceActionModal';
import { RequestFundingModal } from '../RequestFundingModal';

interface InvoiceDetail extends ActionInvoice {
  job_id: string | null; job_name: string | null; job_number: string | null;
  contract_reference: string | null; source: 'client' | 'one_source';
  funded_id: string | null; funded_on: string | null;
  issue_date: string; due_date: string; paid_amount: string | number;
  submitted_on: string | null; approved_on: string | null; returned_on: string | null; return_note: string | null;
  notes: string | null;
  payments: { id: string; amount: string; paid_on: string; reference: string | null;
              source: string; paid_direct_on_funded: boolean }[];
}

/**
 * One invoice: where it stands with the agency, its documents, payments and
 * funding. Opens from the Invoices list.
 */
export function InvoiceDrawer({ invoiceId, fundingStatus, onClose }: {
  invoiceId: string;
  /** Status of an open funding request on this invoice, if any. */
  fundingStatus?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const funding = useFundingAccount();
  const projectTools = useWorkspace()?.projectTools ?? false;
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [action, setAction] = useState<InvoiceAction | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [docType, setDocType] = useState<DocType>('approved_invoice');
  const [uploading, setUploading] = useState(false);

  const { data: inv, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ['invoice', invoiceId],
    queryFn: () => api.get(`/invoices/${invoiceId}`).then((r) => r.data.data),
  });
  const { data: docs = [] } = useQuery<InvoiceDocument[]>({
    queryKey: ['invoice-docs', invoiceId],
    queryFn: () => api.get(`/files?entity_type=invoice&entity_id=${invoiceId}`).then((r) => r.data.data),
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !action && !requesting) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, action, requesting]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['invoice-docs', invoiceId] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['approval-requirement', invoiceId] });
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await uploadInvoiceDocument(invoiceId, docType, file);
      toast.success(`${DOC_TYPE_LABELS[docType]} attached`);
      refresh();
    } catch (err) {
      toast.error(apiError(err, 'Upload failed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (doc: InvoiceDocument) => {
    if (!window.confirm(`Remove ${doc.original_name}?`)) return;
    try {
      await api.delete(`/files/${doc.id}`);
      refresh();
    } catch (err) {
      toast.error(apiError(err, 'Could not remove the document'));
    }
  };

  const voidInvoice = async () => {
    if (!inv || !window.confirm(`Void invoice ${inv.invoice_number}? This can't be undone.`)) return;
    try {
      await api.patch(`/invoices/${invoiceId}/void`);
      toast.success('Invoice voided');
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (err) {
      toast.error(apiError(err, 'Could not void the invoice'));
    }
  };

  const next = inv ? nextAction(inv.status, inv.funded_status) : null;
  const fundedOpen = inv ? isFundedOpen(inv.funded_status) && !['paid', 'void'].includes(inv.status) : false;
  const canAct = (a: InvoiceAction) => (a === 'payment' ? canRecordPayments(role) : canEditInvoices(role));
  const openFunding = fundingStatus && ['submitted', 'under_review', 'approved'].includes(fundingStatus);
  const fundable = inv && inv.status === 'approved' && Number(inv.balance_due) > 0 && !openFunding
    && !inv.funded_id;
  const locked = Boolean(inv?.funded_id);


  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button className="absolute inset-0 bg-slate-900/50" aria-label="Close invoice" tabIndex={-1} onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Invoice details"
             className="relative w-full sm:max-w-xl h-full bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Invoice</p>
            <h2 className="text-lg font-bold text-slate-900 font-mono truncate">{inv?.invoice_number ?? '…'}</h2>
            {inv && (
              <p className="text-sm text-slate-500 truncate">{inv.customer_name}</p>
            )}
          </div>
          <button ref={closeRef} onClick={onClose} className="p-2 -m-1 rounded-md text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading || !inv ? (
          <div className="p-8 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : (
          <div className="p-5 space-y-6">
            {/* Headline */}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-bold tabular-nums">{formatCurrency(inv.total)}</p>
                {Number(inv.paid_amount) > 0 && (
                  <p className="text-sm text-slate-500">{formatCurrency(inv.balance_due)} still due</p>
                )}
              </div>
              <span className={invoiceStatusBadge(inv.status)}>{invoiceStatusLabel(inv.status)}</span>
            </div>
            {((projectTools && inv.job_name) || inv.contract_reference) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {projectTools && inv.job_name && (
                  <Link to={`/jobs/${inv.job_id}`} className="text-brand-600 hover:underline inline-flex items-center gap-1">
                    <FolderKanban className="w-4 h-4" /> {inv.job_number} — {inv.job_name}
                  </Link>
                )}
                {inv.contract_reference && (
                  <span className="text-slate-600 inline-flex items-center gap-1">
                    <FileSignature className="w-4 h-4 text-slate-400" /> Contract {inv.contract_reference}
                  </span>
                )}
              </div>
            )}

            {/* Funded: the advance was made on these details, so they're fixed. */}
            {locked && (
              <p className="flex items-start gap-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
                <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
                <span>
                  Funded by One Source{inv.funded_on ? ` on ${formatDate(inv.funded_on)}` : ''}, so the amount,
                  agency and invoice number are locked. Documents can still be added.
                  {inv.source === 'one_source' && ' Added from your One Source funding history.'}
                </span>
              </p>
            )}

            {/* Next step */}
            {(next && canAct(next.action)) || (isAwaitingAgency(inv.status) && canEditInvoices(role)) ? (
              <div className="flex flex-wrap gap-2">
                {next && canAct(next.action) && (
                  <button className="btn-primary" onClick={() => setAction(next.action)}>
                    {next.action === 'submit' && <Send className="w-4 h-4" />}
                    {next.action === 'approve' && <CheckCircle2 className="w-4 h-4" />}
                    {next.action === 'payment' && <CircleDollarSign className="w-4 h-4" />}
                    {next.label}
                  </button>
                )}
                {isAwaitingAgency(inv.status) && canEditInvoices(role) && (
                  <button className="btn-secondary" onClick={() => setAction('return')}>
                    <Undo2 className="w-4 h-4" /> Agency returned it
                  </button>
                )}
              </div>
            ) : null}

            {/* Funded: the agency pays One Source, not the client. */}
            {fundedOpen && (
              <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900 flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-brand-600" /> Funded by One Source
                </p>
                <p className="mt-1">
                  The agency pays One Source for this invoice. It&rsquo;s marked paid here
                  automatically when One Source receives the payment — nothing for you to record.
                </p>
                {canRecordPayments(role) && (
                  <button className="mt-2 text-sm font-medium text-orange-700 hover:underline"
                          onClick={() => setAction('payment')}>
                    The agency paid me directly
                  </button>
                )}
              </div>
            )}

            {/* Timeline */}
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">With the agency</h3>
              <ol className="space-y-2 text-sm">
                {inv.submitted_on ? (
                  <li className="flex gap-2">
                    <Send className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <span>
                      Submitted {formatDate(inv.submitted_on)}
                      {inv.submission_method && ` via ${SUBMISSION_METHOD_LABELS[inv.submission_method as SubmissionMethod]?.toLowerCase() ?? inv.submission_method}`}
                      {inv.agency_reference && <> · ref <span className="font-mono">{inv.agency_reference}</span></>}
                      {isAwaitingAgency(inv.status) && (
                        <span className="text-slate-500"> · waiting {daysSince(inv.submitted_on)} days</span>
                      )}
                    </span>
                  </li>
                ) : (
                  <li className="text-slate-500">Not submitted to the agency yet.</li>
                )}
                {inv.returned_on && (
                  <li className="flex gap-2">
                    <Undo2 className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                    <span>
                      Returned {formatDate(inv.returned_on)}
                      {inv.return_note && <span className="block text-slate-600">“{inv.return_note}”</span>}
                    </span>
                  </li>
                )}
                {inv.approved_on && (
                  <li className="flex gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>Approved by agency {formatDate(inv.approved_on)}</span>
                  </li>
                )}
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex gap-2">
                    <CircleDollarSign className="w-4 h-4 text-green-700 mt-0.5 flex-shrink-0" />
                    <span>
                      {formatCurrency(p.amount)} {p.source === 'one_source' ? 'collected by One Source' : 'received'} {formatDate(p.paid_on)}
                      {p.reference && p.source !== 'one_source' && <span className="text-slate-500"> · {p.reference}</span>}
                      {p.paid_direct_on_funded && (
                        <span className="block text-xs text-orange-700">Paid to you directly — One Source notified</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-slate-500 mt-2">Payment due {formatDate(inv.due_date)}</p>
            </section>

            {/* Funding: the advance, for a company that factors. */}
            {inv.funded_id && funding.isClient && <FundedPanel factoredId={inv.funded_id} />}

            {/* The way in, for a company that doesn't factor yet. */}
            {funding.isProspect && !inv.funded_id && inv.status === 'approved' && Number(inv.balance_due) > 0 && (
              <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-emerald-700" /> Get paid on this invoice now
                </p>
                <p className="text-sm text-slate-700 mt-1">
                  The agency has approved it. One Source can advance up to{' '}
                  <strong className="tabular-nums">{formatCurrency(Number(inv.balance_due) * ADVANCE_MAX)}</strong>{' '}
                  — often the same day — instead of you waiting on the agency.
                </p>
                <button className="btn btn-sm mt-3 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setRequesting(true)}>
                  Get paid now <ArrowRight className="w-4 h-4" />
                </button>
              </section>
            )}
            {funding.isProspect && !inv.funded_id && isAwaitingAgency(inv.status) && (
              <p className="text-sm text-slate-500 flex items-start gap-2">
                <Banknote className="w-4 h-4 mt-0.5 text-emerald-600 flex-shrink-0" />
                Once the agency approves this invoice, One Source can advance up to 90% of it.
              </p>
            )}

            {/* Funding: requesting it, for a client. */}
            {funding.isActive && !inv.funded_id && (
              <section className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-brand-600" /> Funding
                </h3>
                {fundingStatus ? (
                  <span className={FUNDING_BADGE[fundingStatus] ?? 'badge-gray'}>{FUNDING_LABEL[fundingStatus] ?? fundingStatus}</span>
                ) : null}
                {fundable ? (
                  <div className="mt-2">
                    <p className="text-sm text-slate-600 mb-3">
                      The agency has approved this invoice, so you can request funding now.
                    </p>
                    <button className="btn-primary" onClick={() => setRequesting(true)}>
                      <Banknote className="w-4 h-4" /> Request funding
                    </button>
                  </div>
                ) : !fundingStatus && ['draft', 'sent', 'viewed', 'overdue', 'returned'].includes(inv.status) ? (
                  <p className="text-sm text-slate-600">
                    You can request funding once the agency approves this invoice.
                  </p>
                ) : null}
              </section>
            )}

            {/* Documents */}
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Documents</h3>
              {docs.length === 0 ? (
                <p className="text-sm text-slate-500 mb-3">No documents yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg mb-3">
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {d.doc_type ? DOC_TYPE_LABELS[d.doc_type as DocType] ?? d.doc_type : 'Document'}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{d.original_name} · {formatDate(d.created_at)}</p>
                      </div>
                      <button className="p-2 rounded-md text-slate-500 hover:bg-slate-100" aria-label={`Download ${d.original_name}`}
                              onClick={() => void downloadAttachment(`/files/${d.id}/download`, d.original_name)
                                .catch((err) => toast.error(apiError(err, 'Download failed')))}>
                        <Download className="w-4 h-4" />
                      </button>
                      {canEditInvoices(role) && (
                        <button className="p-2 rounded-md text-slate-400 hover:text-red-600 hover:bg-slate-100"
                                aria-label={`Remove ${d.original_name}`} onClick={() => void remove(d)}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <select className="input sm:flex-1" value={docType} aria-label="Document type"
                        onChange={(e) => setDocType(e.target.value as DocType)}>
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
                </select>
                <input ref={fileRef} type="file" className="hidden"
                       accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
                <button className="btn-secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Attach
                </button>
              </div>
            </section>

            {inv.notes && (
              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-1">Notes</h3>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{inv.notes}</p>
              </section>
            )}

            {canVoid(role) && !locked && !['paid', 'void'].includes(inv.status) && (
              <div className="pt-4 border-t border-slate-100">
                <button className="text-sm text-red-600 hover:underline" onClick={() => void voidInvoice()}>
                  Void this invoice
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {action && inv && <InvoiceActionModal invoice={inv} action={action} onClose={() => setAction(null)} />}
      {requesting && inv && (
        <RequestFundingModal
          invoice={{ id: inv.id, invoice_number: inv.invoice_number, total: inv.total, customer_name: inv.customer_name ?? undefined }}
          onClose={() => { setRequesting(false); refresh(); }}
        />
      )}
    </div>
  );
}

interface FundedAdvance {
  id: string; status: string; face_amount: string; advance_amount: string; reserve_amount: string;
  advanced_on: string | null; collected_on: string | null; days_to_recourse: number | null;
  accrued_fee: string; net_expected: string | null;
  events: { id: string; event_type: string; amount: string | null; occurred_on: string; memo: string | null }[];
}

const EVENT_LABEL: Record<string, string> = {
  advance: 'Advance sent to you',
  payment_received: 'Agency paid One Source',
  reserve_release: 'Reserve released to you',
  chargeback: 'Charged back',
  direct_payment_reported: 'You reported a direct payment',
};

/**
 * The funding side of an invoice One Source funded: what was advanced, what
 * it has cost so far, what is still to come back, and what happened when.
 */
function FundedPanel({ factoredId }: { factoredId: string }) {
  const { data: a, isLoading } = useQuery<FundedAdvance>({
    queryKey: ['factoring-invoice', factoredId],
    queryFn: () => api.get(`/factoring/invoices/${factoredId}`).then((r) => r.data.data),
  });
  const badge = a ? fundedBadge(a.status) : null;
  const open = a ? isFundedOpen(a.status) : false;
  const events = (a?.events ?? []).filter((e) => e.event_type in EVENT_LABEL);

  return (
    <section className="rounded-lg border border-brand-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Banknote className="w-4 h-4 text-brand-600" /> Funding
        </h3>
        {badge && <span className={badge.badge}>{badge.label}</span>}
      </div>
      {isLoading || !a ? (
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Advanced{a.advanced_on ? ` ${formatDate(a.advanced_on)}` : ''}</dt>
              <dd className="font-semibold tabular-nums">{formatCurrency(a.advance_amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Reserve</dt>
              <dd className="font-semibold tabular-nums">{formatCurrency(a.reserve_amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{open ? 'Fees so far' : 'Fees'}</dt>
              <dd className="font-semibold tabular-nums">{formatCurrency(a.accrued_fee)}</dd>
            </div>
            {a.net_expected !== null && ['advanced', 'collected'].includes(a.status) && (
              <div>
                <dt className="text-xs text-slate-500">Still to come to you</dt>
                <dd className="font-semibold tabular-nums text-green-700">{formatCurrency(a.net_expected)}</dd>
              </div>
            )}
          </dl>
          {open && a.days_to_recourse !== null && (
            <p className={`text-xs mt-3 ${a.days_to_recourse <= 14 ? 'text-orange-700' : 'text-slate-500'}`}>
              {a.days_to_recourse >= 0
                ? `${a.days_to_recourse} days until recourse if the agency hasn’t paid.`
                : `Past the recourse date by ${-a.days_to_recourse} days.`}
            </p>
          )}
          {events.length > 0 && (
            <ol className="mt-4 space-y-1.5 text-sm border-t border-slate-100 pt-3">
              {[...events].reverse().map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span className="text-slate-700">
                    {EVENT_LABEL[e.event_type]}
                    {e.event_type === 'payment_received' && e.memo && <span className="text-slate-400"> · {e.memo}</span>}
                    <span className="block text-xs text-slate-400">{formatDate(e.occurred_on)}</span>
                  </span>
                  {e.amount !== null && <span className="tabular-nums text-slate-700">{formatCurrency(e.amount)}</span>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
