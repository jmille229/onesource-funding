import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Loader2, Plus, UserPlus } from 'lucide-react';
import { adminApi } from '../../lib/admin-api';
import { formatCurrency, formatDate, todayISO } from '../../lib/api';
import { CopyLink } from './CopyLink';
import { ClientHistory } from './ClientHistory';

/**
 * Funding clients: the book, adding a client by hand (for clients signed
 * outside the online application), and each client's terms, screening and
 * logins.
 */

type ErrorLike = { response?: { status?: number; data?: { message?: string; code?: string; details?: Record<string, string[]> } } };
const errMsg = (e: unknown, fallback: string) => {
  const d = (e as ErrorLike).response?.data;
  const field = d?.details && Object.entries(d.details).find(([, v]) => v?.length);
  return field ? `${field[0].replace(/_/g, ' ')}: ${field[1][0]}` : d?.message ?? fallback;
};

const STATUS_BADGE: Record<string, string> = {
  active: 'badge-green', prospect: 'badge-blue', suspended: 'badge-orange', closed: 'badge-gray',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Active', prospect: 'Prospect', suspended: 'Suspended', closed: 'Closed',
};

interface ClientRow {
  id: string; company_id: string; company_name: string; status: string; credit_limit: string | null;
  onboarded_on: string | null; default_fee_schedule_id: string | null; fee_schedule_name: string | null;
  advanced_outstanding: string; outstanding_count: string; negative_list: boolean;
  login_count: string | null; login_pending: string | null;
}
interface FeeSchedule { id: string; name: string; retired_at?: string | null }

const useFeeSchedules = () => useQuery<FeeSchedule[]>({
  queryKey: ['admin-fee-schedules'], queryFn: () => adminApi.get('/fee-schedules').then((r) => r.data.data),
});

