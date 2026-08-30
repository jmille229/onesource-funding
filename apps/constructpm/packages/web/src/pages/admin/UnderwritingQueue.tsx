import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert, ShieldCheck, ShieldQuestion, ChevronDown, ChevronRight,
  RefreshCw, Plus, Loader2, TrendingDown, TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../lib/admin-api';
import { formatCurrency, formatDate } from '../../lib/api';
import { factoredInvoiceRef } from '@constructpm/shared';

/**
 * The operator's decision screen.
 *
 * Every request arrives already scored, so the queue can be triaged at a glance
 * and the operator's attention goes to the ones that need judgement. Auto-approval
 * is off by default — OneSource wants eyes on every invoice at current volume —
 * so this is where the decision is actually made; the engine's job here is to
 * make sure nothing that mattered went unnoticed.
 */

type Action = 'approve' | 'refer' | 'decline';

interface RequestRow {
  id: string;
  company_id: string;
  company_name: string;
  invoice_number: string | null;
  requested_amount: string;
  customer_name: string | null;
  status: string;
  source: string;
  requested_at: string;
  document_count: string;
  uw_score: number | null;
  uw_action: Action | null;
  uw_auto_applied: boolean | null;
  uw_override_action: Action | null;
  uw_hard_stop_count: number | null;
  exposure_limit: string | null;
  exposure_current: string | null;
  exposure_headroom: string | null;
  recommended_advance_rate_pct: string | null;
}

interface Decision {
  score: number;
  action: Action;
  auto_applied: boolean;
  hard_stops: { code: string; label: string }[];
  referrals: { code: string; label: string }[];
  factors: { code: string; label: string; points: number }[];
  inputs: Record<string, Record<string, unknown>>;
  recommended_advance_rate_pct: string;
  exposure_limit: string;
  exposure_current: string;
  exposure_headroom: string;
  override_action: Action | null;
  override_reason: string | null;
  overridden_by_email: string | null;
  policy_version: number;
}

const ACTION_STYLE: Record<Action, { chip: string; Icon: typeof ShieldCheck; label: string }> = {
  approve: { chip: 'bg-green-100 text-green-800 border-green-300', Icon: ShieldCheck, label: 'Clean' },
  refer:   { chip: 'bg-amber-100 text-amber-800 border-amber-300', Icon: ShieldQuestion, label: 'Review' },
  decline: { chip: 'bg-red-100 text-red-800 border-red-300',       Icon: ShieldAlert, label: 'Decline' },
};

