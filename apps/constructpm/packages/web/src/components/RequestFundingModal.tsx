import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Loader2, Upload, FileCheck2, X, ArrowRight, Circle } from 'lucide-react';
import { toast } from 'sonner';
import { DOC_TYPE_LABELS, isApprovalDocType, type DocType } from '@constructpm/shared';
import { api, apiError, formatCurrency } from '../lib/api';
import { uploadInvoiceDocument } from '../lib/invoices';
import { useAuthStore } from '../stores/auth.store';

interface Props {
  invoice: { id: string; invoice_number: string; total: string | number; customer_name?: string };
  onClose: () => void;
}

/**
 * Request funding on an invoice the agency has approved.
 *
 * The flow forks on whether the company is already a One Source client:
 *   client       → One Source never funds before the agency approves, and what
 *                  counts as proof of approval depends on the agency. The modal
 *                  shows that agency's rule, ticks off the proof already on the
 *                  invoice, and lets the client attach what's missing. Every
 *                  document on the invoice goes with the request — nothing is
 *                  uploaded twice.
 *   not a client → an onboarding enquiry instead, prefilled from their account.
 */
export function RequestFundingModal({ invoice, onClose }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useAuthStore((st) => st.user);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState('');
  const [proofType, setProofType] = useState('');

  const [onboard, setOnboard] = useState({
    contact_name: user ? `${user.first_name} ${user.last_name}`.trim() : '',
    contact_email: user?.email ?? '',
    contact_phone: '', monthly_volume: '', note: '',
  });

  const { data: summary, isLoading } = useQuery({
    queryKey: ['factoring-summary'],
    queryFn: () => api.get('/factoring/summary').then((r) => r.data.data),
  });
  const { data: existingEnquiry } = useQuery({
    queryKey: ['factoring-onboarding'],
    queryFn: () => api.get('/factoring/onboarding').then((r) => r.data.data),
    enabled: summary?.enabled === false,
  });
  const { data: requirement, refetch: refetchRequirement } = useQuery({
    queryKey: ['approval-requirement', invoice.id],
    queryFn: () => api.get(`/factoring/approval-requirement?invoice_id=${invoice.id}`).then((r) => r.data.data as {
      agency_name: string; accepted: string[] | null; instructions: string | null; satisfied: boolean;
      documents: { id: string; original_name: string; doc_type: string | null }[];
    }),
  });

  const isClient = summary?.enabled === true && summary?.status === 'active';

  const accepted = (requirement?.accepted ?? ['approved_invoice']) as DocType[];
  const chosenType = (proofType || accepted[0]) as DocType;
  const docs = requirement?.documents ?? [];

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await uploadInvoiceDocument(invoice.id, chosenType, file);
      toast.success(`${DOC_TYPE_LABELS[chosenType]} attached`);
      await refetchRequirement();
      qc.invalidateQueries({ queryKey: ['invoice-docs', invoice.id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e) {
      toast.error(apiError(e, 'Upload failed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const requestFunding = async () => {
    setSubmitting(true);
    try {
      await api.post('/factoring/requests', { invoice_id: invoice.id, note: note || null });
      toast.success('Funding requested — One Source will be in touch');
      qc.invalidateQueries({ queryKey: ['factoring-requests'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      onClose();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Could not submit the request');
    } finally {
      setSubmitting(false);
    }
  };

  const requestOnboarding = async () => {
    if (!onboard.contact_name || !onboard.contact_email) {
      toast.error('Name and email are required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/factoring/onboarding', {
        ...onboard,
        monthly_volume: onboard.monthly_volume ? Number(onboard.monthly_volume) : null,
        contact_phone: onboard.contact_phone || null,
        note: onboard.note || null,
        invoice_id: invoice.id,
      });
      toast.success('Thanks — One Source will reach out shortly');
      qc.invalidateQueries({ queryKey: ['factoring-onboarding'] });
      onClose();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Could not send the enquiry');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4">
      <div role="dialog" aria-modal="true" aria-label="Request funding"
           className="card w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-b-none sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
              <Banknote className="w-5 h-5 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate">Request funding</h3>
              <p className="text-sm text-slate-500 truncate">
                {invoice.invoice_number} · {formatCurrency(invoice.total)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-md text-slate-400 hover:bg-slate-100"
                  aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-slate-500 text-sm">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Checking your account…
          </div>
        )}

        {/* ── Existing client: attach, then request ───────────────────────── */}
        {!isLoading && isClient && (
          <div className="p-5 space-y-4">
            {/* Say up front whether this invoice fits inside the limit. Finding
                out after uploading a document and pressing request is a bad way
                to learn it doesn't. */}
            {summary?.funding_available !== null && summary?.funding_available !== undefined && (() => {
              const available = Number(summary.funding_available);
              const amount = Number(invoice.total);
              const fits = amount <= available;
              return (
                <div className={`rounded-lg border p-3 text-sm ${
                  fits ? 'border-slate-200 bg-slate-50 text-slate-700'
                       : 'border-orange-200 bg-orange-50 text-orange-900'}`}>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(available)} available to fund
                  </p>
                  {!fits && (
                    <p className="mt-0.5">
                      This invoice is {formatCurrency(amount - available)} above your remaining limit.
                      You can still request it — One Source will review — or wait until an open advance
                      is collected.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* The agency's rule, and what's already on file against it. */}
            <div>
              <p className="text-sm font-medium text-slate-800">Proof the agency approved this invoice</p>
              <p className="text-sm text-slate-600 mt-0.5">
                For {requirement?.agency_name || 'this agency'}, One Source accepts:{' '}
                <strong>{accepted.map((t) => DOC_TYPE_LABELS[t] ?? t).join(' or ')}</strong>.
              </p>
              {requirement?.instructions && (
                <p className="text-sm text-slate-600 mt-1">{requirement.instructions}</p>
              )}
            </div>

            {docs.length > 0 && (
              <ul className="space-y-1">
                {docs.map((d) => {
                  const counts = isApprovalDocType(d.doc_type) && accepted.includes(d.doc_type as DocType);
                  return (
                    <li key={d.id} className={`flex items-center gap-2 text-sm ${counts ? 'text-green-700' : 'text-slate-600'}`}>
                      {counts ? <FileCheck2 className="w-4 h-4 flex-shrink-0" /> : <Circle className="w-3.5 h-3.5 flex-shrink-0 text-slate-300" />}
                      <span className="truncate">
                        {d.doc_type ? DOC_TYPE_LABELS[d.doc_type as DocType] ?? d.doc_type : 'Document'} · {d.original_name}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {!requirement?.satisfied && (
              <div className="flex flex-col sm:flex-row gap-2">
                {accepted.length > 1 && (
                  <select className="input sm:flex-1" value={chosenType} aria-label="Type of proof"
                          onChange={(e) => setProofType(e.target.value)}>
                    {accepted.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t] ?? t}</option>)}
                  </select>
                )}
                <input
                  ref={fileRef} type="file" className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
                />
                <button type="button" className="btn-secondary sm:flex-1" disabled={uploading}
                        onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Attach {accepted.length === 1 ? DOC_TYPE_LABELS[accepted[0]!]?.toLowerCase() : 'proof'}
                </button>
              </div>
            )}

            <p className="text-xs text-slate-500">
              Everything attached to this invoice is sent with the request.
            </p>

            <div>
              <label className="label" htmlFor="funding_note">Anything we should know? (optional)</label>
              <textarea id="funding_note" className="input" rows={3} value={note}
                        onChange={(e) => setNote(e.target.value)} />
            </div>

            <button className="btn-primary w-full" disabled={!requirement?.satisfied || submitting}
                    onClick={() => void requestFunding()}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Request funding
            </button>
            {!requirement?.satisfied && (
              <p className="text-xs text-slate-500 text-center">
                Attach the agency&rsquo;s approval to enable this.
              </p>
            )}
          </div>
        )}

        {/* ── Not a client yet: onboarding enquiry ────────────────────────── */}
        {!isLoading && !isClient && existingEnquiry && (
          <div className="p-5 space-y-3 text-center">
            <FileCheck2 className="w-10 h-10 mx-auto text-green-600" />
            <p className="font-medium text-slate-800">Your enquiry is already with us</p>
            <p className="text-sm text-slate-500">
              One Source has your details and will be in touch. No need to send another.
            </p>
            <button className="btn-secondary w-full" onClick={onClose}>Close</button>
          </div>
        )}

        {!isLoading && !isClient && !existingEnquiry && (
          <div className="p-5 space-y-4">
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
              <p className="text-sm text-slate-700 font-medium">Not set up for funding yet</p>
              <p className="text-sm text-slate-500 mt-0.5">
                One Source advances most of an approved invoice&rsquo;s value now, instead of you
                waiting on the agency. Tell us where to reach you and we&rsquo;ll take it from there.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="ob_name">Your name *</label>
                <input id="ob_name" className="input" value={onboard.contact_name}
                       onChange={(e) => setOnboard((o) => ({ ...o, contact_name: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor="ob_phone">Phone</label>
                <input id="ob_phone" className="input" value={onboard.contact_phone}
                       onChange={(e) => setOnboard((o) => ({ ...o, contact_phone: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="ob_email">Email *</label>
              <input id="ob_email" type="email" className="input" value={onboard.contact_email}
                     onChange={(e) => setOnboard((o) => ({ ...o, contact_email: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="ob_vol">Rough monthly invoicing</label>
              <input id="ob_vol" type="number" min="0" step="1000" className="input"
                     value={onboard.monthly_volume}
                     onChange={(e) => setOnboard((o) => ({ ...o, monthly_volume: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="ob_note">Anything else? (optional)</label>
              <textarea id="ob_note" className="input" rows={2} value={onboard.note}
                        onChange={(e) => setOnboard((o) => ({ ...o, note: e.target.value }))} />
            </div>

            <button className="btn-primary w-full" disabled={submitting}
                    onClick={() => void requestOnboarding()}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Request onboarding <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-xs text-slate-500 text-center">
              No commitment — this just starts a conversation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
