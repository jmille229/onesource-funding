import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Check, CheckCircle2, Circle, Download, Eye, EyeOff, FileText, Loader2,
  ListChecks, Mail, Phone,
} from 'lucide-react';
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from '@constructpm/shared';
import { adminApi } from '../../lib/admin-api';
import { formatCurrency, formatDate } from '../../lib/api';
import { downloadVia } from '../../lib/download';
import { RequirementsPanel } from './RequirementsPanel';
import { CopyLink } from './CopyLink';

/**
 * Funding applications from apply.os-funding.com: the queue, one application
 * in full, and the decisions — ask for more, decline, or approve (which sets
 * up the client's company, login and funding account in one step).
 */

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-gray', submitted: 'badge-blue', in_review: 'badge-yellow', docs_requested: 'badge-orange',
  approved: 'badge-green', declined: 'badge-red', withdrawn: 'badge-gray',
};
const ENTITY_LABEL: Record<string, string> = {
  llc: 'LLC', corporation: 'Corporation (C corp)', s_corporation: 'S corporation',
  partnership: 'Partnership', sole_proprietorship: 'Sole proprietorship', other: 'Other',
};
const statusLabel = (s: string) => APPLICATION_STATUS_LABELS[s as ApplicationStatus] ?? s;

type ErrorLike = { response?: { data?: { message?: string } } };
const errMsg = (e: unknown, fallback: string) => (e as ErrorLike).response?.data?.message ?? fallback;

const FILTERS: [string, string][] = [
  ['open', 'Open'], ['draft', 'Started, not submitted'], ['approved', 'Approved'], ['declined', 'Declined'], ['', 'All'],
];

interface QueueRow {
  id: string; status: string; legal_name: string; dba: string | null;
  contact_first_name: string; contact_last_name: string; contact_email: string; contact_phone: string | null;
  monthly_volume: string | null; submitted_at: string | null; created_at: string; updated_at: string;
  document_count: string; missing_count: number;
}