function ScoreBadge({ score, action, hardStops }: {
  score: number | null; action: Action | null; hardStops: number | null;
}) {
  if (score === null || action === null) {
    return <span className="text-xs text-slate-400">not scored</span>;
  }
  const s = ACTION_STYLE[action];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-semibold ${s.chip}`}>
      <s.Icon className="w-3.5 h-3.5" />
      <span className="tabular-nums">{score}</span>
      <span className="font-normal">{s.label}</span>
      {(hardStops ?? 0) > 0 && (
        <span className="ml-0.5 px-1 rounded bg-red-600 text-white text-[10px] tabular-nums">
          {hardStops} stop{hardStops === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}

/** The expanded decision: what stopped it, what moved the score, and the exposure behind it. */
function DecisionPanel({ requestId, onChanged }: { requestId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [overriding, setOverriding] = useState<Action | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, isError } = useQuery<Decision>({
    queryKey: ['admin-decision', requestId],
    queryFn: () => adminApi.get(`/requests/${requestId}/decision`).then(r => r.data.data),
    retry: false,
  });

  const rescore = useMutation({
    mutationFn: () => adminApi.post(`/requests/${requestId}/rescore`),
    onSuccess: () => {
      toast.success('Re-scored');
      qc.invalidateQueries({ queryKey: ['admin-decision', requestId] });
      onChanged();
    },
    onError: () => toast.error('Could not re-score'),
  });

  const override = useMutation({
    mutationFn: (body: { action: Action; reason: string }) =>
      adminApi.post(`/requests/${requestId}/override`, body),
    onSuccess: () => {
      toast.success('Override recorded');
      setOverriding(null); setReason('');
      qc.invalidateQueries({ queryKey: ['admin-decision', requestId] });
      onChanged();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'Could not record override'),
  });

  if (isLoading) return <div className="p-4 text-sm text-slate-500">Loading decision…</div>;

  if (isError || !data) {
    return (
      <div className="p-4 flex items-center gap-3">
        <span className="text-sm text-slate-500">No decision recorded for this request.</span>
        <button className="btn-secondary btn-sm" onClick={() => rescore.mutate()} disabled={rescore.isPending}>
          {rescore.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Score it
        </button>
      </div>
    );
  }

  const client = (data.inputs?.['client'] ?? {}) as Record<string, unknown>;
  const debtor = (data.inputs?.['debtor'] ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? '—' : String(v));

  return (
    <div className="bg-slate-50 border-t border-slate-200 p-4 space-y-4">
      {/* Hard stops read differently from scored factors: they cannot be argued up. */}
      {data.hard_stops.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800 mb-2">
            Hard stops — not overridden by score
          </p>
          <ul className="space-y-1">
            {data.hard_stops.map((h) => (
              <li key={h.code} className="text-sm text-red-900 flex gap-2">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{h.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Referrals are the opposite: usually fine, but never decided without a
          person. Kept visually distinct so "look at this" doesn't read as "no". */}
      {(data.referrals ?? []).length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">
            Needs a person — often fine, never automatic
          </p>
          <ul className="space-y-1">
            {data.referrals.map((h) => (
              <li key={h.code} className="text-sm text-amber-900 flex gap-2">
                <ShieldQuestion className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{h.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Scored factors */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Score {data.score} · policy v{data.policy_version}
          </p>
          {data.factors.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing counted against this request.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.factors.map((f) => (
                <li key={f.code} className="py-1.5 flex items-start gap-2 text-sm">
                  {f.points < 0
                    ? <TrendingDown className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    : <TrendingUp className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />}
                  <span className="flex-1 text-slate-700">{f.label}</span>
                  <span className={`tabular-nums font-semibold ${f.points < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {f.points > 0 ? '+' : ''}{f.points}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Exposure and counterparties */}
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Exposure</p>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Limit', data.exposure_limit],
                ['Out now', data.exposure_current],
                ['Headroom', data.exposure_headroom],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">{k}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatCurrency(Number(v))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Counterparties</p>
            <p className="text-slate-600">
              Client: <span className="tabular-nums font-medium text-slate-900">{num(client['settled_on_time'])}</span> on time,{' '}
              <span className="tabular-nums font-medium text-slate-900">{num(client['settled_late'])}</span> late
            </p>
            <p className="text-slate-600">
              Agency: {debtor['known'] ? (
                <>
                  <span className="tabular-nums font-medium text-slate-900">{num(debtor['settled_count'])}</span> settled,
                  median <span className="tabular-nums font-medium text-slate-900">{num(debtor['median_dso'])}</span> days
                </>
              ) : <span className="text-amber-700 font-medium">unknown to us</span>}
            </p>
            <p className="text-slate-600">
              Recommended advance rate:{' '}
              <span className="tabular-nums font-semibold text-slate-900">{Number(data.recommended_advance_rate_pct)}%</span>
            </p>
          </div>
        </div>
      </div>

      {/* Override */}
      {data.override_action ? (
        <div className="rounded-lg border border-slate-300 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
            Overridden to {data.override_action}
          </p>
          <p className="text-sm text-slate-700">{data.override_reason}</p>
          <p className="text-xs text-slate-400 mt-1">{data.overridden_by_email}</p>
        </div>
      ) : overriding ? (
        <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-2">
          <label className="label" htmlFor={`ovr-${requestId}`}>
            Why are you departing from the engine? (recorded, and used to tune the next policy)
          </label>
          <textarea
            id={`ovr-${requestId}`} className="input" rows={2} value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Spoke with the agency's AP office; invoice confirmed and check is cut."
          />
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary btn-sm"
              onClick={() => { setOverriding(null); setReason(''); }}>Cancel</button>
            <button type="button" className="btn-primary btn-sm"
              disabled={reason.trim().length < 10 || override.isPending}
              onClick={() => override.mutate({ action: overriding, reason: reason.trim() })}>
              {override.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Record override to {overriding}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" onClick={() => rescore.mutate()} disabled={rescore.isPending}>
            {rescore.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Re-score
          </button>
          {(['approve', 'refer', 'decline'] as Action[])
            .filter((a) => a !== data.action)
            .map((a) => (
              <button key={a} className="btn-ghost btn-sm" onClick={() => setOverriding(a)}>
                Override to {a}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** Key in a request that arrived by email or text, so it runs through the same engine. */
function OperatorEntryForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    company_id: '', debtor_id: '', invoice_number: '', requested_amount: '', customer_name: '', note: '',
  });

  const { data: clients } = useQuery<Record<string, string>[]>({
    queryKey: ['admin-clients'], queryFn: () => adminApi.get('/clients').then(r => r.data.data),
  });
  const { data: debtors } = useQuery<Record<string, string>[]>({
    queryKey: ['admin-debtors'], queryFn: () => adminApi.get('/debtors').then(r => r.data.data),
  });

  const create = useMutation({
    mutationFn: () => adminApi.post('/requests', {
      company_id: form.company_id,
      debtor_id: form.debtor_id || null,
      invoice_number: form.invoice_number.trim() || null,
      requested_amount: Number(form.requested_amount),
      customer_name: form.customer_name.trim() || null,
      note: form.note.trim() || null,
    }),
    onSuccess: (r) => {
      const d = r.data.data.decision as Decision | null;
      toast.success(d ? `Entered and scored: ${d.score} (${d.action})` : 'Request entered');
      onDone();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'Could not enter the request'),
  });

  const valid = form.company_id && Number(form.requested_amount) > 0;

  return (
    <form className="card p-4 mb-4 space-y-4"
      onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
      <p className="text-sm text-slate-600">
        For invoices that arrive by email or text. Scored the same way as an in-app request — the
        point is that nothing gets decided off-system.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="oe-client">Client *</label>
          <select id="oe-client" className="input" required value={form.company_id}
            onChange={(e) => setForm(f => ({ ...f, company_id: e.target.value }))}>
            <option value="">— Select client —</option>
            {(clients ?? []).map((c) => (
              <option key={c['company_id']} value={c['company_id']}>{c['company_name']}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="oe-debtor">Agency</label>
          <select id="oe-debtor" className="input" value={form.debtor_id}
            onChange={(e) => setForm(f => ({ ...f, debtor_id: e.target.value }))}>
            <option value="">— Unknown / not listed —</option>
            {(debtors ?? []).map((d) => (
              <option key={d['id']} value={d['id']}>{d['legal_name']}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="oe-number">Invoice number</label>
          <input id="oe-number" className="input" value={form.invoice_number}
            onChange={(e) => setForm(f => ({ ...f, invoice_number: e.target.value }))}
            placeholder="Blank if the agency hasn't issued one" />
          <p className="text-xs text-slate-500 mt-1">
            Optional. Leave blank when the invoice hasn't been numbered yet —
            an INV-XXXXXXXX identifier is assigned automatically.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="oe-amount">Face amount *</label>
          <input id="oe-amount" className="input text-right tabular-nums" type="number" min="0" step="0.01"
            required value={form.requested_amount}
            onChange={(e) => setForm(f => ({ ...f, requested_amount: e.target.value }))} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="oe-note">Note</label>
        <input id="oe-note" className="input" value={form.note}
          onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
          placeholder="Where it came from, anything the engine can't see" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={!valid || create.isPending}>
          {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Enter and score
        </button>
      </div>
    </form>
  );
}

export function UnderwritingQueue() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery<RequestRow[]>({
    queryKey: ['admin-requests'],
    queryFn: () => adminApi.get('/requests').then(r => r.data.data),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-requests'] });

  const decline = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminApi.post(`/requests/${id}/decline`, { reason }),
    onSuccess: () => { toast.success('Declined'); refresh(); },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'Could not decline'),
  });

  const rows = (data ?? []).filter(r =>
    showAll || ['submitted', 'under_review'].includes(r.status));

  return (
    <>
      <div className="page-header">
        <h2>Funding requests</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show decided
          </label>
          <button className="btn-primary btn-sm" onClick={() => setEntering(v => !v)}>
            <Plus className="w-4 h-4" /> {entering ? 'Close' : 'Enter an invoice'}
          </button>
        </div>
      </div>

      {entering && <OperatorEntryForm onDone={() => { setEntering(false); refresh(); }} />}

      {isLoading ? (
        <div className="card p-8 text-center text-slate-500 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p className="text-slate-500">{showAll ? 'No requests yet' : 'Nothing waiting for review'}</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {rows.map((r) => {
            const open = expanded === r.id;
            return (
              <div key={r.id}>
                <div className="p-3 sm:p-4 flex flex-wrap items-center gap-3">
                  <button
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    onClick={() => setExpanded(open ? null : r.id)}
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        {r.company_name}
                        {r.source === 'operator' && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5
                                           rounded bg-slate-100 text-slate-600 border border-slate-200">
                            keyed in
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        <span className="font-mono">{factoredInvoiceRef(r)}</span> · {r.customer_name ?? 'agency not named'} ·{' '}
                        {formatDate(r.requested_at)}
                        {Number(r.document_count) === 0 && (
                          <span className="text-amber-700"> · no document</span>
                        )}
                      </p>
                    </div>
                  </button>

                  <span className="font-semibold tabular-nums text-slate-900">
                    {formatCurrency(Number(r.requested_amount))}
                  </span>

                  <ScoreBadge score={r.uw_score} action={r.uw_override_action ?? r.uw_action}
                    hardStops={r.uw_hard_stop_count} />

                  {['submitted', 'under_review'].includes(r.status) ? (
                    <button className="btn-secondary btn-sm"
                      onClick={() => {
                        const reason = prompt('Reason for declining (the client sees this):');
                        if (reason?.trim()) decline.mutate({ id: r.id, reason: reason.trim() });
                      }}>
                      Decline
                    </button>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200">
                      {r.status}
                    </span>
                  )}
                </div>
                {open && <DecisionPanel requestId={r.id} onChanged={refresh} />}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
