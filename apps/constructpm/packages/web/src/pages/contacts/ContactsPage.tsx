import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Search, Phone, Mail, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from 'sonner';

const TYPE_COLORS: Record<string, string> = {
  customer: 'badge-blue', vendor: 'badge-yellow',
  subcontractor: 'badge-green', both: 'badge-gray',
};

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function ContactModal({ contact, onClose }: { contact?: Record<string, unknown> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!contact?.['id'];
  const [form, setForm] = useState({
    name: (contact?.['name'] as string) ?? '',
    type: (contact?.['type'] as string) ?? 'customer',
    email: (contact?.['email'] as string) ?? '',
    phone: (contact?.['phone'] as string) ?? '',
    address_line1: (contact?.['address_line1'] as string) ?? '',
    city: (contact?.['city'] as string) ?? '',
    state_code: (contact?.['state_code'] as string) ?? '',
    zip: (contact?.['zip'] as string) ?? '',
    license_number: (contact?.['license_number'] as string) ?? '',
    notes: (contact?.['notes'] as string) ?? '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name required'); return; }
    setLoading(true);
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
      if (isEdit) {
        await api.patch(`/contacts/${contact!['id']}`, payload);
        toast.success('Contact updated');
      } else {
        await api.post('/contacts', payload);
        toast.success('Contact created');
      }
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts-customers'] });
      onClose();
    } catch { toast.error('Failed to save contact'); }
    finally { setLoading(false); }
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b"><h3 className="text-lg font-semibold">{isEdit ? 'Edit' : 'New'} Contact</h3></div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Name *</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
                {['customer','vendor','subcontractor','both'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} type="tel" />
            </div>
            <div className="col-span-2">
              <label className="label">Email</label>
              <input className="input" value={form.email} onChange={e => set('email', e.target.value)} type="email" />
            </div>
            <div className="col-span-2">
              <label className="label">Street Address</label>
              <input className="input" value={form.address_line1} onChange={e => set('address_line1', e.target.value)} />
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
            <div>
              <label className="label">License #</label>
              <input className="input" value={form.license_number} onChange={e => set('license_number', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ContactsPage() {
  const [showModal, setShowModal] = useState(false);
  const [editContact, setEditContact] = useState<Record<string, unknown> | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search, typeFilter],
    queryFn: () => api.get(`/contacts?search=${search}&type=${typeFilter}`).then(r => r.data.data),
  });

  const contacts: Record<string, unknown>[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Contacts</h1>
        <button onClick={() => { setEditContact(null); setShowModal(true); }} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> New Contact
        </button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search contacts..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-40" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {['customer','vendor','subcontractor','both'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="card p-8 text-center text-slate-400">Loading...</div>
      ) : contacts.length === 0 ? (
        <div className="card p-12 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500 font-medium">No contacts yet</p>
          <button onClick={() => setShowModal(true)} className="btn-primary btn-sm mt-4"><Plus className="w-4 h-4" /> Add Contact</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contacts.map(c => (
            <button
              key={c['id'] as string}
              onClick={() => { setEditContact(c); setShowModal(true); }}
              className="card p-4 text-left hover:border-brand-300 transition-colors w-full"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-semibold text-sm flex-shrink-0">
                  {(c['name'] as string)[0]?.toUpperCase()}
                </div>
                <span className={TYPE_COLORS[c['type'] as string] ?? 'badge-gray'}>{c['type'] as string}</span>
              </div>
              <p className="font-semibold text-slate-900 text-sm truncate">{c['name'] as string}</p>
              {Boolean(c['email']) && (
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-1 truncate">
                  <Mail className="w-3 h-3 flex-shrink-0" />{c['email'] as string}
                </p>
              )}
              {Boolean(c['phone']) && (
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3 flex-shrink-0" />{c['phone'] as string}
                </p>
              )}
              {Boolean(c['city'] || c['state_code']) && (
                <p className="text-xs text-slate-400 mt-1">{[c['city'], c['state_code']].filter(Boolean).join(', ')}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {showModal && <ContactModal contact={editContact} onClose={() => { setShowModal(false); setEditContact(null); }} />}
    </div>
  );
}
