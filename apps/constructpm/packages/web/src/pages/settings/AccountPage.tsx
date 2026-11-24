import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { PRODUCT_NAME } from '@constructpm/shared';
import { api, apiError } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { RecoveryCodes } from '../../components/SecondStep';

interface MfaStatus { enabled: boolean; required: boolean; recovery_left: number; available: boolean }

/** Your own account: email, password and two-step sign-in. Everyone has this page. */
export function AccountPage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return (
    <div className="page max-w-3xl mx-auto space-y-6">
      <div>
        <h1>Your account</h1>
        <p className="text-sm text-slate-500 mt-0.5">How you sign in, and keeping it secure.</p>
      </div>
      <section className="card p-5 space-y-3">
        <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <UserRound className="w-4 h-4 text-slate-400" /> {user.first_name} {user.last_name}
        </h2>
        <EmailRow />
        <PasswordRow />
      </section>
      <TwoStep />
    </div>
  );
}

function EmailRow() {
  const user = useAuthStore((s) => s.user)!;
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    try {
      await api.post('/auth/email/verify/resend');
      toast.success(`Sent — check ${user.email}`);
    } catch (e) {
      toast.error(apiError(e, 'Couldn’t send it'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Mail className="w-4 h-4 text-slate-400" />
      <span className="text-slate-800">{user.email}</span>
      {user.email_verified === false ? (
        <>
          <span className="badge-yellow">Not confirmed</span>
          <button className="text-brand-600 hover:underline" disabled={busy} onClick={() => void resend()}>Resend the link</button>
        </>
      ) : <span className="badge-green">Confirmed</span>}
    </div>
  );
}

function PasswordRow() {
  const user = useAuthStore((s) => s.user)!;
  const [sent, setSent] = useState(false);
  const send = async () => {
    try {
      await api.post('/auth/password/forgot', { email: user.email });
      setSent(true);
    } catch (e) {
      toast.error(apiError(e, 'Couldn’t send it'));
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <KeyRound className="w-4 h-4 text-slate-400" />
      <span className="text-slate-800">Password</span>
      {sent
        ? <span className="text-slate-500">A link to change it is on its way to your email.</span>
        : <button className="text-brand-600 hover:underline" onClick={() => void send()}>Change it</button>}
    </div>
  );
}

function TwoStep() {
  const qc = useQueryClient();
  const reloadUser = useAuthStore((s) => s.reloadUser);
  const { data: st, isLoading } = useQuery<MfaStatus>({ queryKey: ['mfa'], queryFn: () => api.get('/auth/mfa').then((r) => r.data.data) });
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'disable' | 'regen'>('idle');
  const done = async () => {
    setSetup(null); setCode(''); setPassword(''); setMode('idle');
    await qc.invalidateQueries({ queryKey: ['mfa'] });
    void reloadUser().catch(() => {});
  };

  const start = async () => {
    setBusy(true);
    try {
      const d = (await api.post('/auth/mfa/enroll/start')).data.data as { secret: string; otpauth_uri: string };
      setSetup({ secret: d.secret, qr: await QRCode.toDataURL(d.otpauth_uri, { margin: 1, width: 200 }) });
    } catch (e) {
      toast.error(apiError(e, 'Couldn’t start setup'));
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(apiError(e, 'That didn’t work')); } finally { setBusy(false); }
  };

  if (isLoading || !st) return <section className="card p-5"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></section>;

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-400" /> Two-step sign-in
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            After your password, enter a code from an authenticator app on your phone. Someone who learns your
            password still can’t get in.
          </p>
        </div>
        {st.enabled ? <span className="badge-green whitespace-nowrap">On</span> : <span className="badge-gray whitespace-nowrap">Off</span>}
      </div>

      {codes && <RecoveryCodes codes={codes} issuer={PRODUCT_NAME} onContinue={() => { setCodes(null); void done(); }} />}

      {!codes && !st.enabled && !setup && (
        st.available
          ? <button className="btn-primary" disabled={busy} onClick={() => void start()}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Turn on two-step sign-in
            </button>
          : <p className="text-sm text-slate-500">Not available on this server yet.</p>
      )}

      {!codes && setup && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void act(async () => {
          const d = (await api.post('/auth/mfa/enroll/finish', { code: code.trim() })).data.data as { recovery_codes: string[] };
          setSetup(null); setCodes(d.recovery_codes);
        }); }}>
          <p className="text-sm text-slate-600">
            Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy), then
            enter the 6-digit code it shows.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded border border-slate-200" />
            <div className="text-xs text-slate-500 space-y-1">
              <p>Can’t scan? Enter this key:</p>
              <code className="block font-mono bg-slate-50 border border-slate-200 rounded px-2 py-1 break-all">
                {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
              </code>
            </div>
          </div>
          <div className="flex gap-2 max-w-sm">
            <input className="input font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
                   autoComplete="one-time-code" placeholder="123456" aria-label="Code from the app" required />
            <button className="btn-primary whitespace-nowrap" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Turn on</button>
          </div>
          <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setSetup(null)}>Cancel</button>
        </form>
      )}

      {!codes && st.enabled && mode === 'idle' && (
        <div className="space-y-2 text-sm">
          <p className="text-slate-600 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            {st.recovery_left} recovery code{st.recovery_left === 1 ? '' : 's'} left.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={() => setMode('regen')}>New recovery codes</button>
            {st.required
              ? <span className="text-xs text-slate-500 self-center">Your company requires two-step sign-in.</span>
              : <button className="btn-ghost btn-sm text-red-600" onClick={() => setMode('disable')}>Turn off</button>}
          </div>
        </div>
      )}

      {!codes && st.enabled && mode !== 'idle' && (
        <form className="space-y-3 max-w-sm" onSubmit={(e) => { e.preventDefault(); void act(async () => {
          if (mode === 'disable') {
            await api.post('/auth/mfa/disable', { password, code: code.trim() });
            toast.success('Two-step sign-in is off');
            await done();
          } else {
            const d = (await api.post('/auth/mfa/recovery-codes', { code: code.trim() })).data.data as { recovery_codes: string[] };
            setMode('idle'); setCode(''); setCodes(d.recovery_codes);
          }
        }); }}>
          <p className="text-sm text-slate-600">
            {mode === 'disable' ? 'Enter your password and a current code to turn it off.' : 'Enter a current code. Your old recovery codes stop working.'}
          </p>
          {mode === 'disable' && (
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)}
                   placeholder="Password" aria-label="Password" autoComplete="current-password" required />
          )}
          <input className="input font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value)}
                 placeholder="123456" aria-label="Code" autoComplete="one-time-code" required />
          <div className="flex gap-2">
            <button className={mode === 'disable' ? 'btn-danger' : 'btn-primary'} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} {mode === 'disable' ? 'Turn off' : 'Get new codes'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setMode('idle'); setCode(''); setPassword(''); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
