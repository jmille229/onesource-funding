import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { adminApi } from '../../lib/admin-api';
import { formatCurrency, formatDate } from '../../lib/api';
import { AdvancesTable } from './AdvancesTable';

/**
 * One client's history at a glance: what they've done with One Source
 * (volume and revenue), what's out right now (exposure), how their agencies
 * pay (behavior), then every advance and every request that wasn't funded.
 */

interface Stats {
  funded_count: string; total_face: string; total_advanced: string; avg_face: string | null;
  fees_earned: string; fees_accruing: string; first_advanced_on: string | null; last_advanced_on: string | null;
  open_count: string; advanced_outstanding: string; face_outstanding: string; reserve_held: string;
  nearing_recourse: string; past_recourse: string;
  paid_count: string; avg_days_to_pay: string | null; median_days_to_pay: number | null; longest_days_to_pay: number | null;
  paid_on_time: string; on_time_days: number | null; credit_limit: string | null;
}
interface Agency {
  debtor_name: string; invoice_count: string; total_face: string; paid_count: string;
  avg_days_to_pay: string | null; open_count: string; advanced_outstanding: string;
}
interface Request {
  id: string; invoice_number: string | null; customer_name: string | null; requested_amount: string; status: string;
  note: string | null; decline_reason: string | null; requested_at: string; reviewed_at: string | null;
}

const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const REQUEST_STATUS: Record<string, [string, string]> = {
  submitted: ['Waiting on review', 'badge-blue'], under_review: ['In review', 'badge-yellow'],
  declined: ['Declined', 'badge-red'], withdrawn: ['Withdrawn by client', 'badge-gray'], approved: ['Approved', 'badge-green'],
};

export function ClientHistory({ clientId, companyId, companyName }: { clientId: string; companyId: string; companyName: string }) {
  const { data, isLoading } = useQuery<{ stats: Stats; agencies: Agency[]; requests: Request[] }>({
    queryKey: ['admin-client-history', clientId],
    queryFn: () => adminApi.get(`/clients/${clientId}/history`).then((r) => r.data.data),
    staleTime: 0, refetchOnMount: 'always',
  });

  if (isLoading || !data) {
    return <div className="card p-8 text-center text-sm text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline" /> Loading history…</div>;
  }
  const s = data.stats;
  const funded = n(s.funded_count);

  return (
    <div className="space-y-6">
      {funded === 0 ? (
        <div className="card p-6 text-sm text-slate-600">
          No advances yet for {companyName}. Once you fund one, its stats and history show here.
        </div>
      ) : (
        <>
          <div className="grid lg:grid-cols-3 gap-4">
            <VolumeCard s={s} />
            <ExposureCard s={s} />
            <BehaviorCard s={s} agencies={data.agencies} />
          </div>
          {data.agencies.length > 0 && <AgencyTable agencies={data.agencies} />}
        </>
      )}

      <section>
        <h3 className="mb-2">Advances</h3>
        <AdvancesTable companyId={companyId} hideClient />
      </section>

      <RequestsList requests={data.requests} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`tabular-nums text-right ${tone === 'bad' ? 'text-red-600 font-semibold' : tone === 'warn' ? 'text-orange-600 font-medium' : 'text-slate-900'}`}>{value}</span>
    </div>
  );
}

function VolumeCard({ s }: { s: Stats }) {
  return (
    <Card title="Volume & revenue">
      <p className="text-2xl font-bold tabular-nums">{formatCurrency(s.total_advanced)}</p>
      <p className="text-sm text-slate-500 mb-3">
        advanced on {s.funded_count} invoice{n(s.funded_count) === 1 ? '' : 's'} worth {formatCurrency(s.total_face)}
      </p>
      <Line label="Average invoice" value={formatCurrency(s.avg_face)} />
      <Line label="Fees earned (paid invoices)" value={formatCurrency(s.fees_earned)} />
      {n(s.fees_accruing) > 0 && <Line label="Fees accruing on open" value={formatCurrency(s.fees_accruing)} />}
      <Line label="First funded" value={formatDate(s.first_advanced_on)} />
      <Line label="Most recent" value={formatDate(s.last_advanced_on)} />
    </Card>
  );
}

