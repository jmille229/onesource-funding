import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError, formatCurrency, formatDate, todayISO } from '../lib/api';
import { RequestFundingModal } from './RequestFundingModal';

interface FundingInvoice { id: string; invoice_number: string; total: string | number; customer_name?: string }

/**
 * The one-screen way to fund an invoice, for clients who use One Source for
 * funding only: no job or invoice to set up first. The server files the
 * invoice under the agency and contract behind the scenes, already approved;
 * then the usual Request funding step attaches the agency's proof of approval.
 */
export function SubmitFundingInvoice({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    agency_name: '', contract_number: '', invoice_number: '', amount: '', approved_on: todayISO(), due_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<FundingInvoice | null>(null);

  // Agencies they've submitted to before, offered as suggestions.
  const { data: contacts } = useQuery({
    queryKey: ['contacts', 'customers'],
    queryFn: () => api.get('/contacts?type=customer').then((r) => r.data.data as { id: string; name: string }[]),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Enter the invoice amount'); return; }
    setBusy(true);
    try {
      const r = await api.post('/factoring/funding-invoices', {
        agency_name: form.agency_name.trim(),
        contract_number: form.contract_number.trim() || null,
        invoice_number: form.invoice_number.trim(),
        amount,
        approved_on: form.approved_on,
        due_date: form.due_date || null,
      });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setCreated(r.data.data);
    } catch (err) {
      toast.error(apiError(err, 'Couldn’t add that invoice'));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return <RequestFundingModal invoice={created} onClose={() => { setCreated(null); onClose(); }} />;
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card p-4 sm:p-5 mb-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3>Submit an invoice for funding</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            For an invoice the agency has already approved. Next you’ll attach their approval.
          </p>
        </div>
        <button type="button" onClick={onClose} className="p-2 -m-1 rounded-md text-slate-400 hover:bg-slate-100" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="fi_agency">Agency or prime contractor</label>
          <input id="fi_agency" className="input" list="fi_agencies" value={form.agency_name}
                 onChange={set('agency_name')} required minLength={2} maxLength={200} autoComplete="off" />
          <datalist id="fi_agencies">
            {(contacts ?? []).map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
        </div>
        <div>
          <label className="label" htmlFor="fi_contract">Contract or PO number <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="fi_contract" className="input" value={form.contract_number} onChange={set('contract_number')} maxLength={60} />
        </div>
        <div>
          <label className="label" htmlFor="fi_number">Invoice number</label>
          <input id="fi_number" className="input" value={form.invoice_number} onChange={set('invoice_number')} required maxLength={50} />
        </div>
        <div>
          <label className="label" htmlFor="fi_amount">Invoice amount</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-sm text-slate-400 pointer-events-none">$</span>
            <input id="fi_amount" className="input pl-7" inputMode="decimal" value={form.amount} onChange={set('amount')} required />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="fi_approved">Date the agency approved it</label>
          <input id="fi_approved" type="date" className="input" value={form.approved_on} onChange={set('approved_on')}
                 required max={todayISO()} />
        </div>
        <div>
          <label className="label" htmlFor="fi_due">Payment due <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="fi_due" type="date" className="input" value={form.due_date} onChange={set('due_date')} />
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Continue
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

interface InvoiceRow {
  id: string; invoice_number: string; total: string; customer_name: string | null;
  approved_on: string | null; status: string; funded_status: string | null;
}

/**
 * Approved invoices with no funding request on them yet — e.g. one added
 * above whose request was never finished. Funding-only clients have no
 * Invoices page, so this is where they pick it back up.
 */
export function ReadyToRequest({ activeInvoiceIds }: { activeInvoiceIds: Set<string> }) {
  const [open, setOpen] = useState<InvoiceRow | null>(null);
  const { data } = useQuery({
    queryKey: ['invoices', 'approved'],
    queryFn: () => api.get('/invoices?status=approved').then((r) => r.data.data as InvoiceRow[]),
  });
  const rows = (data ?? []).filter((i) => !i.funded_status && !activeInvoiceIds.has(i.id));
  if (!rows.length) return null;
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-slate-900 mb-1">Ready to request</h2>
      <p className="text-sm text-slate-500 mb-3">Approved invoices you haven’t requested funding on yet.</p>
      <div className="card divide-y divide-slate-100">
        {rows.map((i) => (
          <div key={i.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900">
                <span className="font-mono">{i.invoice_number}</span> · {i.customer_name ?? '—'}
              </p>
              <p className="text-xs text-slate-500">
                {formatCurrency(i.total)}{i.approved_on ? ` · approved ${formatDate(i.approved_on)}` : ''}
              </p>
            </div>
            <button className="btn-secondary btn-sm self-start sm:self-auto" onClick={() => setOpen(i)}>
              Request funding
            </button>
          </div>
        ))}
      </div>
      {open && <RequestFundingModal invoice={{ ...open, customer_name: open.customer_name ?? undefined }} onClose={() => setOpen(null)} />}
    </section>
  );
}
