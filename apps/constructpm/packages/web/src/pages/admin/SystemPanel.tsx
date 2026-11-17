import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Loader2, Send, Link2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../lib/admin-api';
import { apiError } from '../../lib/api';

export interface GoogleConnection {
  email: string; status: 'ok' | 'broken'; last_error: string | null; last_error_at: string | null;
  last_sent_at: string | null; connected_at: string; connected_by: string | null;
}

export interface EmailStatus {
  mode: 'google' | 'smtp' | 'off';
  ready: boolean;
  from: string;
  ops_inbox: string | null;
  smtp: { host: string; port: number } | null;
  google: { configured: boolean; can_connect: boolean; redirect_uri: string; connection: GoogleConnection | null };
}

export interface SystemStatus {
  email: EmailStatus;
  error_tracking: boolean;
  malware_scanning: { configured: boolean; reachable: boolean };
  encryption_key: boolean;
  storage: { host: string; local_minio: boolean; encrypt_at_rest: boolean };
  business_time_zone: string;
  release: string | null;
}

export const useSystemStatus = (poll = false) => useQuery<SystemStatus>({
  queryKey: ['admin-system'],
  queryFn: () => adminApi.get('/system').then((r) => r.data.data),
  staleTime: 60_000,
  refetchInterval: poll ? 2_000 : false,
});

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;

