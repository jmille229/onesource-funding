import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Loader2, Upload, FileCheck2, X, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { api, formatCurrency } from '../lib/api';

interface Props {
  invoice: { id: string; invoice_number: string; total: string | number; customer_name?: string };
  onClose: () => void;
}

/**
 * One-click factoring request.
 *
 * The flow forks on whether the company is already a OneSource client:
 *   client      → attach a copy of the invoice, then request funding. The
 *                 document is mandatory (the API enforces it too) because
 *                 underwriting has nothing to work from without it.
 *   not a client → an onboarding enquiry instead, prefilled from their account.
 *
 * The upload attaches to entity_type 'funding_request_draft' keyed by invoice id,
 * because the request doesn't exist yet. Creating the request re-points those
 * attachments at it, so a user who abandons the modal leaves no orphan request —
 * only a stray draft attachment, which is harmless.
 */
export function RequestFundingModal({ invoice, onClose }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const [onboard, setOnboard] = useState({
    contact_name: '', contact_email: '', contact_phone: '', monthly_volume: '', note: '',
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

  const isClient = summary?.enabled === true && summary?.status === 'active';

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('entity_type', 'funding_request_draft');
      fd.append('entity_id', invoice.id);
      fd.append('file', file);
      await api.post('/files/upload', fd);
      setUploaded((u) => [...u, file.name]);
      toast.success('Invoice copy attached');
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const requestFunding = async () => {
    setSubmitting(true);
    try {
      await api.post('/factoring/requests', { invoice_id: invoice.id, note: note || null });
      toast.success('Funding requested — OneSource will be in touch');
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
      toast.success('Thanks — OneSource will reach out shortly');
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
            <p className="text-sm text-slate-600">
              Attach a copy of the invoice you’ve sent your customer. OneSource underwrites
              against that document, so it’s required before requesting.
            </p>

            <input
              ref={fileRef} type="file" className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
            />
            <button type="button" className="btn-secondary w-full" disabled={uploading}
                    onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploaded.length ? 'Attach another copy' : 'Attach invoice copy'}
            </button>

            {uploaded.length > 0 && (
              <ul className="space-y-1">
                {uploaded.map((n) => (
                  <li key={n} className="flex items-center gap-2 text-sm text-green-700">
                    <FileCheck2 className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{n}</span>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <label className="label" htmlFor="funding_note">Anything we should know? (optional)</label>
              <textarea id="funding_note" className="input" rows={3} value={note}
                        onChange={(e) => setNote(e.target.value)} />
            </div>

            <button className="btn-primary w-full" disabled={uploaded.length === 0 || submitting}
                    onClick={() => void requestFunding()}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Request funding
            </button>
            {uploaded.length === 0 && (
              <p className="text-xs text-slate-500 text-center">
                Attach the invoice copy to enable this.
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
              OneSource has your details and will be in touch. No need to send another.
            </p>
            <button className="btn-secondary w-full" onClick={onClose}>Close</button>
          </div>
        )}

        {!isLoading && !isClient && !existingEnquiry && (
          <div className="p-5 space-y-4">
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
              <p className="text-sm text-slate-700 font-medium">Not set up for funding yet</p>
              <p className="text-sm text-slate-500 mt-0.5">
                OneSource advances most of an invoice’s value now instead of you waiting on your
                customer. Tell us where to reach you and we’ll take it from there.
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