export function ApplicationsPanel() {
  const [filter, setFilter] = useState('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<'queue' | 'requirements'>('queue');

  const { data: counts } = useQuery<Record<string, number>>({
    queryKey: ['admin-application-counts'],
    queryFn: () => adminApi.get('/applications/counts').then((r) => r.data.data),
  });
  const { data, isLoading } = useQuery<QueueRow[]>({
    queryKey: ['admin-applications', filter],
    queryFn: () => adminApi.get(`/applications${filter ? `?status=${filter}` : ''}`).then((r) => r.data.data),
    enabled: view === 'queue' && !openId,
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true,
  });

  if (view === 'requirements') {
    return (
      <>
        <button className="btn-ghost btn-sm mb-4" onClick={() => setView('queue')}>
          <ArrowLeft className="w-4 h-4" /> Applications
        </button>
        <RequirementsPanel />
      </>
    );
  }
  if (openId) return <ApplicationDetail id={openId} onBack={() => setOpenId(null)} />;

  const openCount = (counts?.['submitted'] ?? 0) + (counts?.['in_review'] ?? 0) + (counts?.['docs_requested'] ?? 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Applications</h2>
          <p className="text-sm text-slate-500 mt-0.5">From apply.os-funding.com</p>
        </div>
        <button className="btn-secondary" onClick={() => setView('requirements')}>
          <ListChecks className="w-4 h-4" /> What applicants provide
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTERS.map(([v, l]) => {
          const n = v === 'open' ? openCount : v ? counts?.[v] : undefined;
          return (
            <button key={v} onClick={() => setFilter(v)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium border ${
                filter === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
              {l}{n ? <span className="ml-1.5 tabular-nums opacity-70">{n}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[48rem]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Business', 'Contact', 'Status', 'Submitted', 'Monthly', 'Documents', 'Missing'].map((h) => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">Loading…</td></tr>}
            {!isLoading && (data ?? []).length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">No applications here</td></tr>
            )}
            {(data ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(r.id)}>
                <td className="table-cell">
                  <button className="font-medium text-left text-brand-700 hover:underline" onClick={() => setOpenId(r.id)}>
                    {r.legal_name}
                  </button>
                  {r.dba && <span className="text-xs text-slate-500 ml-1.5">dba {r.dba}</span>}
                </td>
                <td className="table-cell">{r.contact_first_name} {r.contact_last_name}</td>
                <td className="table-cell"><span className={STATUS_BADGE[r.status] ?? 'badge-gray'}>{statusLabel(r.status)}</span></td>
                <td className="table-cell text-slate-500">{r.submitted_at ? formatDate(r.submitted_at) : `started ${formatDate(r.created_at)}`}</td>
                <td className="table-cell text-right tabular-nums">{r.monthly_volume ? formatCurrency(r.monthly_volume, { short: true }) : '—'}</td>
                <td className="table-cell text-right tabular-nums">{r.document_count}</td>
                <td className="table-cell text-right tabular-nums">
                  {r.missing_count ? <span className="text-orange-600 font-medium">{r.missing_count}</span> : <Check className="w-4 h-4 text-green-600 inline" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── One application ──────────────────────────────────────────────────────────

interface Item {
  id: string; requirement_key: string; kind: 'document' | 'ein' | 'ssn'; original_name: string | null;
  size_bytes: string | null; source: 'applicant' | 'operator'; note: string | null; created_at: string;
  masked: string | null;
}
interface Requirement { key: string; label: string; kind: string; required: boolean; active: boolean }
interface Detail {
  application: Record<string, string | number | boolean | null | string[]>;
  items: Item[]; requirements: Requirement[];
  missing: { fields: { key: string; label: string }[]; items: { key: string; label: string }[] };
  existing_login: { company_id: string; company_name: string; user_name: string } | null;
}

type Panel = null | 'request' | 'decline' | 'approve';

function ApplicationDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [link, setLink] = useState<{ label: string; url: string; note?: string } | null>(null);
  const key = ['admin-application', id];
  // Always fresh: an applicant may have submitted or added documents since
  // this was last open, and acting on a stale status is how mistakes happen.
  const { data, isLoading } = useQuery<Detail>({
    queryKey: key, queryFn: () => adminApi.get(`/applications/${id}`).then((r) => r.data.data),
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['admin-applications'] });
    qc.invalidateQueries({ queryKey: ['admin-application-counts'] });
  };

  const action = useMutation({
    mutationFn: (path: string) => adminApi.post(`/applications/${id}/${path}`).then((r) => r.data.data),
    onSuccess: (d: { resume_link?: string; invite_link?: string }, path) => {
      if (path === 'resume-link' && d.resume_link) {
        setLink({ label: 'New link to the application', url: d.resume_link, note: 'Their previous link no longer works.' });
      }
      if (path === 'invite' && d.invite_link) {
        setLink({ label: 'New set-password link', url: d.invite_link, note: 'Emailed to them if email is set up. Works once, for 14 days.' });
      }
      if (path === 'in-review') toast.success('Marked in review');
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, 'That didn’t work')),
  });

  if (isLoading || !data) {
    return <div className="card p-8 text-center text-sm text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline" /> Loading…</div>;
  }
  const a = data.application;
  const status = String(a['status']);
  const open = ['submitted', 'in_review', 'docs_requested'].includes(status);
  const s = (k: string) => (a[k] === null || a[k] === undefined || a[k] === '' ? null : String(a[k]));
  const missingCount = data.missing.fields.length + data.missing.items.length;

  return (
    <div className="space-y-5">
      <button className="btn-ghost btn-sm" onClick={onBack}><ArrowLeft className="w-4 h-4" /> All applications</button>

      <div className="card p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate">{s('legal_name')}</h2>
              <span className={STATUS_BADGE[status] ?? 'badge-gray'}>{statusLabel(status)}</span>
            </div>
            {s('dba') && <p className="text-sm text-slate-500">dba {s('dba')}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>{s('contact_first_name')} {s('contact_last_name')}</span>
              <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${s('contact_email')}`}><Mail className="w-3.5 h-3.5" />{s('contact_email')}</a>
              {s('contact_phone') && <a className="inline-flex items-center gap-1 hover:underline" href={`tel:${s('contact_phone')}`}><Phone className="w-3.5 h-3.5" />{s('contact_phone')}</a>}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Started {formatDate(s('created_at'))}
              {s('submitted_at') && ` · submitted ${formatDate(s('submitted_at'))}`}
              {s('reviewed_at') && ` · decided ${formatDate(s('reviewed_at'))}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {status === 'submitted' && (
              <button className="btn-secondary" disabled={action.isPending} onClick={() => action.mutate('in-review')}>Start review</button>
            )}
            {open && <>
              <button className="btn-secondary" onClick={() => setPanel(panel === 'request' ? null : 'request')}>Ask for more</button>
              <button className="btn-secondary" onClick={() => setPanel(panel === 'decline' ? null : 'decline')}>Decline</button>
              <button className="btn-primary" onClick={() => setPanel(panel === 'approve' ? null : 'approve')}>Approve</button>
            </>}
            {(status === 'draft' || open) && (
              <button className="btn-ghost" disabled={action.isPending}
                      onClick={() => { if (window.confirm('Make a new link to this application? The applicant’s current link will stop working.')) action.mutate('resume-link'); }}>
                New applicant link
              </button>
            )}
            {status === 'approved' && (
              <button className="btn-secondary" disabled={action.isPending}
                      onClick={() => { if (window.confirm('Make a new set-password link? Any earlier one stops working.')) action.mutate('invite'); }}>
                New set-password link
              </button>
            )}
          </div>
        </div>

        {status === 'docs_requested' && s('request_message') && (
          <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
            <p className="font-medium">You asked for:</p>
            <p className="whitespace-pre-line">{s('request_message')}</p>
          </div>
        )}
        {status === 'declined' && s('decline_reason') && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-medium">Declined:</p><p className="whitespace-pre-line">{s('decline_reason')}</p>
          </div>
        )}
        {status === 'approved' && (
          <p className="mt-4 text-sm text-green-800 bg-green-50 border border-green-200 rounded-md p-3">
            Approved. The client’s company and login are set up, and they’re an active funding client —
            set advance terms and limits under Clients as usual.
          </p>
        )}

        {link && <div className="mt-4"><CopyLink {...link} onDismiss={() => setLink(null)} /></div>}
      </div>

      {panel === 'request' && (
        <RequestMorePanel id={id} detail={data} onDone={(url) => {
          setPanel(null); refresh();
          setLink({ label: 'Link for the applicant', url, note: 'Emailed to them if email is set up — send it yourself if not. Their previous link no longer works.' });
        }} onCancel={() => setPanel(null)} />
      )}
      {panel === 'decline' && <DeclinePanel id={id} onDone={() => { setPanel(null); refresh(); }} onCancel={() => setPanel(null)} />}
      {panel === 'approve' && (
        <ApprovePanel id={id} missingCount={missingCount} email={s('contact_email') ?? ''}
          existing={data.existing_login}
          onDone={(r) => {
            setPanel(null); refresh();
            if (r.invite_link) {
              setLink({ label: 'Set-password link for the client', url: r.invite_link,
                        note: 'Emailed to them if email is set up — send it yourself if not. Works once, for 14 days.' });
            } else {
              toast.success('Approved — linked to their existing login, and funding is turned on');
            }
          }}
          onCancel={() => setPanel(null)} />
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5 items-start">
        <div className="card p-5 space-y-5">
          {missingCount > 0 && (
            <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
              <p className="text-sm font-medium text-orange-900">Missing ({missingCount})</p>
              <p className="text-sm text-orange-800">{[...data.missing.fields, ...data.missing.items].map((m) => m.label).join(', ')}</p>
            </div>
          )}
          <Section title="Business" rows={[
            ['Legal name', s('legal_name')], ['DBA', s('dba')], ['Entity', ENTITY_LABEL[s('entity_type') ?? ''] ?? s('entity_type')],
            ['State formed', s('state_of_formation')], ['Years in business', s('years_in_business') && String(Number(s('years_in_business')))],
            ['Address', [s('address_line1'), s('city'), [s('state_code'), s('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null],
          ]} />
          <Section title="Government work" rows={[
            ['Agencies', s('agencies')],
            ['Monthly invoicing', s('monthly_volume') && formatCurrency(s('monthly_volume'))],
            ['Typical invoice', s('typical_invoice') && formatCurrency(s('typical_invoice'))],
            ['Days to pay', s('typical_days_to_pay')],
            ['Existing lender', a['has_existing_lender'] === true ? (s('existing_lender') ?? 'Yes') : a['has_existing_lender'] === false ? 'None' : null],
            ['Heard about us', s('how_heard')],
          ]} />
          <Section title="Ownership" rows={[
            ['Owner', [s('owner_name'), s('owner_title')].filter(Boolean).join(', ') || null],
            ['Ownership', s('owner_ownership_pct') && `${Number(s('owner_ownership_pct'))}%`],
            ['Signer', [s('signer_name'), s('signer_title')].filter(Boolean).join(', ') || null],
          ]} />
          <Section title="Signature" rows={[
            ['Signed by', s('signature_name')], ['Signed', s('signed_at') && new Date(String(s('signed_at'))).toLocaleString()],
            ['From IP', s('signed_ip')], ['Consent version', s('consent_version')],
          ]} />
        </div>

        <ItemsPanel id={id} detail={data} open={status !== 'approved' && status !== 'declined'} onChanged={refresh} />
      </div>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: [string, string | null | undefined | false][] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-900 break-words whitespace-pre-line">{v || <span className="text-slate-300">—</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─── Documents and numbers ────────────────────────────────────────────────────

function ItemsPanel({ id, detail, open, onChanged }: { id: string; detail: Detail; open: boolean; onChanged: () => void }) {
  const [marking, setMarking] = useState<string | null>(null);
  const [note, setNote] = useState('Signed via PandaDoc');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const qc = useQueryClient();

  const mark = useMutation({
    mutationFn: (requirement_key: string) =>
      adminApi.post(`/applications/${id}/mark-received`, { requirement_key, note: note.trim() }).then((r) => r.data.data),
    onSuccess: (d) => { qc.setQueryData(['admin-application', id], d); setMarking(null); onChanged(); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t mark that received')),
  });
  const unmark = useMutation({
    mutationFn: (itemId: string) => adminApi.delete(`/applications/${id}/items/${itemId}`).then((r) => r.data.data),
    onSuccess: (d) => { qc.setQueryData(['admin-application', id], d); onChanged(); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t remove that')),
  });

  const reveal = async (item: Item) => {
    if (revealed[item.id]) { setRevealed(({ [item.id]: _, ...rest }) => rest); return; }
    try {
      const r = await adminApi.post(`/applications/${id}/items/${item.id}/reveal`);
      setRevealed((m) => ({ ...m, [item.id]: r.data.data.value }));
      // Don't leave it on screen.
      setTimeout(() => setRevealed(({ [item.id]: _, ...rest }) => rest), 30_000);
    } catch (e) {
      toast.error(errMsg(e, 'Couldn’t show the number'));
    }
  };

  const download = (item: Item) =>
    void downloadVia(adminApi, `/applications/${id}/items/${item.id}/download`, item.original_name ?? 'document')
      .catch(() => toast.error('Download failed'));

  const reqs = detail.requirements.filter((r) => r.active || detail.items.some((i) => i.requirement_key === r.key));

  return (
    <div className="card">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3>Documents and numbers</h3>
        <p className="text-xs text-slate-500 mt-0.5">Downloads and reveals are recorded in the audit log.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {reqs.map((r) => {
          const items = detail.items.filter((i) => i.requirement_key === r.key);
          const done = items.length > 0;
          return (
            <li key={r.key} className="px-5 py-3.5 flex gap-3">
              {done ? <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" /> : <Circle className="w-5 h-5 text-slate-300 flex-shrink-0" />}
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm font-medium text-slate-900">
                  {r.label}{!r.required && <span className="ml-1.5 text-xs font-normal text-slate-400">optional</span>}
                </p>
                {items.map((i) => (
                  <div key={i.id} className="flex items-center gap-2 text-sm">
                    {i.source === 'operator' ? (
                      <>
                        <span className="text-green-700">Received: {i.note}</span>
                        {open && (
                          <button className="text-xs text-slate-500 hover:text-red-600 hover:underline" disabled={unmark.isPending}
                                  onClick={() => unmark.mutate(i.id)}>undo</button>
                        )}
                      </>
                    ) : i.kind === 'document' ? (
                      <button className="inline-flex items-center gap-1.5 text-brand-700 hover:underline min-w-0" onClick={() => download(i)}>
                        <FileText className="w-4 h-4 flex-shrink-0" /><span className="truncate">{i.original_name}</span>
                        <Download className="w-3.5 h-3.5 flex-shrink-0" />
                      </button>
                    ) : (
                      <>
                        <span className="font-mono">{revealed[i.id] ?? i.masked}</span>
                        <button className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={() => void reveal(i)}>
                          {revealed[i.id] ? <><EyeOff className="w-3.5 h-3.5" /> Hide</> : <><Eye className="w-3.5 h-3.5" /> Show</>}
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {open && !done && marking !== r.key && (
                  <button className="text-xs text-slate-600 hover:text-slate-900 hover:underline" onClick={() => setMarking(r.key)}>
                    Mark received outside the app
                  </button>
                )}
                {marking === r.key && (
                  <form className="flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); mark.mutate(r.key); }}>
                    <input className="input text-sm" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required
                           aria-label="How it was received" autoFocus />
                    <div className="flex gap-2">
                      <button className="btn-primary btn-sm" disabled={mark.isPending}>Save</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setMarking(null)}>Cancel</button>
                    </div>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Decisions ────────────────────────────────────────────────────────────────

function RequestMorePanel({ id, detail, onDone, onCancel }: {
  id: string; detail: Detail; onDone: (link: string) => void; onCancel: () => void;
}) {
  const missingKeys = detail.missing.items.map((m) => m.key);
  const [items, setItems] = useState<string[]>(missingKeys);
  const first = String(detail.application['contact_first_name'] ?? '');
  const [message, setMessage] = useState(
    `Hi ${first}, thanks for your application. To finish our review we need the items listed below. ` +
    `You can upload them from the same application page.`);
  const send = useMutation({
    mutationFn: () => adminApi.post(`/applications/${id}/request-documents`, { items, message: message.trim() }).then((r) => r.data.data),
    onSuccess: (d: { resume_link: string }) => onDone(d.resume_link),
    onError: (e) => toast.error(errMsg(e, 'Couldn’t send the request')),
  });
  const toggle = (k: string) => setItems((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));

  return (
    <form className="card p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <div>
        <h3>Ask for more</h3>
        <p className="text-sm text-slate-500 mt-0.5">Reopens the application for them and makes a fresh link to it.</p>
      </div>
      <fieldset>
        <legend className="label">What’s needed</legend>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {detail.requirements.filter((r) => r.active).map((r) => (
            <label key={r.key} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="w-4 h-4" checked={items.includes(r.key)} onChange={() => toggle(r.key)} />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="rm_msg">Message to the applicant</label>
        <textarea id="rm_msg" className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={2000} />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={send.isPending}>{send.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Send</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function DeclinePanel({ id, onDone, onCancel }: { id: string; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const decline = useMutation({
    mutationFn: () => adminApi.post(`/applications/${id}/decline`, { reason: reason.trim() }),
    onSuccess: () => { toast.success('Application declined'); onDone(); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t decline')),
  });
  return (
    <form className="card p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); decline.mutate(); }}>
      <div>
        <h3>Decline</h3>
        <p className="text-sm text-slate-500 mt-0.5">For your records — the applicant isn’t emailed. Their link stops working.</p>
      </div>
      <div>
        <label className="label" htmlFor="dc_reason">Reason</label>
        <textarea id="dc_reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000} />
      </div>
      <div className="flex gap-2">
        <button className="btn-danger" disabled={decline.isPending}>Decline application</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ApprovePanel({ id, missingCount, email, existing, onDone, onCancel }: {
  id: string; missingCount: number; email: string; existing: Detail['existing_login'];
  onDone: (r: { created_login: boolean; invite_link: string | null }) => void; onCancel: () => void;
}) {
  const { data: schedules } = useQuery<{ id: string; name: string; advance_rate?: string }[]>({
    queryKey: ['admin-fee-schedules'], queryFn: () => adminApi.get('/fee-schedules').then((r) => r.data.data),
  });
  const [schedule, setSchedule] = useState('');
  const [limit, setLimit] = useState('');
  const approve = useMutation({
    mutationFn: () => adminApi.post(`/applications/${id}/approve`, {
      fee_schedule_id: schedule,
      credit_limit: limit.trim() ? Number(limit.replace(/[$,\s]/g, '')) : null,
    }).then((r) => r.data.data),
    onSuccess: onDone,
    onError: (e) => toast.error(errMsg(e, 'Couldn’t approve')),
  });

  return (
    <form className="card p-5 space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (limit.trim() && !Number.isFinite(Number(limit.replace(/[$,\s]/g, '')))) { toast.error('Enter the credit limit as a number'); return; }
      approve.mutate();
    }}>
      <div>
        <h3>Approve</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Creates their company and a login for <strong>{email}</strong> (or links an existing ConstructPM login
          with that email), makes them an active funding client, and files their documents with the account.
          Their portal shows Funding only.
        </p>
      </div>
      {existing && (
        <div className="text-sm text-orange-900 bg-orange-50 border border-orange-200 rounded-md p-3">
          <p className="font-medium">{email} already has a ConstructPM login — {existing.user_name} at {existing.company_name}.</p>
          <p className="mt-0.5">
            Approving turns funding on for <strong>{existing.company_name}</strong> and files these documents there;
            no new login is created. Only continue if you’ve confirmed with them that this application is theirs.
          </p>
        </div>
      )}
      {missingCount > 0 && (
        <p className="text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-md p-3">
          {missingCount} item{missingCount === 1 ? ' is' : 's are'} still missing. Approve anyway only if you have them another way —
          or mark them received first.
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ap_fee">Fee schedule</label>
          <select id="ap_fee" className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)} required>
            <option value="">Select…</option>
            {(schedules ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ap_limit">Credit limit <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="ap_limit" className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 250000" />
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={approve.isPending}>
          {approve.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {existing ? `Approve and turn on funding for ${existing.company_name}` : 'Approve and create login'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
