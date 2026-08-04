import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Award, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, formatCurrency } from '../../lib/api';

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-gray', active: 'badge-green', complete: 'badge-blue',
  closed: 'badge-gray', void: 'badge-red',
};

interface Sub {
  id: string; subcontract_number: string | null; title: string; status: string;
  subcontractor_name: string; certifications: string[];
  contract_amount: number; billed: number; retainage_held: number; paid: number; due: number; remaining: number;
}
interface Participation {
  total_committed: number; certified_committed: number; participation_pct: number;
  by_certification: { certification: string; committed: number }[];
}
interface Contact { id: string; name: string; type: string; }

export function SubcontractsPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data: subs = [], isLoading } = useQuery<Sub[]>({
    queryKey: ['subcontracts', jobId],
    queryFn: () => api.get(`/subcontracts?job_id=${jobId}`).then((r) => r.data.data),
    enabled: !!jobId,
  });

  const { data: participation } = useQuery<Participation>({
    queryKey: ['subcontracts-participation', jobId],
    queryFn: () => api.get(`/subcontracts/participation?job_id=${jobId}`).then((r) => r.data.data),
    enabled: !!jobId,
  });

  // Roll the per-sub commitment figures up into the job-level summary.
  const totals = subs.reduce(
    (a, s) => ({
      committed: a.committed + s.contract_amount, billed: a.billed + s.billed,
      retainage: a.retainage + s.retainage_held, paid: a.paid + s.paid, due: a.due + s.due,
    }),
    { committed: 0, billed: 0, retainage: 0, paid: 0, due: 0 }
  );
  const billedPct = totals.committed ? Math.min(100, (totals.billed / totals.committed) * 100) : 0;

  return (
    <div className="page max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate(`/jobs/${jobId}`)} className="btn-ghost btn-sm mt-1" aria-label="Back to job">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Subcontractors</p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Subcontracts &amp; commitments</h1>
        </div>
        <button className="btn-primary btn-sm" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> Add subcontract
        </button>
      </div>

      {/* Commitment summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Committed', value: totals.committed, hint: `${subs.length} subcontract${subs.length === 1 ? '' : 's'}` },
          { label: 'Billed', value: totals.billed },
          { label: 'Retainage held', value: totals.retainage, accent: 'text-orange-600' },
          { label: 'Paid', value: totals.paid },
          { label: 'Due now', value: totals.due, accent: 'text-brand-600' },
        ].map((k) => (
          <div key={k.label} className="card p-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{k.label}</p>
            <p className={`text-xl font-bold mt-1 ${k.accent ?? 'text-slate-900'}`}>{formatCurrency(k.value)}</p>
            {k.hint && <p className="text-xs text-slate-400 mt-0.5">{k.hint}</p>}
          </div>
        ))}
      </div>

      {/* Billed-vs-committed bar */}
      {totals.committed > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-700">Billed against commitments</h3>
            <span className="text-xs text-slate-500">
              {formatCurrency(totals.billed)} of {formatCurrency(totals.committed)}
            </span>
          </div>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${billedPct}%` }} />
          </div>
        </div>
      )}

      {/* Participation */}
      {participation && participation.total_committed > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Award className="w-4 h-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-slate-700">MBE / WBE / DBE participation</h3>
          </div>
          <div className="flex items-end gap-6 flex-wrap">
            <div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">{participation.participation_pct}%</p>
              <p className="text-xs text-slate-500">
                {formatCurrency(participation.certified_committed)} of {formatCurrency(participation.total_committed)} committed to certified firms
              </p>
            </div>
            <div className="flex gap-2 flex-wrap pb-1">
              {participation.by_certification.map((c) => (
                <span key={c.certification} className="badge-blue">
                  {c.certification} · {formatCurrency(c.committed)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Subcontracts table */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[40rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-header">Sub #</th>
              <th className="table-header">Subcontractor</th>
              <th className="table-header text-right">Committed</th>
              <th className="table-header text-right">Billed</th>
              <th className="table-header text-right">Paid</th>
              <th className="table-header text-right">Due</th>
              <th className="table-header">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
            ) : subs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                No subcontracts yet. Add your first to start tracking commitments.
              </td></tr>
            ) : subs.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="table-cell font-mono text-xs text-slate-500">{s.subcontract_number ?? '—'}</td>
                <td className="table-cell">
                  <div className="font-medium text-slate-900">{s.subcontractor_name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs text-slate-500">{s.title}</span>
                    {s.certifications?.map((c) => <span key={c} className="badge-blue">{c}</span>)}
                  </div>
                </td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(s.contract_amount)}</td>
                <td className="table-cell text-right tabular-nums text-slate-600">{formatCurrency(s.billed)}</td>
                <td className="table-cell text-right tabular-nums text-slate-600">{formatCurrency(s.paid)}</td>
                <td className="table-cell text-right tabular-nums font-medium">{formatCurrency(s.due)}</td>
                <td className="table-cell"><span className={STATUS_BADGE[s.status] ?? 'badge-gray'}>{s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && jobId && (
        <AddSubcontractModal
          jobId={jobId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            qc.invalidateQueries({ queryKey: ['subcontracts', jobId] });
            qc.invalidateQueries({ queryKey: ['subcontracts-participation', jobId] });
          }}
        />
      )}
    </div>
  );
}

function AddSubcontractModal({ jobId, onClose, onSaved }: { jobId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ subcontractor_id: '', title: '', contract_amount: '', retainage_pct: '10', status: 'draft' });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['contacts', 'subs'],
    queryFn: () => api.get('/contacts').then((r) => r.data.data),
  });
  const subs = contacts.filter((c) => c.type === 'subcontractor' || c.type === 'both');

  const create = useMutation({
    mutationFn: () => api.post('/subcontracts', {
      job_id: jobId,
      subcontractor_id: form.subcontractor_id,
      title: form.title,
      contract_amount: Number(String(form.contract_amount).replace(/[^0-9.]/g, '')) || 0,
      retainage_pct: Number(form.retainage_pct) || 0,
      status: form.status,
    }),
    onSuccess: () => { toast.success('Subcontract added'); onSaved(); },
    onError: () => toast.error('Could not add subcontract. Check the fields and try again.'),
  });

  const canSave = form.subcontractor_id && form.title.trim();

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-start justify-center p-4 overflow-auto z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card w-full max-w-lg mt-12" role="dialog" aria-modal="true" aria-labelledby="add-sub-title">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 id="add-sub-title" className="font-semibold text-slate-900">Add subcontract</h2>
          <button onClick={onClose} className="btn-ghost btn-sm" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label" htmlFor="sub-firm">Subcontractor</label>
            <select id="sub-firm" className="input" value={form.subcontractor_id}
              onChange={(e) => setForm({ ...form, subcontractor_id: e.target.value })}>
              <option value="">Select a subcontractor…</option>
              {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {subs.length === 0 && <p className="text-xs text-slate-400 mt-1">No subcontractor contacts yet — add one under Contacts first.</p>}
          </div>
          <div>
            <label className="label" htmlFor="sub-title">Scope / title</label>
            <input id="sub-title" className="input" value={form.title} placeholder="e.g. Concrete & flatwork"
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="sub-amt">Contract amount</label>
              <input id="sub-amt" className="input" inputMode="numeric" value={form.contract_amount} placeholder="48000"
                onChange={(e) => setForm({ ...form, contract_amount: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="sub-ret">Retainage %</label>
              <input id="sub-ret" className="input" inputMode="numeric" value={form.retainage_pct}
                onChange={(e) => setForm({ ...form, retainage_pct: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="sub-status">Status</label>
            <select id="sub-status" className="input" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSave || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Saving…' : 'Add subcontract'}
          </button>
        </div>
      </div>
    </div>
  );
}
