import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

const CONTRACT_TYPES = [
  { value: 'lump_sum', label: 'Lump Sum / Fixed Price' },
  { value: 'gmp', label: 'Guaranteed Maximum Price (GMP)' },
  { value: 'cost_plus_fixed', label: 'Cost Plus Fixed Fee' },
  { value: 'cost_plus_pct', label: 'Cost Plus Percentage' },
  { value: 'time_and_materials', label: 'Time & Materials (T&M)' },
  { value: 'unit_price', label: 'Unit Price' },
];

const STATUS_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'bidding', label: 'Bidding' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'active', label: 'Active' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

export function JobNewPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '', job_number: '', description: '', status: 'lead',
    contract_type: 'lump_sum', contract_amount: '',
    start_date: '', end_date: '',
    address_line1: '', city: '', state_code: '', zip: '',
    customer_id: '', project_manager_id: '',
    retainage_pct: '10', prevailing_wage_required: false,
  });

  const { data: contactsData } = useQuery({
    queryKey: ['contacts', 'customer'],
    queryFn: () => api.get('/contacts?type=customer').then(r => r.data.data),
  });
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/settings/users').then(r => r.data.data).catch(() => []),
  });

  const customers = contactsData ?? [];
  const users = usersData ?? [];

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Job name is required'); return; }
    setLoading(true);
    try {
      const payload = {
        ...form,
        contract_amount: form.contract_amount ? parseFloat(form.contract_amount) : undefined,
        retainage_pct: parseFloat(form.retainage_pct) || 10,
        customer_id: form.customer_id || undefined,
        project_manager_id: form.project_manager_id || undefined,
        job_number: form.job_number || undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      };
      const res = await api.post('/jobs', payload);
      toast.success('Job created');
      navigate(`/jobs/${res.data.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create job';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/jobs')} className="btn-ghost btn-sm">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-xl font-bold text-slate-900">New Job</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-900 text-sm uppercase tracking-wide text-slate-500">Basic Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Job Name *</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Downtown Office Renovation" required />
            </div>
            <div>
              <label className="label">Job Number</label>
              <input className="input" value={form.job_number} onChange={e => set('job_number', e.target.value)} placeholder="Auto-assigned if blank" />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">Description</label>
              <textarea className="input" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional description" />
            </div>
          </div>
        </div>

        {/* Contract */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-500 text-sm uppercase tracking-wide">Contract</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Contract Type</label>
              <select className="input" value={form.contract_type} onChange={e => set('contract_type', e.target.value)}>
                {CONTRACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Contract Amount ($)</label>
              <input className="input" type="number" step="0.01" min="0" value={form.contract_amount} onChange={e => set('contract_amount', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Retainage %</label>
              <input className="input" type="number" step="0.5" min="0" max="100" value={form.retainage_pct} onChange={e => set('retainage_pct', e.target.value)} />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input
                id="pw"
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-brand-600"
                checked={form.prevailing_wage_required}
                onChange={e => set('prevailing_wage_required', e.target.checked)}
              />
              <label htmlFor="pw" className="text-sm text-slate-700">Prevailing Wage / Davis-Bacon Required</label>
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-500 text-sm uppercase tracking-wide">Schedule</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Start Date</label>
              <input className="input" type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label">End Date</label>
              <input className="input" type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-500 text-sm uppercase tracking-wide">Project Location</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Street Address</label>
              <input className="input" value={form.address_line1} onChange={e => set('address_line1', e.target.value)} placeholder="123 Main St" />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">State</label>
                <select className="input" value={form.state_code} onChange={e => set('state_code', e.target.value)}>
                  <option value="">—</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">ZIP</label>
                <input className="input" value={form.zip} onChange={e => set('zip', e.target.value)} maxLength={10} />
              </div>
            </div>
          </div>
        </div>

        {/* People */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-500 text-sm uppercase tracking-wide">People</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Customer / Owner</label>
              <select className="input" value={form.customer_id} onChange={e => set('customer_id', e.target.value)}>
                <option value="">— Select customer —</option>
                {customers.map((c: Record<string, string>) => (
                  <option key={c['id']} value={c['id']}>{c['name']}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Project Manager</label>
              <select className="input" value={form.project_manager_id} onChange={e => set('project_manager_id', e.target.value)}>
                <option value="">— Select PM —</option>
                {users.map((u: Record<string, string>) => (
                  <option key={u['id']} value={u['id']}>{u['first_name']} {u['last_name']}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/jobs')} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Job
          </button>
        </div>
      </form>
    </div>
  );
}
