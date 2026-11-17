import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../lib/admin-api';
import { apiError } from '../../lib/api';

export interface SystemStatus {
  email: { configured: boolean; from: string; ops_inbox: string | null };
  error_tracking: boolean;
  malware_scanning: { configured: boolean; reachable: boolean };
  encryption_key: boolean;
  storage: { host: string; local_minio: boolean; encrypt_at_rest: boolean };
  business_time_zone: string;
  release: string | null;
}

export const useSystemStatus = () => useQuery<SystemStatus>({
  queryKey: ['admin-system'],
  queryFn: () => adminApi.get('/system').then((r) => r.data.data),
  staleTime: 60_000,
});

/** What's switched on in this deployment, and what still needs setting up. */
export function SystemPanel() {
  const { data: s, isLoading } = useSystemStatus();
  const [busy, setBusy] = useState(false);
  if (isLoading || !s) return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />;

  const testEmail = async () => {
    setBusy(true);
    try {
      const r = await adminApi.post('/system/test-email');
      toast.success(`Sent to ${r.data.data.sent_to} — check the inbox (and spam)`);
    } catch (e) {
      toast.error(apiError(e, 'Couldn’t send'));
    } finally {
      setBusy(false);
    }
  };

  const rows: { label: string; ok: boolean; detail: string; fix?: string }[] = [
    { label: 'Email', ok: s.email.configured, detail: s.email.configured ? `Sending as ${s.email.from}` : 'Off',
      fix: 'Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env.production. Without it, invites, password resets and alerts are not sent.' },
    { label: 'Alerts to One Source', ok: Boolean(s.email.configured && s.email.ops_inbox), detail: s.email.ops_inbox ?? 'No inbox set',
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
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 px-4 py-3">
            {r.ok ? <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  : <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900">{r.label}</p>
              <p className="text-sm text-slate-600 break-words">{r.detail}</p>
              {!r.ok && r.fix && <p className="text-xs text-slate-500 mt-1">{r.fix}</p>}
            </div>
            {r.label === 'Email' && s.email.configured && (
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => void testEmail()}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send me a test
              </button>
            )}
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
  if (!s || s.email.configured) return null;
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      Email is off on this server: invites, password resets and your alerts aren’t being sent. See the System tab.
    </div>
  );
}
