import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, apiError, formatDate } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';

interface Company {
  id: string; name: string; phone: string | null; website: string | null; address_line1: string | null;
  city: string | null; state_code: string | null; zip: string | null; license_number: string | null;
  settings?: { project_tools?: boolean; portal_mode?: string; require_mfa?: boolean };
}

interface TeamMember {
  id: string; email: string; first_name: string; last_name: string; role: string;
  is_active: boolean; last_login_at: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', accountant: 'Accountant', project_manager: 'Project manager',
  field_crew: 'Field crew', viewer: 'Viewer',
};

/**
 * Settings: the company's details, which parts of the app are on, and who
 * has access. Owners and admins only — the API enforces the same.
 */
export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const { data: company, isLoading } = useQuery<Company>({
    queryKey: ['company-settings', user?.company_id],
    queryFn: () => api.get('/settings/company').then((r) => r.data.data),
  });

  if (!['owner', 'admin'].includes(user?.role ?? '')) {
    return (
      <div className="page max-w-3xl mx-auto">
        <h1>Settings</h1>
        <p className="text-sm text-slate-500 mt-2">Settings are managed by your company&rsquo;s owner or an admin.</p>
      </div>
    );
  }
  if (isLoading || !company) {
    return <div className="page max-w-3xl mx-auto"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  }
  return (
    <div className="page max-w-3xl mx-auto space-y-6">
      <div>
        <h1>Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your company, sign-in security, and who has access.</p>
      </div>
      <CompanyDetails company={company} />
      <RequireTwoStep on={company.settings?.require_mfa === true} />
      <Team />
    </div>
  );
}

function CompanyDetails({ company }: { company: Company }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const blank = {
    name: company.name ?? '', phone: company.phone ?? '', website: company.website ?? '',
    address_line1: company.address_line1 ?? '', city: company.city ?? '', state_code: company.state_code ?? '',
    zip: company.zip ?? '', license_number: company.license_number ?? '',
  };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(blank), [company.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(blank);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Company name is required'); return; }
    const state = form.state_code.trim().toUpperCase();
    if (state && state.length !== 2) { toast.error('Use the two-letter state code'); return; }
    setBusy(true);
    try {
      // Only what changed; blanks clear a field.
      const body: Record<string, string> = {};
      for (const k of Object.keys(form) as (keyof typeof form)[]) {
        const v = k === 'state_code' ? state : form[k].trim();
        if (v !== blank[k]) body[k] = v;
      }
      if (body['state_code'] === '') delete body['state_code'];
      await api.patch('/settings/company', body);
      await qc.invalidateQueries({ queryKey: ['company-settings', user?.company_id] });
      toast.success('Saved');
    } catch (err) {
      toast.error(apiError(err, 'Couldn’t save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="card p-5 space-y-4">
      <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-slate-400" /> Company
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="co-name">Company name *</label>
          <input id="co-name" className="input" value={form.name} onChange={set('name')} maxLength={100} required />
        </div>
        <div>
          <label className="label" htmlFor="co-phone">Phone</label>
          <input id="co-phone" className="input" type="tel" value={form.phone} onChange={set('phone')} maxLength={20} />
        </div>
        <div>
          <label className="label" htmlFor="co-web">Website</label>
          <input id="co-web" className="input" type="url" placeholder="https://" value={form.website} onChange={set('website')} maxLength={200} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="co-addr">Address</label>
          <input id="co-addr" className="input" value={form.address_line1} onChange={set('address_line1')} maxLength={200} />
        </div>
        <div>
          <label className="label" htmlFor="co-city">City</label>
          <input id="co-city" className="input" value={form.city} onChange={set('city')} maxLength={100} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="co-state">State</label>
            <input id="co-state" className="input uppercase" value={form.state_code} onChange={set('state_code')} maxLength={2} />
          </div>
          <div>
            <label className="label" htmlFor="co-zip">ZIP</label>
            <input id="co-zip" className="input" value={form.zip} onChange={set('zip')} maxLength={10} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="co-lic">License number</label>
          <input id="co-lic" className="input" value={form.license_number} onChange={set('license_number')} maxLength={50} />
        </div>
      </div>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={!dirty || busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </div>
    </form>
  );
}

/** Everyone at the company must use two-step sign-in. They set it up at their next sign-in. */
function RequireTwoStep({ on }: { on: boolean }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (on && !window.confirm('Stop requiring two-step sign-in? People who use it keep it; others can turn it off.')) return;
    setBusy(true);
    try {
      await api.patch('/settings/company', { settings: { require_mfa: !on } });
      await qc.invalidateQueries({ queryKey: ['company-settings', user?.company_id] });
      toast.success(on ? 'No longer required' : 'Required for everyone from their next sign-in');
    } catch (err) {
      toast.error(apiError(err, 'Couldn’t change that'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-5">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-400" /> Require two-step sign-in
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Everyone at your company signs in with a password and a code from an authenticator app. Anyone without it
            set up is walked through it at their next sign-in. Turn it on for yourself first, in{' '}
            <Link to="/account" className="text-brand-600 hover:underline">Your account</Link>.
          </p>
        </div>
        <button role="switch" aria-checked={on} aria-label="Require two-step sign-in" disabled={busy} onClick={() => void toggle()}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  on ? 'bg-brand-600' : 'bg-slate-300'}`}>
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            on ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </section>
  );
}

function Team() {
  const { data: team = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['team'],
    queryFn: () => api.get('/settings/users').then((r) => r.data.data),
  });
  return (
    <section className="card">
      <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2 px-5 pt-5">
        <Users className="w-4 h-4 text-slate-400" /> Who has access
      </h2>
      {isLoading ? (
        <div className="p-5"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
      ) : (
        <ul className="divide-y divide-slate-100 mt-3">
          {team.map((m) => (
            <li key={m.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-5 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {m.first_name} {m.last_name}
                  {!m.is_active && <span className="badge-gray ml-2">Deactivated</span>}
                </p>
                <p className="text-xs text-slate-500 truncate">{m.email}</p>
              </div>
              <span className="text-sm text-slate-600">{ROLE_LABEL[m.role] ?? m.role}</span>
              <span className="text-xs text-slate-400 sm:w-32 sm:text-right">
                {m.last_login_at ? `Last in ${formatDate(m.last_login_at)}` : 'Never signed in'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
