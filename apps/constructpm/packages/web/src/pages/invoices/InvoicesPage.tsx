import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText, DollarSign, Loader2, Search, CheckCircle, Banknote } from 'lucide-react';
import { ContactPicker } from '../../components/ContactPicker';
import { RequestFundingModal } from '../../components/RequestFundingModal';

// A request is a request, not an advance — the wording stays deliberately
// non-committal until OneSource actually funds it.
const FUNDING_BADGE: Record<string, string> = {
  submitted: 'badge-blue', under_review: 'badge-yellow', approved: 'badge-green',
  declined: 'badge-red', withdrawn: 'badge-gray',
};
import { api, formatCurrency, formatDate } from '../../lib/api';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  draft: 'badge-gray', sent: 'badge-blue', viewed: 'badge-blue',
  partially_paid: 'badge-yellow', paid: 'badge-green',
  overdue: 'badge-red', void: 'badge-gray',
};

function NewInvoiceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    job_id: '', customer_id: '', due_date: '',
    notes: '', tax_rate: '0',
    items: [{ description: '', quantity: '1', unit_price: '' }],
  });
  const [loading, setLoading] = useState(false);

  const { data: jobsData } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get('/jobs?per_page=100').then(r => r.data.data) });
  const { data: contactsData } = useQuery({ queryKey: ['contacts-customers'], queryFn: () => api.get('/contacts?type=customer').then(r => r.data.data) });

  const jobs = jobsData ?? [];
  const contacts = contactsData ?? [];

  const issueDate = new Date().toISOString().split('T')[0]!;
  const defaultDue = new Date(Date.now() + 30 * 86400_000).toISOString().split('T')[0]!;

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { description: '', quantity: '1', unit_price: '' }] }));
  const updateItem = (i: number, k: string, v: string) =>
    setForm(f => { const items = [...f.items]; items[i] = { ...items[i]!, [k]: v }; return { ...f, items }; });
  const removeItem = (i: number) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const subtotal = form.items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0), 0);
  const tax = subtotal * ((parseFloat(form.tax_rate) || 0) / 100);
  const total = subtotal + tax;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.job_id || !form.customer_id) { toast.error('Job and customer required'); return; }
    if (form.items.some(i => !i.description || !i.unit_price)) { toast.error('All line items need description and price'); return; }
    setLoading(true);
    try {
      await api.post('/invoices', {
        job_id: form.job_id, customer_id: form.customer_id,
        issue_date: issueDate, due_date: form.due_date || defaultDue,
        tax_rate: parseFloat(form.tax_rate) || 0,
        notes: form.notes || undefined,
        items: form.items.map(i => ({
          description: i.description,
          quantity: parseFloat(i.quantity) || 1,
          unit_price: parseFloat(i.unit_price) || 0,
        })),
      });
      toast.success('Invoice created');
      qc.invalidateQueries({ queryKey: ['invoices'] });
      onClose();
    } catch { toast.error('Failed to create invoice'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold">New Invoice</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Job *</label>
              <select className="input" value={form.job_id} onChange={e => setForm(f => ({ ...f, job_id: e.target.value }))} required>
                <option value="">— Select Job —</option>
                {jobs.map((j: Record<string, string>) => <option key={j['id']} value={j['id']}>{j['job_number']} — {j['name']}</option>)}
              </select>
            </div>
            <ContactPicker
              id="invoice_customer"
              label="Bill To *"
              required
              value={form.customer_id}
              onChange={(id) => setForm(f => ({ ...f, customer_id: id }))}
            />
            <div>
              <label className="label">Due Date</label>
              <input className="input" type="date" value={form.due_date || defaultDue} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tax Rate (%)</label>
              <input className="input" type="number" min="0" step="0.1" value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))} />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Line Items</label>
              <button type="button" onClick={addItem} className="btn-ghost btn-sm">
                <Plus className="w-3 h-3" /> Add Line
              </button>
            </div>
            <div className="space-y-2">
              {form.items.map((item, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <input className="input col-span-6 text-sm" value={item.description} onChange={e => updateItem(i, 'description', e.target.value)} placeholder="Description" />
                  <input className="input col-span-2 text-sm text-right" type="number" min="0" step="0.01" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} placeholder="Qty" />
                  <input className="input col-span-3 text-sm text-right" type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} placeholder="Unit $" />
                  <button type="button" onClick={() => removeItem(i)} className="text-slate-300 hover:text-red-500 text-lg leading-none">×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="bg-slate-50 rounded-lg p-4 space-y-1 text-sm">
            <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            {tax > 0 && <div className="flex justify-between text-slate-600"><span>Tax ({form.tax_rate}%)</span><span>{formatCurrency(tax)}</span></div>}
            <div className="flex justify-between font-bold text-slate-900 text-base border-t border-slate-200 pt-1 mt-1">
              <span>Total</span><span>{formatCurrency(total)}</span>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Invoice
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function InvoicesPage() {
  const [fundingFor, setFundingFor] = useState<
    { id: string; invoice_number: string; total: number } | null>(null);

  // Which invoices already have a request against them, so the row shows status
  // instead of offering to request again. Finance-only endpoint, so a 403 for
  // other roles is expected and simply yields no badges.
  const { data: fundingRequests } = useQuery({
    queryKey: ['factoring-requests'],
    queryFn: () => api.get('/factoring/requests').then(r => r.data.data).catch(() => []),
  });
  const fundingByInvoice: Record<string, string> = Object.fromEntries(
    (fundingRequests ?? [])
      .filter((r: Record<string, string>) => r['status'] !== 'withdrawn')
      .map((r: Record<string, string>) => [r['invoice_id'], r['status']])
  );
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', search, statusFilter],
    queryFn: () => api.get(`/invoices?status=${statusFilter}`).then(r => r.data.data),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/invoices/${id}/send`),
    onSuccess: () => { toast.success('Invoice sent'); qc.invalidateQueries({ queryKey: ['invoices'] }); },
    onError: () => toast.error('Failed to send invoice'),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.patch(`/invoices/${id}/record-payment`, { amount }),
    onSuccess: () => { toast.success('Payment recorded'); qc.invalidateQueries({ queryKey: ['invoices'] }); },
    onError: () => toast.error('Failed to record payment'),
  });

  const invoices: Record<string, unknown>[] = Array.isArray(data) ? data : [];
  const filtered = search
    ? invoices.filter(i => (i['invoice_number'] as string)?.toLowerCase().includes(search.toLowerCase()) ||
                          (i['customer_name'] as string)?.toLowerCase().includes(search.toLowerCase()))
    : invoices;

  const totalOutstanding = invoices
    .filter(i => !['paid', 'void'].includes(i['status'] as string))
    .reduce((s, i) => s + Number(i['balance_due'] ?? 0), 0);

  return (
    <div className="page max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Invoices</h1>
          {totalOutstanding > 0 && (
            <p className="text-sm text-slate-500 mt-0.5">{formatCurrency(totalOutstanding)} outstanding</p>
          )}
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All status</option>
          {['draft','sent','partially_paid','paid','overdue','void'].map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[40rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-header">Invoice #</th>
              <th className="table-header">Job</th>
              <th className="table-header">Customer</th>
              <th className="table-header">Issue Date</th>
              <th className="table-header">Due Date</th>
              <th className="table-header text-right">Total</th>
              <th className="table-header text-right">Balance</th>
              <th className="table-header">Status</th>
              <th className="table-header">Funding</th>
              <th className="table-header" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={10} className="table-cell text-center py-8 text-slate-400">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-12 text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-slate-500">No invoices yet</p>
                </td>
              </tr>
            ) : (
              filtered.map(inv => (
                <tr key={inv['id'] as string} className="hover:bg-slate-50">
                  <td className="table-cell font-mono text-sm font-medium text-brand-600">{inv['invoice_number'] as string}</td>
                  <td className="table-cell text-slate-600">{(inv['job_name'] as string) ?? '—'}</td>
                  <td className="table-cell">{inv['customer_name'] as string}</td>
                  <td className="table-cell text-slate-500">{formatDate(inv['issue_date'] as string)}</td>
                  <td className="table-cell text-slate-500">{formatDate(inv['due_date'] as string)}</td>
                  <td className="table-cell text-right font-semibold">{formatCurrency(inv['total'] as number)}</td>
                  <td className="table-cell text-right">{formatCurrency(inv['balance_due'] as number)}</td>
                  <td className="table-cell">
                    <span className={STATUS_COLORS[inv['status'] as string] ?? 'badge-gray'}>
                      {(inv['status'] as string)?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="table-cell">
                    {fundingByInvoice[inv['id'] as string]
                      ? <span className={FUNDING_BADGE[fundingByInvoice[inv['id'] as string]!] ?? 'badge-gray'}>
                          {fundingByInvoice[inv['id'] as string]!.replace('_', ' ')}
                        </span>
                      : <button className="btn-secondary btn-sm"
                                onClick={() => setFundingFor({
                                  id: inv['id'] as string,
                                  invoice_number: inv['invoice_number'] as string,
                                  total: inv['total'] as number,
                                })}>
                          <Banknote className="w-3.5 h-3.5" /> Factor
                        </button>}
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-1">
                      {inv['status'] === 'draft' && (
                        <button
                          onClick={() => sendMutation.mutate(inv['id'] as string)}
                          className="btn-secondary btn-sm"
                          disabled={sendMutation.isPending}
                        >
                          Send
                        </button>
                      )}
                      {['sent','partially_paid','overdue'].includes(inv['status'] as string) && (
                        <button
                          onClick={() => {
                            const amt = prompt(`Record payment (balance: ${formatCurrency(inv['balance_due'] as number)})`);
                            if (amt) recordPaymentMutation.mutate({ id: inv['id'] as string, amount: parseFloat(amt) });
                          }}
                          className="btn-primary btn-sm"
                        >
                          <CheckCircle className="w-3 h-3" /> Pay
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showNew && <NewInvoiceModal onClose={() => setShowNew(false)} />}
      {fundingFor && (
        <RequestFundingModal invoice={fundingFor} onClose={() => setFundingFor(null)} />
      )}
    </div>
  );
}
