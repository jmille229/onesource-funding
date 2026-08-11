import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';

interface Contact { id: string; name: string; type: string }

/**
 * Contact select with inline creation.
 *
 * Previously these flows only offered contacts that already existed, so adding a
 * customer meant abandoning a half-filled job or invoice, going to Contacts, and
 * starting again. The "＋ Add new" option opens a small form in place, creates
 * the contact, and selects it — no navigation, nothing lost.
 */
export function ContactPicker({
  value, onChange, type = 'customer', label = 'Customer', required = false, id = 'contact',
}: {
  value: string;
  onChange: (id: string) => void;
  type?: 'customer' | 'vendor' | 'subcontractor';
  label?: string;
  required?: boolean;
  id?: string;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', phone: '' });

  const { data } = useQuery<Contact[]>({
    queryKey: ['contacts', type],
    queryFn: () => api.get(`/contacts?type=${type}`).then((r) => r.data.data),
  });
  const contacts = data ?? [];

  const create = async () => {
    if (!draft.name.trim()) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      const r = await api.post('/contacts', {
        name: draft.name.trim(),
        type,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
      });
      const created: Contact = r.data.data;
      // Refresh every list that could show this contact, then select it.
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      onChange(created.id);
      setCreating(false);
      setDraft({ name: '', email: '', phone: '' });
      toast.success(`${created.name} added`);
    } catch {
      toast.error('Could not create the contact');
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="rounded-md border border-brand-200 bg-brand-50/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">New {type}</p>
          <button type="button" className="text-xs text-slate-500 hover:text-slate-800"
                  onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
        <div>
          <label className="label" htmlFor={`${id}_new_name`}>Name</label>
          <input id={`${id}_new_name`} className="input" value={draft.name} autoFocus
                 onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                 // Enter should add the contact, not submit the parent form.
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor={`${id}_new_email`}>Email</label>
            <input id={`${id}_new_email`} type="email" className="input" value={draft.email}
                   onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}_new_phone`}>Phone</label>
            <input id={`${id}_new_phone`} className="input" value={draft.phone}
                   onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
          </div>
        </div>
        {/* type="button" throughout: this sits inside the job/invoice form and
            must never submit it. */}
        <button type="button" className="btn-primary btn-sm" onClick={() => void create()} disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Add {type}
        </button>
      </div>
    );
  }

  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <select
          id={id} className="input flex-1" value={value} required={required}
          onChange={(e) => {
            if (e.target.value === '__new__') { setCreating(true); return; }
            onChange(e.target.value);
          }}
        >
          <option value="">Select…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="__new__">＋ Add new {type}…</option>
        </select>
        <button type="button" className="btn-secondary flex-shrink-0" onClick={() => setCreating(true)}
                aria-label={`Add new ${type}`} title={`Add new ${type}`}>
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
