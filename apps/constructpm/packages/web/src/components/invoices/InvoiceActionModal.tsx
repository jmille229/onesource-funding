import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  APPROVAL_DOC_TYPES, DOC_TYPE_LABELS, SUBMISSION_METHODS, SUBMISSION_METHOD_LABELS,
  type DocType,
} from '@constructpm/shared';
import { api, apiError, formatCurrency, todayISO } from '../../lib/api';
import { type InvoiceAction, uploadInvoiceDocument } from '../../lib/invoices';

export interface ActionInvoice {
  id: string;
  invoice_number: string;
  status: string;
  total: number | string;
  balance_due: number | string;
  customer_name?: string | null;
  submission_method?: string | null;
  agency_reference?: string | null;
}

const TITLES: Record<InvoiceAction, string> = {
  submit: 'Mark submitted to agency',
  approve: 'Mark approved by agency',
  return: 'Mark returned for correction',
  payment: 'Record a payment received',
};

/**
 * One small form per step of the agency's process. Each records what already
 * happened outside the app — nothing here contacts the agency.
 */
export function InvoiceActionModal({ invoice, action, onClose }: {
  invoice: ActionInvoice;
  action: InvoiceAction;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState(invoice.submission_method ?? '');
  const [reference, setReference] = useState(action === 'submit' ? (invoice.agency_reference ?? '') : '');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(String(Number(invoice.balance_due)));
  const [proofType, setProofType] = useState<string>('');
  const [proofFile, setProofFile] = useState<File | null>(null);

  // For funding clients, what proof of approval this agency needs. Everyone
  // else gets null back and simply sees an optional upload.
  const { data: requirement } = useQuery({
    queryKey: ['approval-requirement', invoice.id],
    queryFn: () => api.get(`/factoring/approval-requirement?invoice_id=${invoice.id}`)
      .then((r) => r.data.data as { accepted: string[] | null; instructions: string | null })
      .catch(() => null),
    enabled: action === 'approve',
  });
  const proofOptions = (requirement?.accepted ?? [...APPROVAL_DOC_TYPES]) as DocType[];
  const chosenProofType = proofType || proofOptions[0] || 'approved_invoice';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (action === 'submit') {
        await api.patch(`/invoices/${invoice.id}/submit`, {
          submitted_on: date, submission_method: method || null, agency_reference: reference.trim() || null,
        });
        toast.success('Marked submitted to agency');
      } else if (action === 'approve') {
        await api.patch(`/invoices/${invoice.id}/approve`, { approved_on: date });
        if (proofFile) {
          try {
            await uploadInvoiceDocument(invoice.id, chosenProofType, proofFile);
          } catch (err) {
            toast.error(apiError(err, 'Marked approved, but the document did not upload — attach it from the invoice'));
          }
        }
        toast.success('Marked approved by agency');
      } else if (action === 'return') {
        await api.patch(`/invoices/${invoice.id}/return`, { returned_on: date, note: note.trim() || null });
        toast.success('Marked returned for correction');
      } else {
        const n = Number(amount);
        if (!(n > 0)) { toast.error('Enter the amount received'); setBusy(false); return; }
        await api.patch(`/invoices/${invoice.id}/record-payment`, {
          amount: n, paid_on: date, reference: reference.trim() || null,
        });
        toast.success('Payment recorded');
      }
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      qc.invalidateQueries({ queryKey: ['invoice-docs', invoice.id] });
      qc.invalidateQueries({ queryKey: ['approval-requirement', invoice.id] });
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'That did not save. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const dateLabel = {
    submit: 'Date submitted', approve: 'Date approved', return: 'Date returned', payment: 'Date received',
  }[action];

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="inv-action-title"
           className="card w-full sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-b-none sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200">
          <div className="min-w-0">
            <h3 id="inv-action-title">{TITLES[action]}</h3>
            <p className="text-sm text-slate-500 truncate">
              {invoice.invoice_number} · {invoice.customer_name ?? 'Agency'} · {formatCurrency(invoice.total)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-md text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {action === 'submit' && (
            <p className="text-sm text-slate-600">
              Record that you submitted this invoice to the agency. This doesn&rsquo;t send
              anything — keep billing the agency the way you normally do.
            </p>
          )}

          <div>
            <label className="label" htmlFor="act-date">{dateLabel}</label>
            <input id="act-date" type="date" className="input" value={date} max={todayISO()}
                   onChange={(e) => setDate(e.target.value)} required />
          </div>

          {action === 'submit' && (
            <>
              <div>
                <label className="label" htmlFor="act-method">How was it submitted?</label>
                <select id="act-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="">—</option>
                  {SUBMISSION_METHODS.map((m) => <option key={m} value={m}>{SUBMISSION_METHOD_LABELS[m]}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="act-ref">Agency reference or PO number (optional)</label>
                <input id="act-ref" className="input" value={reference} maxLength={100}
                       onChange={(e) => setReference(e.target.value)} />
              </div>
            </>
          )}

          {action === 'approve' && (
            <div className="space-y-3">
              {requirement?.accepted && (
                <div className="rounded-md border border-brand-200 bg-brand-50/50 p-3 text-sm text-slate-700 flex gap-2">
                  <Info className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p>
                      To fund this invoice, One Source needs proof of approval:{' '}
                      <strong>{requirement.accepted.map((t) => DOC_TYPE_LABELS[t as DocType] ?? t).join(' or ')}</strong>.
                    </p>
                    {requirement.instructions && <p className="mt-1 text-slate-600">{requirement.instructions}</p>}
                  </div>
                </div>
              )}
              <div>
                <label className="label" htmlFor="act-proof-type">Proof of approval (optional)</label>
                <select id="act-proof-type" className="input" value={chosenProofType}
                        onChange={(e) => setProofType(e.target.value)}>
                  {proofOptions.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <input ref={fileRef} type="file" className="hidden"
                     accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                     onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
              <button type="button" className="btn-secondary w-full" onClick={() => fileRef.current?.click()}>
                {proofFile ? `Change file (${proofFile.name})` : 'Choose file'}
              </button>
            </div>
          )}

          {action === 'return' && (
            <div>
              <label className="label" htmlFor="act-note">What does the agency need corrected?</label>
              <textarea id="act-note" className="input" rows={3} value={note} maxLength={2000}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. Missing certified payroll for week of Sept 8" />
            </div>
          )}

          {action === 'payment' && (
            <>
              <div>
                <label className="label" htmlFor="act-amount">Amount received</label>
                <input id="act-amount" type="number" min="0.01" step="0.01" className="input" value={amount}
                       onChange={(e) => setAmount(e.target.value)} required />
                <p className="text-xs text-slate-500 mt-1">Balance due: {formatCurrency(invoice.balance_due)}</p>
              </div>
              <div>
                <label className="label" htmlFor="act-payref">Check or ACH reference (optional)</label>
                <input id="act-payref" className="input" value={reference} maxLength={100}
                       onChange={(e) => setReference(e.target.value)} />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
