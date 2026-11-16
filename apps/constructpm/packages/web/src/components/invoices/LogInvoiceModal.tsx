import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X, ChevronDown, ChevronRight, Banknote } from 'lucide-react';
import { toast } from 'sonner';
import { SUBMISSION_METHODS, SUBMISSION_METHOD_LABELS } from '@constructpm/shared';
import { ContactPicker } from '../ContactPicker';
import { api, apiError, formatCurrency, todayISO } from '../../lib/api';
import { uploadInvoiceDocument, canSeeFunding } from '../../lib/invoices';
import { useFundingAccount, ADVANCE_MAX } from '../../lib/funding';
import { useAuthStore } from '../../stores/auth.store';
import { RequestFundingModal } from '../RequestFundingModal';
import { useWorkspace } from '../layout/AppLayout';

type Stage = 'draft' | 'sent' | 'approved';

interface JobOption { id: string; name: string; job_number: string; customer_id: string | null }

/**
 * Record an invoice the contractor has billed (or is about to bill) the agency.
 *
 * Not an invoice builder: the contractor's own invoice — made in their
 * accounting software, the agency's portal, wherever — is the real one. This
 * logs its number, amount and where it stands, so the app can track it to
 * payment. Line items are optional, for anyone who wants job costing.
 *
 * It is also the one way to fund an invoice: log it as approved by the agency
 * and tick "fund it", and the funding request opens straight after — the
 * same request as from any approved invoice. `fund` opens the form that way.
 */