/** The email row: how mail leaves the server, and connecting the Google mailbox. */
function EmailRow({ e, onTest, testing }: { e: EmailStatus; onTest: () => void; testing: boolean }) {
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState<{ since: number; win: Window | null } | null>(null);
  const { data: live } = useSystemStatus(Boolean(waiting));
  const conn = (live?.email ?? e).google.connection;
  const startedWith = useRef<string | null>(null);

  // While the Google window is open: stop when a new connection shows up, or the window closes.
  useEffect(() => {
    if (!waiting) return;
    if (conn && conn.connected_at !== startedWith.current && conn.status === 'ok') {
      setWaiting(null);
      toast.success(`Connected: email now goes out through ${conn.email}`);
      return;
    }
    const t = setInterval(() => {
      if (waiting.win?.closed || Date.now() - waiting.since > 10 * 60_000) {
        setWaiting(null);
        void qc.invalidateQueries({ queryKey: ['admin-system'] });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [waiting, conn, qc]);

  const connect = async () => {
    // Open the window now, inside the click, or the browser blocks it.
    const win = window.open('', 'google-connect', 'width=520,height=700');
    try {
      const r = await adminApi.post('/system/google/connect');
      if (!win) { toast.error('Your browser blocked the Google window. Allow pop-ups for this site and try again.'); return; }
      win.location.href = r.data.data.url as string;
      startedWith.current = conn?.connected_at ?? null;
      setWaiting({ since: Date.now(), win });
    } catch (err) {
      win?.close();
      toast.error(apiError(err, 'Couldn’t start connecting'), { duration: 12_000 });
    }
  };

  const disconnect = async () => {
    if (!conn || !window.confirm(`Stop sending email through ${conn.email}? Invites, password resets and alerts stop until a mailbox is connected again.`)) return;
    try {
      const r = await adminApi.post('/system/google/disconnect');
      toast.success(r.data.data.revoked ? 'Disconnected, and Google’s permission removed' : 'Disconnected');
      await qc.invalidateQueries({ queryKey: ['admin-system'] });
    } catch (err) {
      toast.error(apiError(err, 'Couldn’t disconnect'));
    }
  };

  const g = e.google;
  let ok: boolean, detail: React.ReactNode, fix: React.ReactNode = null;
  if (conn?.status === 'broken') {
    ok = false;
    detail = <>Google cancelled the permission to send from <strong>{conn.email}</strong>. Nothing is being sent.</>;
    fix = <>Google does this when that account’s password changes or its access is removed. Press Reconnect and sign in as {conn.email} again.</>;
  } else if (conn) {
    ok = true;
    detail = <>Sending as {e.from} through Google ({conn.email}){conn.last_sent_at ? ` · last sent ${when(conn.last_sent_at)}` : ''}</>;
    if (conn.last_error) fix = <>Last problem ({when(conn.last_error_at)}): {conn.last_error}</>;
  } else if (e.mode === 'smtp' && e.smtp) {
    ok = true;
    detail = <>Sending as {e.from} through {e.smtp.host}:{e.smtp.port}</>;
  } else {
    ok = false;
    detail = 'Off: invites, password resets and alerts aren’t being sent.';
    fix = !g.configured
      ? <>To send through your Google Workspace mailbox, set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.production (DEPLOY.md → Email), then connect it here. The OAuth client’s redirect URI is <code className="break-all">{g.redirect_uri}</code>.</>
      : !g.can_connect ? <>Set APPLICATION_DATA_KEY first: the permission is stored encrypted with it.</>
      : <>Connect the mailbox the app should send from. It only gets permission to send, not to read.</>;
  }
  const showConnect = g.configured && g.can_connect;

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3 px-4 py-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {ok ? <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            : <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900">Email</p>
          <p className="text-sm text-slate-600 break-words">{detail}</p>
          {fix && <p className="text-xs text-slate-500 mt-1 break-words">{fix}</p>}
          {waiting && <p className="text-xs text-brand-600 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Waiting for Google… finish in the window that opened.</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {ok && (
          <button className="btn-secondary btn-sm" disabled={testing} onClick={onTest}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send me a test
          </button>
        )}
        {showConnect && (!conn || conn.status === 'broken') && (
          <button className={conn ? 'btn-primary btn-sm' : (ok ? 'btn-secondary btn-sm' : 'btn-primary btn-sm')}
                  disabled={Boolean(waiting)} onClick={() => void connect()}>
            <Link2 className="w-4 h-4" /> {conn ? 'Reconnect' : 'Connect Google mailbox'}
          </button>
        )}
        {conn && (
          <button className="btn-ghost btn-sm text-red-600" onClick={() => void disconnect()}>
            <Unlink className="w-4 h-4" /> Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

/** What's switched on in this deployment, and what still needs setting up. */
export function SystemPanel() {
  const { data: s, isLoading } = useSystemStatus();
  const [busy, setBusy] = useState(false);
  if (isLoading || !s) return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />;

  const testEmail = async () => {
    setBusy(true);
    try {
      const r = await adminApi.post('/system/test-email', null, { timeout: 45_000 });
      toast.success(`Sent to ${r.data.data.sent_to} — check the inbox (and spam)`);
    } catch (e) {
      const timedOut = (e as { code?: string })?.code === 'ECONNABORTED';
      toast.error(timedOut ? 'No answer from the server within 30 seconds' : apiError(e, 'Couldn’t send'), { duration: 12_000 });
    } finally {
      setBusy(false);
    }
  };

  const rows: { label: string; ok: boolean; detail: string; fix?: string }[] = [
    { label: 'Alerts to One Source', ok: Boolean(s.email.ready && s.email.ops_inbox), detail: s.email.ops_inbox ?? 'No inbox set',
      fix: 'Set OPS_NOTIFICATION_EMAIL to the inbox that should hear about funding requests and applications.' },
    { label: 'Error tracking', ok: s.error_tracking, detail: s.error_tracking ? 'On' : 'Off',
      fix: 'Set SENTRY_DSN (a free Sentry project works) to be told about crashes.' },
    { label: 'Malware scanning', ok: s.malware_scanning.configured && s.malware_scanning.reachable,
      detail: !s.malware_scanning.configured ? 'Off' : s.malware_scanning.reachable ? 'On (ClamAV answering)' : 'Configured but not answering',
      fix: 'Start the clamav service (see DEPLOY.md) and set CLAMAV_HOST=clamav.' },
    { label: 'Encryption key', ok: s.encryption_key, detail: s.encryption_key ? 'Set' : 'Missing',
      fix: 'Set APPLICATION_DATA_KEY. Without it the application and two-step sign-in are off.' },
    { label: 'File storage', ok: !s.storage.local_minio, detail: `${s.storage.host}${s.storage.encrypt_at_rest ? ' · encrypted at rest' : ''}`,
      fix: 'Files are on the server’s own MinIO. Move them to managed storage (see DEPLOY.md, “File storage”).' },
  ];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="card divide-y divide-slate-100">
        <EmailRow e={s.email} onTest={() => void testEmail()} testing={busy} />
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 px-4 py-3">
            {r.ok ? <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  : <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900">{r.label}</p>
              <p className="text-sm text-slate-600 break-words">{r.detail}</p>
              {!r.ok && r.fix && <p className="text-xs text-slate-500 mt-1">{r.fix}</p>}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Business time zone {s.business_time_zone}{s.release ? ` · release ${s.release.slice(0, 12)}` : ''}
      </p>
    </div>
  );
}

/** Shown on every console tab while email is off: nothing is reaching clients or you. */
export function EmailOffBanner() {
  const { data: s } = useSystemStatus();
  if (!s || s.email.ready) return null;
  const broken = s.email.google.connection?.status === 'broken';
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      {broken
        ? <>Email has stopped: Google cancelled the permission to send from {s.email.google.connection?.email}. Reconnect it in the System tab.</>
        : <>Email is off on this server: invites, password resets and your alerts aren’t being sent. See the System tab.</>}
    </div>
  );
}
