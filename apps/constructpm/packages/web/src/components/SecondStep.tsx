import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The second step of signing in, shared by the client app and the operator
 * console:
 *
 *   verify  enter the 6-digit code from an authenticator app (or a recovery
 *           code), and the session opens.
 *   setup   first time: scan a QR code, confirm with a code, save the
 *           recovery codes — then the session opens.
 *
 * `post(path, body)` is the caller's API client returning `data`; the paths
 * differ between the client app (/auth/mfa/…) and the console (/auth/mfa/…
 * under /api/admin).
 */
export interface SessionData { access_token: string; user: unknown; recovery_codes?: string[] }

export function SecondStep({ mode, challenge, post, onDone, onCancel, issuer = 'One Source' }: {
  mode: 'verify' | 'setup';
  challenge: string;
  post: (path: string, body: object) => Promise<unknown>;
  onDone: (session: SessionData) => void;
  onCancel: () => void;
  issuer?: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [saved, setSaved] = useState<SessionData | null>(null);

  useEffect(() => {
    if (mode !== 'setup') return;
    let live = true;
    (async () => {
      try {
        const d = await post('/auth/mfa/setup/start', { challenge }) as { secret: string; otpauth_uri: string };
        const qr = await QRCode.toDataURL(d.otpauth_uri, { margin: 1, width: 200 });
        if (live) setSetup({ secret: d.secret, qr });
      } catch (e) {
        if (live) setError(message(e, 'Couldn’t start setup. Sign in again.'));
      }
    })();
    return () => { live = false; };
  }, [mode, challenge, post]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await post(mode === 'verify' ? '/auth/mfa/verify' : '/auth/mfa/setup/finish', { challenge, code: code.trim() }) as SessionData;
      if (d.recovery_codes?.length) setSaved(d);
      else onDone(d);
    } catch (err) {
      setError(message(err, 'That code didn’t work.'));
    } finally {
      setBusy(false);
    }
  };

  if (saved) return <RecoveryCodes codes={saved.recovery_codes!} issuer={issuer} onContinue={() => onDone(saved)} />;

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      {mode === 'verify' ? (
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-brand-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-slate-600">
            Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes instead.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Two-step sign-in is required for this account. Scan this with an authenticator app
            (Google Authenticator, Microsoft Authenticator, 1Password, Authy), then enter the code it shows.
          </p>
          {setup ? (
            <div className="flex flex-col items-center gap-2">
              <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded border border-slate-200" />
              <p className="text-xs text-slate-500">Can’t scan? Enter this key:</p>
              <code className="text-xs font-mono bg-slate-50 border border-slate-200 rounded px-2 py-1 break-all text-center">
                {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
              </code>
            </div>
          ) : !error ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : null}
        </div>
      )}
      <div>
        <label className="label" htmlFor="mfa_code">{mode === 'verify' ? 'Code' : 'Code from the app'}</label>
        <input id="mfa_code" className="input text-center text-lg tracking-widest font-mono" value={code}
               onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode={mode === 'setup' ? 'numeric' : 'text'}
               autoFocus required maxLength={20} placeholder="123456" />
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || (mode === 'setup' && !setup)}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} {mode === 'verify' ? 'Continue' : 'Turn on and continue'}
      </button>
      <button type="button" className="text-sm text-slate-500 hover:underline w-full" onClick={onCancel}>
        Start over
      </button>
    </form>
  );
}

/** Shown once, right after setup: the codes that get you in without your phone. */
export function RecoveryCodes({ codes, issuer, onContinue }: { codes: string[]; issuer: string; onContinue: () => void }) {
  const [ack, setAck] = useState(false);
  const text = `${issuer} recovery codes\nEach works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <KeyRound className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-slate-600">
          Save these recovery codes. If you lose your phone, each one gets you in once.
          This is the only time they’re shown.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm bg-slate-50 border border-slate-200 rounded-md p-3">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1"
                onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('Copied'))}>
          <Copy className="w-4 h-4" /> Copy
        </button>
        <button type="button" className="btn-secondary flex-1" onClick={() => {
          const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
          const a = document.createElement('a'); a.href = url; a.download = 'recovery-codes.txt';
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>
          <Download className="w-4 h-4" /> Download
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I’ve saved my recovery codes
      </label>
      <button type="button" className="btn-primary w-full" disabled={!ack} onClick={onContinue}>Continue</button>
    </div>
  );
}

function message(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message ?? fallback;
}