export function LogInvoiceModal({ onClose, defaultJobId, fund = false }: {
  onClose: () => void; defaultJobId?: string; fund?: boolean;
}) {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const funding = useFundingAccount();
  const projectTools = useWorkspace()?.projectTools ?? true;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    job_id: defaultJobId ?? '', customer_id: '', contract_reference: '', invoice_number: '', amount: '',
    stage: (fund ? 'approved' : 'sent') as Stage,
    submitted_on: todayISO(), approved_on: todayISO(), submission_method: '', agency_reference: '',
    due_date: '', notes: '', fund_now: fund,
  });
  // The invoice just logged, when it goes straight on to funding.
  const [toFund, setToFund] = useState<{ id: string; invoice_number: string; total: string | number; customer_name?: string } | null>(null);
  const canFund = canSeeFunding(role) && (funding.isActive || funding.isProspect);
  const [itemize, setItemize] = useState(false);
  const [items, setItems] = useState([{ description: '', quantity: '1', unit_price: '' }]);
  const [file, setFile] = useState<File | null>(null);

  const { data: jobs = [] } = useQuery<JobOption[]>({
    queryKey: ['jobs', 'for-invoice'],
    queryFn: () => api.get('/jobs?per_page=100').then((r) => r.data.data),
  });

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Picking the job fills in its agency — the usual case — but never overwrites
  // an agency the user already chose.
  const pickJob = (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    setForm((f) => ({ ...f, job_id: jobId, customer_id: f.customer_id || job?.customer_id || '' }));
  };

  const itemsTotal = items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0), 0);
  const updateItem = (i: number, k: string, v: string) =>
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id) { toast.error('Choose the agency you billed'); return; }
    const amount = parseFloat(form.amount);
    if (!itemize && !(amount > 0)) { toast.error('Enter the invoice amount'); return; }
    if (itemize && items.some((i) => !i.description.trim() || !i.unit_price)) {
      toast.error('Each line needs a description and a price'); return;
    }
    setBusy(true);
    try {
      const submitted = form.stage !== 'draft';
      const r = await api.post('/invoices', {
        job_id: form.job_id || null,
        contract_reference: form.contract_reference.trim() || null,
        customer_id: form.customer_id,
        invoice_number: form.invoice_number.trim() || null,
        status: form.stage,
        submitted_on: form.stage === 'sent' ? form.submitted_on : null,
        approved_on: form.stage === 'approved' ? form.approved_on : null,
        submission_method: submitted ? (form.submission_method || null) : null,
        agency_reference: form.agency_reference.trim() || null,
        due_date: form.due_date || null,
        notes: form.notes.trim() || null,
        ...(itemize
          ? { items: items.map((i) => ({
              description: i.description.trim(),
              quantity: parseFloat(i.quantity) || 1,
              unit_price: parseFloat(i.unit_price) || 0,
            })) }
          : { amount }),
      });
      const created = r.data.data as { id: string; invoice_number: string; total: string };
      if (file) {
        try {
          await uploadInvoiceDocument(created.id, 'invoice_as_submitted', file);
        } catch (err) {
          toast.error(apiError(err, 'Invoice saved, but the copy did not upload — attach it from the invoice'));
        }
      }
      qc.invalidateQueries({ queryKey: ['invoices'] });
      if (form.stage === 'approved' && form.fund_now && canFund) {
        toast.success('Invoice logged — now the funding request');
        setToFund({ id: created.id, invoice_number: created.invoice_number, total: created.total });
        return;
      }
      toast.success('Invoice logged');
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Could not save the invoice'));
    } finally {
      setBusy(false);
    }
  };

  if (toFund) return <RequestFundingModal invoice={toFund} onClose={onClose} />;

  const fundAmount = itemize ? itemsTotal : parseFloat(form.amount) || 0;

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="log-inv-title"
           className="card w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-b-none sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200">
          <div>
            <h3 id="log-inv-title">{fund ? 'Fund an invoice' : 'Log an invoice'}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {fund
                ? 'Add the invoice the agency approved. Next you’ll attach their approval and send the request.'
                : 'Keep billing the agency the way you do today. Log the invoice here to track it to payment.'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-md text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={save} className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ContactPicker id="li-agency" label="Agency (bill to) *" required
                           value={form.customer_id} onChange={(id) => set('customer_id', id)} />
            <div>
              <label className="label" htmlFor="li-contract">Contract or PO #</label>
              <input id="li-contract" className="input" value={form.contract_reference} maxLength={100}
                     onChange={(e) => set('contract_reference', e.target.value)}
                     placeholder="Optional" />
            </div>
            {projectTools && (jobs.length > 0 || defaultJobId) && (
              <div>
                <label className="label" htmlFor="li-job">Job</label>
                <select id="li-job" className="input" value={form.job_id} onChange={(e) => pickJob(e.target.value)}>
                  <option value="">None</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} — {j.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="li-num">Your invoice number{funding_now(form, canFund) ? ' *' : ''}</label>
              <input id="li-num" className="input" value={form.invoice_number} maxLength={50}
                     onChange={(e) => set('invoice_number', e.target.value)} required={funding_now(form, canFund)}
                     placeholder={funding_now(form, canFund) ? 'As it appears on the invoice' : 'Leave blank to assign one'} />
            </div>
            {!itemize && (
              <div>
                <label className="label" htmlFor="li-amt">Invoice amount *</label>
                <input id="li-amt" className="input" type="number" min="0.01" step="0.01" value={form.amount}
                       onChange={(e) => set('amount', e.target.value)} placeholder="0.00" />
              </div>
            )}
          </div>

          <fieldset className="space-y-3">
            <legend className="label">Where is it with the agency?</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {([
                ['draft', 'Not submitted yet'],
                ['sent', 'Submitted, waiting on approval'],
                ['approved', 'Approved by the agency'],
              ] as [Stage, string][]).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2">
                  <input type="radio" name="li-stage" checked={form.stage === v} onChange={() => set('stage', v)} />
                  {label}
                </label>
              ))}
            </div>
            {form.stage !== 'draft' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {form.stage === 'sent' ? (
                  <div>
                    <label className="label" htmlFor="li-subdate">Date submitted</label>
                    <input id="li-subdate" type="date" className="input" value={form.submitted_on} max={todayISO()}
                           onChange={(e) => set('submitted_on', e.target.value)} required />
                  </div>
                ) : (
                  <div>
                    <label className="label" htmlFor="li-appdate">Date approved</label>
                    <input id="li-appdate" type="date" className="input" value={form.approved_on} max={todayISO()}
                           onChange={(e) => set('approved_on', e.target.value)} required />
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="li-method">How submitted</label>
                  <select id="li-method" className="input" value={form.submission_method}
                          onChange={(e) => set('submission_method', e.target.value)}>
                    <option value="">—</option>
                    {SUBMISSION_METHODS.map((m) => <option key={m} value={m}>{SUBMISSION_METHOD_LABELS[m]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="li-ref">Agency ref / PO</label>
                  <input id="li-ref" className="input" value={form.agency_reference} maxLength={100}
                         onChange={(e) => set('agency_reference', e.target.value)} />
                </div>
              </div>
            )}
            {form.stage === 'approved' && canFund && (
              <label className={`flex items-start gap-3 rounded-lg border p-3 text-sm cursor-pointer ${
                form.fund_now ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                <input type="checkbox" className="mt-0.5" checked={form.fund_now}
                       onChange={(e) => set('fund_now', e.target.checked)} />
                <span>
                  <span className="font-medium text-slate-900 flex items-center gap-1.5">
                    <Banknote className="w-4 h-4 text-emerald-700" />
                    {funding.isActive ? 'Fund this invoice with One Source' : 'Get paid on this invoice now'}
                  </span>
                  <span className="text-slate-600">
                    {fundAmount > 0 ? `Up to ${formatCurrency(fundAmount * ADVANCE_MAX)}, often the same day. ` : 'Up to 90%, often the same day. '}
                    {funding.isActive ? 'Next you’ll attach the agency’s approval.' : 'Next, tell us where to reach you.'}
                  </span>
                </span>
              </label>
            )}
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="li-due">Payment due (optional)</label>
              <input id="li-due" type="date" className="input" value={form.due_date}
                     onChange={(e) => set('due_date', e.target.value)} />
              <p className="text-xs text-slate-500 mt-1">Defaults to 30 days after submission.</p>
            </div>
            <div>
              <span className="label">Copy of the invoice (optional)</span>
              <input ref={fileRef} type="file" className="hidden"
                     accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                     onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="button" className="btn-secondary w-full" onClick={() => fileRef.current?.click()}>
                {file ? `Change file (${file.name})` : 'Attach the invoice as submitted'}
              </button>
            </div>
          </div>

          {projectTools && <div>
            <button type="button" className="text-sm font-medium text-brand-600 hover:underline inline-flex items-center gap-1"
                    onClick={() => setItemize((v) => !v)} aria-expanded={itemize}>
              {itemize ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Add line items for job costing (optional)
            </button>
            {itemize && (
              <div className="mt-3 space-y-2">
                {items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="input col-span-12 sm:col-span-6 text-sm" value={item.description} placeholder="Description"
                           onChange={(e) => updateItem(i, 'description', e.target.value)} aria-label="Description" />
                    <input className="input col-span-4 sm:col-span-2 text-sm text-right" type="number" min="0" step="0.01"
                           value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} aria-label="Quantity" />
                    <input className="input col-span-6 sm:col-span-3 text-sm text-right" type="number" min="0" step="0.01"
                           value={item.unit_price} placeholder="Unit $" onChange={(e) => updateItem(i, 'unit_price', e.target.value)}
                           aria-label="Unit price" />
                    <button type="button" className="col-span-2 sm:col-span-1 text-slate-400 hover:text-red-600 text-lg"
                            onClick={() => setItems((l) => l.filter((_, idx) => idx !== i))}
                            disabled={items.length === 1} aria-label="Remove line">×</button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button type="button" className="btn-ghost btn-sm"
                          onClick={() => setItems((l) => [...l, { description: '', quantity: '1', unit_price: '' }])}>
                    <Plus className="w-3 h-3" /> Add line
                  </button>
                  <span className="text-sm font-semibold">Total {formatCurrency(itemsTotal)}</span>
                </div>
              </div>
            )}
          </div>}

          <div>
            <label className="label" htmlFor="li-notes">Notes (optional)</label>
            <textarea id="li-notes" className="input" rows={2} value={form.notes} maxLength={2000}
                      onChange={(e) => set('notes', e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {form.stage === 'approved' && form.fund_now && canFund ? 'Continue to funding' : 'Log invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Logging it to fund it: the invoice number then has to be the real one. */
function funding_now(form: { stage: string; fund_now: boolean }, canFund: boolean) {
  return form.stage === 'approved' && form.fund_now && canFund;
}
