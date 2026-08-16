import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Shield, Loader2, LogOut, Upload, AlertTriangle } from 'lucide-react';
import { adminApi, useAdminStore, hasAdminToken } from '../../lib/admin-api';
import { formatCurrency, formatDate } from '../../lib/api';
import { UnderwritingQueue } from './UnderwritingQueue';

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
          <input className="input" value={form.invoice_number} onChange={set('invoice_number')} required />
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

// ─── CSV import ───────────────────────────────────────────────────────────────
function ImportPanel() {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{
    would_apply: number; errors: { row: number; message: string }[];
  } | null>(null);

  const run = useMutation({
    mutationFn: (dry: boolean) => adminApi.post('/invoices/import', { csv, dry_run: dry }).then(r => r.data.data),
    onSuccess: (data, dry) => {
      if (dry) { setPreview(data); return; }
      toast.success(`Imported ${data.applied} advances`);
      setCsv(''); setPreview(null);
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
    },
    onError: () => toast.error('Import failed'),
  });

  return (
    <div className="card p-4 space-y-3">
      <h3>Import advances</h3>
      <p className="text-sm text-slate-500">
        Columns: <code className="text-xs">company_id, debtor_id, invoice_number, face_amount,
        advanced_on, invoice_due_on, fee_schedule_id</code>. Nothing is written unless every row
        validates — a partly applied batch of advances is worse than none.
      </p>
      <textarea
        className="input font-mono text-xs" rows={8} value={csv}
        onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
        placeholder="company_id,debtor_id,invoice_number,face_amount,advanced_on"
      />
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={!csv || run.isPending}
                onClick={() => run.mutate(true)}>
          <Upload className="w-4 h-4" /> Validate
        </button>
        <button className="btn-primary"
                disabled={!preview || preview.errors.length > 0 || run.isPending}
                onClick={() => run.mutate(false)}>
          Apply {preview ? `${preview.would_apply} rows` : ''}
        </button>
      </div>
      {preview && (
        <div className={`p-3 rounded-md text-sm ${
          preview.errors.length ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          {preview.errors.length === 0 ? (
            <p className="text-green-800">{preview.would_apply} rows valid and ready to apply.</p>
          ) : (
            <>
              <p className="text-red-800 font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {preview.errors.length} rows rejected — nothing was written
              </p>
              <ul className="mt-2 space-y-0.5 text-red-700 text-xs max-h-40 overflow-y-auto">
                {preview.errors.slice(0, 25).map((e) => (
                  <li key={e.row}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Console ──────────────────────────────────────────────────────────────────
// Requests leads: it is the only tab with work waiting on it, and the queue is
// where the underwriting engine actually earns its keep.
const TABS = ['Requests', 'Advances', 'Clients', 'Debtors', 'Import', 'Audit'] as const;

export function AdminConsolePage() {
  const email = useAdminStore((s) => s.email);
  const logout = useAdminStore((s) => s.logout);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Requests');
  const [funding, setFunding] = useState(false);
  const qc = useQueryClient();

  if (!email || !hasAdminToken()) return <AdminLogin />;

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
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto page">
        {tab === 'Requests' && <UnderwritingQueue />}
        {tab === 'Advances' && (
          <>
            <div className="page-header">
              <h2>Advances</h2>
              <button className="btn-primary" onClick={() => setFunding((f) => !f)}>
                {funding ? 'Close' : 'Fund an invoice'}
              </button>
            </div>
            {funding && <FundForm onDone={() => setFunding(false)} />}
            <AdvancesTable onChanged={() => qc.invalidateQueries({ queryKey: ['admin-invoices'] })} />
          </>
        )}
        {tab === 'Clients' && <SimpleTable
          queryKey="admin-clients" url="/clients"
          columns={[
            ['company_name', 'Client'], ['status', 'Status'],
            ['outstanding_count', 'Open'], ['advanced_outstanding', 'Advanced', 'money'],
            ['credit_limit', 'Credit limit', 'money'],
          ]} />}
        {tab === 'Debtors' && <SimpleTable
          queryKey="admin-debtors" url="/debtors"
          columns={[
            ['legal_name', 'Debtor'], ['client_count', 'Clients'],
            ['invoice_count', 'Open invoices'], ['exposure', 'Exposure', 'money'],
            ['credit_limit', 'Credit limit', 'money'], ['risk_grade', 'Grade'],
          ]} />}
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

function AdvancesTable({ onChanged }: { onChanged: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-invoices'], queryFn: () => adminApi.get('/invoices').then(r => r.data.data),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'collect' | 'close' }) =>
      adminApi.post(`/invoices/${id}/${action}`, action === 'collect'
        ? { collected_on: new Date().toISOString().slice(0, 10) }
        : { closed_on: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => { toast.success('Updated'); onChanged(); },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'Action failed'),
  });

  if (isLoading) return <div className="card p-8 text-center text-slate-500 text-sm">Loading…</div>;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[52rem]">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {['Client', 'Invoice', 'Debtor', 'Face', 'Advanced', 'Fees', 'Days', 'Status', ''].map((h) => (
              <th key={h} className="table-header">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(data ?? []).length === 0 && (
            <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500 text-sm">No advances yet</td></tr>
          )}
          {(data ?? []).map((r: Record<string, string>) => (
            <tr key={r['id']} className="hover:bg-slate-50">
              <td className="table-cell">{r['company_name']}</td>
              <td className="table-cell font-medium">{r['invoice_number']}</td>
              <td className="table-cell">{r['debtor_name']}</td>
              <td className="table-cell text-right tabular-nums">{formatCurrency(r['face_amount'])}</td>
              <td className="table-cell text-right tabular-nums">{formatCurrency(r['advance_amount'])}</td>
              <td className="table-cell text-right tabular-nums">{formatCurrency(r['accrued_fee'])}</td>
              <td className="table-cell text-right tabular-nums">{r['days_outstanding'] ?? '—'}</td>
              <td className="table-cell">{r['status']}</td>
              <td className="table-cell text-right">
                {r['status'] === 'advanced' && (
                  <button className="btn-secondary btn-sm"
                          onClick={() => act.mutate({ id: r['id']!, action: 'collect' })}>
                    Mark paid
                  </button>
                )}
                {r['status'] === 'collected' && (
                  <button className="btn-secondary btn-sm"
                          onClick={() => act.mutate({ id: r['id']!, action: 'close' })}>
                    Release reserve
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
                <td key={label} className={`table-cell ${kind === 'money' ? 'text-right tabular-nums' : ''}`}>
                  {row[key] == null ? '—'
                    : kind === 'money' ? formatCurrency(row[key])
                    : kind === 'date' ? formatDate(row[key])
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
