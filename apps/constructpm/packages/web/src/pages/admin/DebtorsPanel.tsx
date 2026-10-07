import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { APPROVAL_DOC_TYPES, DOC_TYPE_LABELS, type ApprovalDocType } from '@constructpm/shared';
import { adminApi } from '../../lib/admin-api';
import { formatCurrency } from '../../lib/api';

interface DebtorRow {
  id: string; legal_name: string; client_count: string; invoice_count: string;
  exposure: string; median_dso: string | null; median_open_age: string | null;
  in_slowdown: boolean; credit_limit: string | null;
  approval_evidence: ApprovalDocType[]; approval_instructions: string | null;
}

/** Short names for the table; the full labels appear in the editor and the client app. */
const SHORT: Record<ApprovalDocType, string> = {
  approved_invoice: 'Approved invoice',
  approval_email: 'Approval email',
  portal_screenshot: 'Portal screenshot',
  certified_pay_app: 'Certified pay app',
};

/**
 * Agencies (debtors): exposure and how they pay, plus what One Source accepts
 * as proof that the agency approved an invoice. That rule is what a client sees
 * when they mark an invoice approved or request funding against this agency.
 * It applies when the client's agency name matches the legal name or DBA here.
 */
export function DebtorsPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<DebtorRow | null>(null);
  const { data, isLoading } = useQuery<DebtorRow[]>({
    queryKey: ['admin-debtors'],
    queryFn: () => adminApi.get('/debtors').then((r) => r.data.data),
  });

  if (isLoading) return <div className="card p-8 text-center text-slate-500 text-sm">Loading…</div>;
  const rows = data ?? [];

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[64rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Agency', 'Clients', 'Open', 'Exposure', 'Normal days', 'Open age', 'Slowdown', 'Credit limit', 'Accepted approval proof', ''].map((h) => (
                <th key={h} className={`table-header ${['Exposure', 'Normal days', 'Open age', 'Credit limit'].includes(h) ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500 text-sm">Nothing here yet</td></tr>
            )}
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="table-cell font-medium">{d.legal_name}</td>
                <td className="table-cell">{d.client_count}</td>
                <td className="table-cell">{d.invoice_count}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(d.exposure)}</td>
                <td className="table-cell text-right tabular-nums">{d.median_dso == null ? '—' : Math.round(Number(d.median_dso))}</td>
                <td className="table-cell text-right tabular-nums">{d.median_open_age == null ? '—' : Math.round(Number(d.median_open_age))}</td>
                <td className="table-cell">
                  {String(d.in_slowdown) === 'true' ? <span className="badge-yellow">slowing</span> : <span className="text-slate-300">—</span>}
                </td>
                <td className="table-cell text-right tabular-nums">{d.credit_limit == null ? '—' : formatCurrency(d.credit_limit)}</td>
                <td className="table-cell-wrap text-sm">
                  {(d.approval_evidence ?? ['approved_invoice']).map((t) => SHORT[t] ?? t).join(', ')}
                  {d.approval_instructions && <span className="block text-xs text-slate-500 truncate max-w-xs">{d.approval_instructions}</span>}
                </td>
                <td className="table-cell">
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(d)} aria-label={`Edit approval proof for ${d.legal_name}`}>
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <ApprovalRuleEditor debtor={editing} onClose={() => setEditing(null)}
                            onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['admin-debtors'] }); }} />
      )}
    </>
  );
}

function ApprovalRuleEditor({ debtor, onClose, onSaved }: { debtor: DebtorRow; onClose: () => void; onSaved: () => void }) {
  const [accepted, setAccepted] = useState<ApprovalDocType[]>(debtor.approval_evidence ?? ['approved_invoice']);
  const [instructions, setInstructions] = useState(debtor.approval_instructions ?? '');

  const save = useMutation({
    mutationFn: () => adminApi.patch(`/debtors/${debtor.id}/approval-requirement`, {
      approval_evidence: accepted, approval_instructions: instructions.trim() || null,
    }),
    onSuccess: () => { toast.success('Approval proof updated'); onSaved(); },
    onError: () => toast.error('Could not save'),
  });

  const toggle = (t: ApprovalDocType) =>
    setAccepted((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="rule-title" className="card w-full max-w-lg">
        <div className="p-5 border-b border-slate-200">
          <h3 id="rule-title">Proof of approval — {debtor.legal_name}</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Clients must attach one of these before requesting funding on an invoice to this agency.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <fieldset className="space-y-2">
            <legend className="label">Accepted</legend>
            {APPROVAL_DOC_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={accepted.includes(t)} onChange={() => toggle(t)} />
                {DOC_TYPE_LABELS[t]}
              </label>
            ))}
          </fieldset>
          <div>
            <label className="label" htmlFor="rule-instr">Instructions shown to the client (optional)</label>
            <textarea id="rule-instr" className="input" rows={3} maxLength={1000} value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="e.g. Upload the portal screen showing “Approved for Payment”." />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={accepted.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
