import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Shield, Loader2, LogOut } from 'lucide-react';
import { adminApi, useAdminStore, hasAdminToken } from '../../lib/admin-api';
import { DebtorsPanel } from './DebtorsPanel';
import { formatCurrency, formatDate } from '../../lib/api';
import { UnderwritingQueue } from './UnderwritingQueue';
import { ApplicationsPanel } from './ApplicationsPanel';
import { ImportPanel } from './ImportPanel';
import { ClientsPanel } from './ClientsPanel';
import { AdvancesTable } from './AdvancesTable';

// ─── Login ────────────────────────────────────────────────────────────────────
function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const login = useAdminStore((s) => s.login);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      toast.error(status === 503
        ? 'The factoring console is not enabled on this deployment.'
        : 'Invalid email or password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">OneSource Console</span>
        </div>
        <div className="card p-8">
          <h1 className="text-xl font-bold text-slate-900 mb-1">Operator sign in</h1>
          <p className="text-sm text-slate-500 mb-6">Factoring administration</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label" htmlFor="admin_email">Email</label>
              <input id="admin_email" type="email" className="input" value={email}
                     onChange={(e) => setEmail(e.target.value)} required autoFocus
                     autoComplete="username" />
            </div>
            <div>
              <label className="label" htmlFor="admin_password">Password</label>
              <input id="admin_password" type="password" className="input" value={password}
                     onChange={(e) => setPassword(e.target.value)} required
                     autoComplete="current-password" />
            </div>
            <button className="btn-primary w-full mt-2" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Sign in
            </button>
          </form>
        </div>
        <p className="text-xs text-slate-500 mt-4 text-center">
          Operator accounts are separate from client logins.
        </p>
      </div>
    </div>
  );
}