export function ClientsPanel() {
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; link: string } | null>(null);
  const { data, isLoading } = useQuery<ClientRow[]>({
    queryKey: ['admin-clients'], queryFn: () => adminApi.get('/clients').then((r) => r.data.data),
  });

  if (openId) {
    return <ClientDetail id={openId} onBack={() => setOpenId(null)}
                         initialLink={created ? { label: `Set-password link for ${created.name}`, url: created.link } : null}
                         onLinkShown={() => setCreated(null)} />;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Clients</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Funding clients. Applications approved online appear here automatically; add anyone else by hand.
          </p>
        </div>
        {!adding && <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add client</button>}
      </div>

      {adding && (
        <AddClientForm onCancel={() => setAdding(false)} onCreated={(r) => {
          setAdding(false);
          if (r.invite_link) setCreated({ name: r.company_name, link: r.invite_link });
          setOpenId(r.client_id);
        }} />
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[52rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Client', 'Status', 'Fee schedule', 'Credit limit', 'Open', 'Advanced', 'Login'].map((h) => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">Loading…</td></tr>}
            {!isLoading && (data ?? []).length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">No clients yet</td></tr>
            )}
            {(data ?? []).map((r) => {
              const logins = Number(r.login_count ?? 0);
              const pending = Number(r.login_pending ?? 0);
              return (
                <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <td className="table-cell">
                    <button className="font-medium text-left text-brand-700 hover:underline" onClick={() => setOpenId(r.id)}>
                      {r.company_name}
                    </button>
                    {r.negative_list && <span className="badge-red ml-2">negative list</span>}
                  </td>
                  <td className="table-cell"><span className={STATUS_BADGE[r.status] ?? 'badge-gray'}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td className="table-cell">{r.fee_schedule_name ?? <span className="text-orange-600">none</span>}</td>
                  <td className="table-cell text-right tabular-nums">{r.credit_limit ? formatCurrency(r.credit_limit) : '—'}</td>
                  <td className="table-cell text-right tabular-nums">{r.outstanding_count}</td>
                  <td className="table-cell text-right tabular-nums">{formatCurrency(r.advanced_outstanding)}</td>
                  <td className="table-cell text-slate-600">
                    {logins === 0 ? <span className="text-slate-400">none</span>
                      : pending === logins ? <span className="text-orange-600">invite sent</span>
                      : `${logins} active`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Add a client ─────────────────────────────────────────────────────────────

interface Created { client_id: string; company_id: string; company_name: string; linked_existing: boolean; invite_link: string | null }

function AddClientForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: Created) => void }) {
  const qc = useQueryClient();
  const { data: schedules } = useFeeSchedules();
  const [form, setForm] = useState({
    legal_name: '', status: 'active', fee_schedule_id: '', credit_limit: '', onboarded_on: todayISO(), notes: '',
    first_name: '', last_name: '', email: '', phone: '',
  });
  const [withLogin, setWithLogin] = useState(true);
  const [sendInvite, setSendInvite] = useState(true);
  const [existing, setExisting] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (k === 'email') setExisting(null);
  };
  const usable = (schedules ?? []).filter((s) => !s.retired_at);

  const create = useMutation({
    mutationFn: (useExisting: boolean) => {
      const limit = form.credit_limit.replace(/[$,\s]/g, '');
      return adminApi.post('/clients/new', {
        legal_name: form.legal_name.trim(),
        status: form.status,
        fee_schedule_id: form.fee_schedule_id,
        credit_limit: limit ? Number(limit) : null,
        onboarded_on: form.onboarded_on || null,
        notes: form.notes.trim() || null,
        login: withLogin ? {
          first_name: form.first_name.trim(), last_name: form.last_name.trim(),
          email: form.email.trim(), phone: form.phone.trim() || null,
        } : null,
        send_invite: sendInvite,
        use_existing_login: useExisting,
      }).then((r) => r.data.data as Created);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin-clients'] });
      toast.success(r.linked_existing ? `Funding turned on for ${r.company_name}` : `${r.company_name} added`);
      onCreated(r);
    },
    onError: (e) => {
      const d = (e as ErrorLike).response?.data;
      if (d?.code === 'login_exists' && withLogin) { setExisting(d.message ?? 'That email already has a login.'); return; }
      toast.error(errMsg(e, 'Couldn’t add the client'));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const limit = form.credit_limit.replace(/[$,\s]/g, '');
    if (limit && !Number.isFinite(Number(limit))) { toast.error('Enter the credit limit as a number'); return; }
    create.mutate(false);
  };

  return (
    <form className="card p-5 mb-5 space-y-5" onSubmit={submit}>
      <div>
        <h3>Add a client</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          For a client you’ve signed outside the online application. They get the funding-only portal.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="ac_name">Business legal name</label>
        <input id="ac_name" className="input" value={form.legal_name} onChange={set('legal_name')} required minLength={2} maxLength={200} autoFocus />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Terms</legend>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label" htmlFor="ac_status">Status</label>
            <select id="ac_status" className="input" value={form.status} onChange={set('status')}>
              <option value="active">Active — can be funded</option>
              <option value="prospect">Prospect — not yet</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ac_fee">Fee schedule</label>
            <select id="ac_fee" className="input" value={form.fee_schedule_id} onChange={set('fee_schedule_id')} required>
              <option value="">Select…</option>
              {usable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ac_limit">Credit limit <span className="font-normal text-slate-400">(optional)</span></label>
            <input id="ac_limit" className="input" inputMode="decimal" value={form.credit_limit} onChange={set('credit_limit')} placeholder="e.g. 250000" />
          </div>
          <div>
            <label className="label" htmlFor="ac_on">Onboarded</label>
            <input id="ac_on" type="date" className="input" value={form.onboarded_on} onChange={set('onboarded_on')} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ac_notes">Notes <span className="font-normal text-slate-400">(optional — address, referral source, anything else)</span></label>
          <textarea id="ac_notes" className="input" rows={2} maxLength={4000} value={form.notes} onChange={set('notes')} />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Login</legend>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="w-4 h-4" checked={withLogin} onChange={(e) => { setWithLogin(e.target.checked); setExisting(null); }} />
          Give them a login, so they can submit invoices and see their advances
        </label>
        {withLogin ? (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="label" htmlFor="ac_first">First name</label>
                <input id="ac_first" className="input" value={form.first_name} onChange={set('first_name')} required maxLength={80} />
              </div>
              <div>
                <label className="label" htmlFor="ac_last">Last name</label>
                <input id="ac_last" className="input" value={form.last_name} onChange={set('last_name')} required maxLength={80} />
              </div>
              <div>
                <label className="label" htmlFor="ac_email">Email</label>
                <input id="ac_email" type="email" className="input" value={form.email} onChange={set('email')} required maxLength={254} />
              </div>
              <div>
                <label className="label" htmlFor="ac_phone">Phone <span className="font-normal text-slate-400">(optional)</span></label>
                <input id="ac_phone" type="tel" className="input" value={form.phone} onChange={set('phone')} maxLength={30} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="w-4 h-4" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
              Email them the set-password link now (it’s also shown here to copy)
            </label>
          </>
        ) : (
          <p className="text-sm text-slate-500">You can add a login later from the client’s page.</p>
        )}
      </fieldset>

      {existing && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 space-y-2" role="alert">
          <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {existing}</p>
          <p>
            You can make that company the funding client instead — they keep their login and their existing
            ConstructPM tools. Only do this if you’ve confirmed it’s the same business.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={create.isPending} onClick={() => create.mutate(true)}>
              Turn on funding for that company
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setExisting(null)}>Use a different email</button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-primary" disabled={create.isPending || Boolean(existing)}>
          {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add client
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ─── One client ───────────────────────────────────────────────────────────────

interface Login {
  user_id: string; email: string; first_name: string; last_name: string; role: string;
  phone: string | null; pending: boolean; last_login_at: string | null;
}
type Screening = 'unknown' | 'clean' | 'present';
interface ClientDetailData {
  client: {
    id: string; company_id: string; company_name: string; status: string; credit_limit: string | null;
    default_fee_schedule_id: string | null; onboarded_on: string | null; notes: string | null;
    tax_lien_personal: Screening; tax_lien_business: Screening; judgement: Screening; lawsuit: Screening;
    existing_ucc: Screening; ucc_is_prior_factor: boolean; personal_guarantee: boolean;
    uses_subs: boolean | null; does_progress_billing: boolean | null;
    negative_list: boolean; negative_list_reason: string | null;
  };
  logins: Login[];
}

function ClientDetail({ id, onBack, initialLink, onLinkShown }: {
  id: string; onBack: () => void;
  initialLink: { label: string; url: string } | null; onLinkShown: () => void;
}) {
  const [link, setLink] = useState<{ label: string; url: string; note?: string } | null>(
    initialLink ? { ...initialLink, note: 'Emailed to them if you chose to and email is set up — send it yourself if not. Works once, for 14 days.' } : null);
  // A client just added has no history yet, so it opens on its setup.
  const [view, setView] = useState<'history' | 'setup'>(initialLink ? 'setup' : 'history');
  const key = ['admin-client', id];
  const { data, isLoading } = useQuery<ClientDetailData>({
    queryKey: key, queryFn: () => adminApi.get(`/clients/${id}`).then((r) => r.data.data),
    staleTime: 0, refetchOnMount: 'always',
  });

  if (isLoading || !data) {
    return <div className="card p-8 text-center text-sm text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline" /> Loading…</div>;
  }
  const c = data.client;

  return (
    <div className="space-y-5">
      <button className="btn-ghost btn-sm" onClick={() => { onLinkShown(); onBack(); }}><ArrowLeft className="w-4 h-4" /> All clients</button>
      <div className="flex flex-wrap items-center gap-2">
        <h2>{c.company_name}</h2>
        <span className={STATUS_BADGE[c.status] ?? 'badge-gray'}>{STATUS_LABEL[c.status] ?? c.status}</span>
        {c.negative_list && <span className="badge-red">negative list</span>}
      </div>

      {link && <CopyLink {...link} onDismiss={() => { setLink(null); onLinkShown(); }} />}

      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {([['history', 'History'], ['setup', 'Terms, logins & screening']] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              view === v ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'history' ? (
        <ClientHistory clientId={c.id} companyId={c.company_id} companyName={c.company_name} />
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-5 items-start">
            <TermsCard key={`terms-${c.id}-${c.status}-${c.credit_limit}-${c.default_fee_schedule_id}`} client={c} />
            <LoginsCard clientId={c.id} logins={data.logins}
                        onLink={(l) => setLink({ ...l, note: 'Emailed to them if you chose to and email is set up — send it yourself if not. Works once, for 14 days.' })} />
          </div>
          <ScreeningCard key={`screen-${c.id}`} client={c} />
        </>
      )}
    </div>
  );
}

function useRefreshClient(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['admin-client', id] });
    qc.invalidateQueries({ queryKey: ['admin-clients'] });
    qc.invalidateQueries({ queryKey: ['admin-client-history', id] });
  };
}

function TermsCard({ client: c }: { client: ClientDetailData['client'] }) {
  const refresh = useRefreshClient(c.id);
  const { data: schedules } = useFeeSchedules();
  const [form, setForm] = useState({
    status: c.status, default_fee_schedule_id: c.default_fee_schedule_id ?? '',
    credit_limit: c.credit_limit ? String(Number(c.credit_limit)) : '', onboarded_on: c.onboarded_on?.slice(0, 10) ?? '',
    notes: c.notes ?? '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const limit = form.credit_limit.replace(/[$,\s]/g, '');
      return adminApi.patch(`/clients/${c.id}`, {
        status: form.status,
        default_fee_schedule_id: form.default_fee_schedule_id || null,
        credit_limit: limit ? Number(limit) : null,
        onboarded_on: form.onboarded_on || null,
        notes: form.notes.trim() || null,
      });
    },
    onSuccess: () => { toast.success('Terms saved'); refresh(); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t save')),
  });

  return (
    <form className="card p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h3>Terms</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ct_status">Status</label>
          <select id="ct_status" className="input" value={form.status} onChange={set('status')}>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ct_fee">Fee schedule</label>
          <select id="ct_fee" className="input" value={form.default_fee_schedule_id} onChange={set('default_fee_schedule_id')}>
            <option value="">None</option>
            {(schedules ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.retired_at ? ' (retired)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ct_limit">Credit limit</label>
          <input id="ct_limit" className="input" inputMode="decimal" value={form.credit_limit} onChange={set('credit_limit')} placeholder="No limit set" />
        </div>
        <div>
          <label className="label" htmlFor="ct_on">Onboarded</label>
          <input id="ct_on" type="date" className="input" value={form.onboarded_on} onChange={set('onboarded_on')} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="ct_notes">Notes</label>
        <textarea id="ct_notes" className="input" rows={3} maxLength={4000} value={form.notes} onChange={set('notes')} />
      </div>
      <p className="text-xs text-slate-500">
        Changing the fee schedule affects new advances only; funded advances keep the terms they were funded on.
      </p>
      <button className="btn-primary" disabled={save.isPending}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save terms</button>
    </form>
  );
}

function LoginsCard({ clientId, logins, onLink }: {
  clientId: string; logins: Login[]; onLink: (l: { label: string; url: string }) => void;
}) {
  const refresh = useRefreshClient(clientId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [sendInvite, setSendInvite] = useState(true);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const add = useMutation({
    mutationFn: () => adminApi.post(`/clients/${clientId}/logins`, {
      ...form, phone: form.phone.trim() || null, send_invite: sendInvite,
    }).then((r) => r.data.data as { invite_link: string }),
    onSuccess: (d) => {
      onLink({ label: `Set-password link for ${form.first_name} ${form.last_name}`, url: d.invite_link });
      setForm({ first_name: '', last_name: '', email: '', phone: '' });
      setAdding(false);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t add the login')),
  });
  const reinvite = useMutation({
    mutationFn: (l: Login) => adminApi.post(`/clients/${clientId}/logins/${l.user_id}/invite`, { send_invite: sendInvite })
      .then((r) => ({ login: l, link: (r.data.data as { invite_link: string }).invite_link })),
    onSuccess: ({ login, link }) => onLink({ label: `Set-password link for ${login.first_name} ${login.last_name}`, url: link }),
    onError: (e) => toast.error(errMsg(e, 'Couldn’t make a new link')),
  });

  return (
    <div className="card">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h3>Logins</h3>
          <p className="text-xs text-slate-500 mt-0.5">People at this client who can sign in.</p>
        </div>
        {!adding && <button className="btn-secondary btn-sm" onClick={() => setAdding(true)}><UserPlus className="w-4 h-4" /> Add a login</button>}
      </div>
      {logins.length === 0 && !adding && (
        <p className="px-5 py-6 text-sm text-slate-500">No logins yet. Add one so they can submit invoices and follow their advances.</p>
      )}
      <ul className="divide-y divide-slate-100">
        {logins.map((l) => (
          <li key={l.user_id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {l.first_name} {l.last_name} <span className="text-xs font-normal text-slate-500 capitalize">· {l.role}</span>
              </p>
              <p className="text-sm text-slate-600 truncate">{l.email}{l.phone ? ` · ${l.phone}` : ''}</p>
              <p className="text-xs mt-0.5">
                {l.pending
                  ? <span className="text-orange-600">Hasn’t set a password yet</span>
                  : <span className="text-slate-500">{l.last_login_at ? `Last signed in ${formatDate(l.last_login_at)}` : 'Password set'}</span>}
              </p>
            </div>
            <button className="btn-ghost btn-sm self-start sm:self-auto" disabled={reinvite.isPending}
              onClick={() => {
                if (!l.pending && !window.confirm(`Make a password-reset link for ${l.email}? Their current password keeps working until they use it.`)) return;
                reinvite.mutate(l);
              }}>
              {l.pending ? 'New set-password link' : 'Password reset link'}
            </button>
          </li>
        ))}
      </ul>
      {adding && (
        <form className="px-5 py-4 border-t border-slate-100 space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="al_first">First name</label>
              <input id="al_first" className="input" value={form.first_name} onChange={set('first_name')} required maxLength={80} autoFocus /></div>
            <div><label className="label" htmlFor="al_last">Last name</label>
              <input id="al_last" className="input" value={form.last_name} onChange={set('last_name')} required maxLength={80} /></div>
            <div><label className="label" htmlFor="al_email">Email</label>
              <input id="al_email" type="email" className="input" value={form.email} onChange={set('email')} required maxLength={254} /></div>
            <div><label className="label" htmlFor="al_phone">Phone <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="al_phone" type="tel" className="input" value={form.phone} onChange={set('phone')} maxLength={30} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="w-4 h-4" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
            Email them the set-password link
          </label>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" disabled={add.isPending}>Add login</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

const SCREENING_FIELDS: [keyof ClientDetailData['client'], string][] = [
  ['tax_lien_personal', 'Personal tax liens'], ['tax_lien_business', 'Business tax liens'],
  ['judgement', 'Judgments'], ['lawsuit', 'Lawsuits'], ['existing_ucc', 'Existing UCC filings'],
];

/** The client underwriting sheet: what the underwriting engine scores requests against. */
function ScreeningCard({ client: c }: { client: ClientDetailData['client'] }) {
  const refresh = useRefreshClient(c.id);
  const [form, setForm] = useState({
    tax_lien_personal: c.tax_lien_personal, tax_lien_business: c.tax_lien_business, judgement: c.judgement,
    lawsuit: c.lawsuit, existing_ucc: c.existing_ucc, ucc_is_prior_factor: c.ucc_is_prior_factor,
    personal_guarantee: c.personal_guarantee, uses_subs: c.uses_subs, does_progress_billing: c.does_progress_billing,
    negative_list: c.negative_list, negative_list_reason: c.negative_list_reason ?? '',
  });
  const save = useMutation({
    mutationFn: () => adminApi.patch(`/clients/${c.id}/underwriting`, {
      ...form, negative_list_reason: form.negative_list ? (form.negative_list_reason.trim() || null) : null,
    }),
    onSuccess: () => { toast.success('Screening saved'); refresh(); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t save')),
  });
  const tri = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
  const fromTri = (v: string) => (v === '' ? null : v === 'yes');

  return (
    <form className="card p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div>
        <h3>Screening</h3>
        <p className="text-xs text-slate-500 mt-0.5">What the underwriting engine checks each funding request against.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {SCREENING_FIELDS.map(([k, label]) => (
          <div key={k}>
            <label className="label" htmlFor={`sc_${k}`}>{label}</label>
            <select id={`sc_${k}`} className="input" value={form[k as keyof typeof form] as string}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}>
              <option value="unknown">Not checked</option>
              <option value="clean">None found</option>
              <option value="present">Found</option>
            </select>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="label" htmlFor="sc_subs">Uses subcontractors?</label>
          <select id="sc_subs" className="input" value={tri(form.uses_subs)} onChange={(e) => setForm((f) => ({ ...f, uses_subs: fromTri(e.target.value) }))}>
            <option value="">Not asked</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sc_prog">Bills progress payments?</label>
          <select id="sc_prog" className="input" value={tri(form.does_progress_billing)} onChange={(e) => setForm((f) => ({ ...f, does_progress_billing: fromTri(e.target.value) }))}>
            <option value="">Not asked</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:pt-6">
          <input type="checkbox" className="w-4 h-4" checked={form.ucc_is_prior_factor} onChange={(e) => setForm((f) => ({ ...f, ucc_is_prior_factor: e.target.checked }))} />
          A UCC is from another factor
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:pt-6">
          <input type="checkbox" className="w-4 h-4" checked={form.personal_guarantee} onChange={(e) => setForm((f) => ({ ...f, personal_guarantee: e.target.checked }))} />
          Personal guarantee signed
        </label>
      </div>
      <div className="rounded-md border border-slate-200 p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="w-4 h-4" checked={form.negative_list} onChange={(e) => setForm((f) => ({ ...f, negative_list: e.target.checked }))} />
          On the negative list — don’t fund
        </label>
        {form.negative_list && (
          <input className="input" placeholder="Reason" maxLength={1000} value={form.negative_list_reason}
                 onChange={(e) => setForm((f) => ({ ...f, negative_list_reason: e.target.value }))} aria-label="Negative list reason" />
        )}
      </div>
      <button className="btn-primary" disabled={save.isPending}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save screening</button>
    </form>
  );
}