function ExposureCard({ s }: { s: Stats }) {
  const limit = s.credit_limit ? n(s.credit_limit) : null;
  const out = n(s.advanced_outstanding);
  const pct = limit ? Math.min(100, (out / limit) * 100) : 0;
  return (
    <Card title="Exposure now">
      <p className="text-2xl font-bold tabular-nums">{formatCurrency(out)}</p>
      <p className="text-sm text-slate-500 mb-3">
        advanced on {s.open_count} open invoice{n(s.open_count) === 1 ? '' : 's'} ({formatCurrency(s.face_outstanding)} owed by agencies)
      </p>
      {limit !== null ? (
        <div className="mb-2">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{Math.round(pct)}% of {formatCurrency(limit)} limit</span>
            <span className={limit - out < 0 ? 'text-red-600 font-medium' : ''}>
              {limit - out < 0 ? `${formatCurrency(out - limit)} over` : `${formatCurrency(limit - out)} available`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Credit limit used">
            <div className={`h-full rounded-full ${pct >= 90 ? 'bg-orange-500' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : <Line label="Credit limit" value={<span className="text-slate-400">not set</span>} />}
      <Line label="Reserve held" value={formatCurrency(s.reserve_held)} />
      <Line label="Recourse within 14 days" value={s.nearing_recourse} tone={n(s.nearing_recourse) > 0 ? 'warn' : undefined} />
      <Line label="Past recourse date" value={s.past_recourse} tone={n(s.past_recourse) > 0 ? 'bad' : undefined} />
    </Card>
  );
}

function BehaviorCard({ s, agencies }: { s: Stats; agencies: Agency[] }) {
  const paid = n(s.paid_count);
  const onTime = n(s.paid_on_time);
  const slowest = agencies.filter((a) => a.avg_days_to_pay !== null)
    .sort((a, b) => n(b.avg_days_to_pay) - n(a.avg_days_to_pay))[0];
  return (
    <Card title="Payment behavior">
      {paid === 0 ? (
        <p className="text-sm text-slate-500">No invoices paid yet.</p>
      ) : (
        <>
          <p className="text-2xl font-bold tabular-nums">{Math.round(n(s.avg_days_to_pay))} days</p>
          <p className="text-sm text-slate-500 mb-3">average from advance to agency payment, over {paid} paid invoice{paid === 1 ? '' : 's'}</p>
          <Line label="Median / longest" value={`${s.median_days_to_pay ?? '—'} / ${s.longest_days_to_pay ?? '—'} days`} />
          <Line label={`Paid within ${s.on_time_days ?? 75} days`}
                value={`${onTime} of ${paid} (${Math.round((onTime / paid) * 100)}%)`}
                tone={onTime / paid < 0.8 ? 'warn' : undefined} />
          {slowest && agencies.length > 1 && (
            <Line label="Slowest agency" value={<>{slowest.debtor_name} <span className="text-slate-500">· {Math.round(n(slowest.avg_days_to_pay))}d</span></>} />
          )}
        </>
      )}
    </Card>
  );
}

function AgencyTable({ agencies }: { agencies: Agency[] }) {
  return (
    <section>
      <h3 className="mb-2">By agency</h3>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Agency', 'Invoices', 'Invoice value', 'Avg days to pay', 'Open', 'Outstanding'].map((h, i) => (
                <th key={h} className={`table-header ${i > 0 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agencies.map((a) => (
              <tr key={a.debtor_name}>
                <td className="table-cell">{a.debtor_name}</td>
                <td className="table-cell text-right tabular-nums">{a.invoice_count}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(a.total_face)}</td>
                <td className="table-cell text-right tabular-nums">
                  {a.avg_days_to_pay !== null ? `${Math.round(n(a.avg_days_to_pay))} days` : <span className="text-slate-400">none paid yet</span>}
                  {a.avg_days_to_pay !== null && <span className="text-xs text-slate-400"> · {a.paid_count} paid</span>}
                </td>
                <td className="table-cell text-right tabular-nums">{a.open_count}</td>
                <td className="table-cell text-right tabular-nums">{formatCurrency(a.advanced_outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RequestsList({ requests }: { requests: Request[] }) {
  return (
    <section>
      <h3 className="mb-1">Funding requests not funded</h3>
      <p className="text-xs text-slate-500 mb-2">Waiting on review, declined, or withdrawn. Funded requests appear above as advances.</p>
      {requests.length === 0 ? (
        <div className="card p-5 text-sm text-slate-500">None.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Invoice #', 'Agency', 'Amount', 'Requested', 'Status', 'Reason / note'].map((h) => (
                  <th key={h} className={`table-header ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.map((r) => {
                const [label, badge] = REQUEST_STATUS[r.status] ?? [r.status, 'badge-gray'];
                return (
                  <tr key={r.id} className="align-top">
                    <td className="table-cell font-mono">{r.invoice_number ?? '—'}</td>
                    <td className="table-cell">{r.customer_name ?? '—'}</td>
                    <td className="table-cell text-right tabular-nums">{formatCurrency(r.requested_amount)}</td>
                    <td className="table-cell">{formatDate(r.requested_at)}</td>
                    <td className="table-cell"><span className={badge}>{label}</span>
                      {r.reviewed_at && r.status === 'declined' && <span className="block text-[11px] text-slate-500 mt-0.5">{formatDate(r.reviewed_at)}</span>}
                    </td>
                    <td className="table-cell-wrap text-slate-600 max-w-md">{r.decline_reason ?? r.note ?? <span className="text-slate-300">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