// ─── Fund an invoice ──────────────────────────────────────────────────────────
function FundForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    company_id: '', debtor_id: '', invoice_number: '', face_amount: '',
    advanced_on: new Date().toISOString().slice(0, 10), invoice_due_on: '',
  });

  const { data: clients } = useQuery({
    queryKey: ['admin-clients'], queryFn: () => adminApi.get('/clients').then(r => r.data.data),
  });
  const { data: debtors } = useQuery({
    queryKey: ['admin-debtors'], queryFn: () => adminApi.get('/debtors').then(r => r.data.data),
  });

  const fund = useMutation({
    mutationFn: () => adminApi.post('/invoices', {
      ...form,
      invoice_number: form.invoice_number.trim() || null,
      face_amount: Number(form.face_amount),
      invoice_due_on: form.invoice_due_on || null,
    }),
    onSuccess: () => {
      toast.success('Advance funded');
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
      qc.invalidateQueries({ queryKey: ['admin-clients'] });
      onDone();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'Could not fund the invoice'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className="card p-4 space-y-4 mb-5"
          onSubmit={(e) => { e.preventDefault(); fund.mutate(); }}>
      <h3>Fund an invoice</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Client</label>
          <select className="input" value={form.company_id} onChange={set('company_id')} required>
            <option value="">Select…</option>
            {(clients ?? []).map((c: { company_id: string; company_name: string }) => (
              <option key={c.company_id} value={c.company_id}>{c.company_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Debtor</label>
          <select className="input" value={form.debtor_id} onChange={set('debtor_id')} required>
            <option value="">Select…</option>
            {(debtors ?? []).map((d: { id: string; legal_name: string }) => (
              <option key={d.id} value={d.id}>{d.legal_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Invoice number</label>
          <input className="input" value={form.invoice_number} onChange={set('invoice_number')}
                 placeholder="Optional — leave blank for an auto INV-… id" />
        </div>
        <div>
          <label className="label">Face amount</label>
          <input className="input" type="number" step="0.01" min="0.01"
                 value={form.face_amount} onChange={set('face_amount')} required />
        </div>
        <div>
          <label className="label">Advanced on</label>
          <input className="input" type="date" value={form.advanced_on} onChange={set('advanced_on')} required />
        </div>
        <div>
          <label className="label">Invoice due</label>
          <input className="input" type="date" value={form.invoice_due_on} onChange={set('invoice_due_on')} />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Advance and reserve are derived from the client’s schedule and snapshotted onto the
        advance, so later schedule edits can’t rewrite funded terms.
      </p>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={fund.isPending}>
          {fund.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Fund
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Console ──────────────────────────────────────────────────────────────────
// Requests leads: it is the only tab with work waiting on it, and the queue is
// where the underwriting engine actually earns its keep.
// Applications sits next to it: new clients from apply.os-funding.com.
const TABS = ['Requests', 'Applications', 'Advances', 'Clients', 'Debtors', 'Import', 'Audit'] as const;

export function AdminConsolePage() {
  const email = useAdminStore((s) => s.email);
  const logout = useAdminStore((s) => s.logout);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Requests');
  const [funding, setFunding] = useState(false);
  const signedIn = Boolean(email) && hasAdminToken();
  const { data: appCounts } = useQuery<Record<string, number>>({
    queryKey: ['admin-application-counts'],
    queryFn: () => adminApi.get('/applications/counts').then((r) => r.data.data),
    enabled: signedIn,
    refetchInterval: 120_000,
  });
  // Submitted (or resubmitted) and waiting on One Source, not on the applicant.
  const waiting = appCounts?.['submitted'] ?? 0;

  if (!signedIn) return <AdminLogin />;

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-5 h-5 flex-shrink-0" />
            <span className="font-bold text-sm truncate">OneSource Console</span>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs text-slate-300 truncate hidden sm:inline">{email}</span>
            <button onClick={logout} className="p-2 rounded-md hover:bg-slate-800" aria-label="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <nav className="bg-white border-b border-slate-200 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
                tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {t}
              {t === 'Applications' && waiting > 0 && (
                <span className="ml-1.5 rounded-full bg-brand-600 text-white text-[11px] px-1.5 py-0.5 tabular-nums">{waiting}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto page">
        {tab === 'Requests' && <UnderwritingQueue />}
        {tab === 'Applications' && <ApplicationsPanel />}
        {tab === 'Advances' && (
          <>
            <div className="page-header">
              <h2>Advances</h2>
              <button className="btn-primary" onClick={() => setFunding((f) => !f)}>
                {funding ? 'Close' : 'Fund an invoice'}
              </button>
            </div>
            {funding && <FundForm onDone={() => setFunding(false)} />}
            <AdvancesTable />
          </>
        )}
        {tab === 'Clients' && <ClientsPanel />}
        {/* Median DSO next to median open age is the slowdown, read directly:
            an agency that normally settles in 32 days holding 130-day-old paper
            is the thing to notice before it turns into a queue of declines. */}
        {tab === 'Debtors' && <DebtorsPanel />}
        {tab === 'Import' && <ImportPanel />}
        {tab === 'Audit' && <SimpleTable
          queryKey="admin-audit" url="/audit"
          columns={[
            ['occurred_at', 'When', 'date'], ['actor', 'Operator'],
            ['action', 'Action'], ['entity_type', 'Entity'], ['company_id', 'Company'],
          ]} />}
      </main>
    </div>
  );
}

function SimpleTable({ queryKey, url, columns }: {
  queryKey: string; url: string; columns: [string, string, string?][];
}) {
  const { data, isLoading } = useQuery({
    queryKey: [queryKey], queryFn: () => adminApi.get(url).then(r => r.data.data),
  });
  if (isLoading) return <div className="card p-8 text-center text-slate-500 text-sm">Loading…</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[40rem]">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>{columns.map(([, label]) => <th key={label} className="table-header">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(data ?? []).length === 0 && (
            <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-slate-500 text-sm">
              Nothing here yet</td></tr>
          )}
          {(data ?? []).map((row: Record<string, string>, i: number) => (
            <tr key={row['id'] ?? i} className="hover:bg-slate-50">
              {columns.map(([key, label, kind]) => (
                <td key={label} className={`table-cell ${
                  kind === 'money' || kind === 'days' ? 'text-right tabular-nums' : ''}`}>
                  {row[key] == null ? '—'
                    : kind === 'money' ? formatCurrency(row[key])
                    : kind === 'date' ? formatDate(row[key])
                    : kind === 'days' ? Math.round(Number(row[key]))
                    : kind === 'flag' ? (
                        // Only worth drawing attention when true; a table of "no"
                        // chips is noise.
                        String(row[key]) === 'true'
                          ? <span className="badge-yellow">slowing</span>
                          : <span className="text-slate-300">—</span>
                      )
                    : String(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
