import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { api, apiError } from '../../lib/api';
import { useAuthStore, type SignInResult } from '../../stores/auth.store';
import { SecondStep } from '../../components/SecondStep';
import { LedgerMark } from '../../components/brand/LedgerMark';

/**
 * /accept-invite#token=… — an approved applicant sets their password.
 * /reset-password#token=… — anyone who asked to reset theirs (same link
 * rules, same endpoint; `mode` only changes the words).
 *
 * The token is read from the fragment once and then removed from the address
 * bar, so it isn't left in browser history or shown over a shoulder. It's
 * single-use and expires; One Source can issue a new one from the console.
 */
const postData = (path: string, body: object) => api.post(path, body).then((r) => r.data.data);

export function AcceptInvitePage({ mode = 'invite' }: { mode?: 'invite' | 'reset' }) {
  const tokenRef = useRef<string | null>(null);
  if (tokenRef.current === null) {
    const m = /(?:^|[#&])token=([A-Za-z0-9_-]{20,200})/.exec(window.location.hash);
    tokenRef.current = m?.[1] ?? '';
  }
  const token = tokenRef.current;
  const [info, setInfo] = useState<{ email: string; first_name: string; company_name: string } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>(token ? 'loading' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acceptInvite = useAuthStore((s) => s.acceptInvite);
  const finishSignIn = useAuthStore((s) => s.finishSignIn);
  const [step, setStep] = useState<Extract<SignInResult, { done: false }> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) return;
    window.history.replaceState(null, '', window.location.pathname);
    api.post('/auth/invite/info', { token })
      .then((r) => { setInfo(r.data.data); setState('ready'); })
      .catch(() => setState('invalid'));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) { setError('Use at least 10 characters.'); return; }
    if (password !== confirm) { setError('The two passwords don’t match.'); return; }
    setBusy(true);
    try {
      const r = await acceptInvite(token, password);
      if (r.done) navigate('/dashboard', { replace: true });
      else setStep(r);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) setState('invalid');
      else setError(apiError(err, 'Couldn’t set your password. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="os-brand min-h-[100dvh] flex items-center justify-center bg-os-mist px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <LedgerMark tone="light" size="lg" />
        </div>
        <div className="card p-6 sm:p-8">
          {state === 'loading' && (
            <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-os-navy" /></div>
          )}
          {step && (
            <div className="space-y-4">
              <h1 className="text-xl font-bold text-slate-900">
                {step.mode === 'verify' ? 'Two-step sign-in' : 'Set up two-step sign-in'}
              </h1>
              <p className="text-sm text-slate-600">Your password is set. One more step to sign in.</p>
              <SecondStep mode={step.mode} challenge={step.challenge} post={postData}
                          onCancel={() => navigate('/login', { replace: true })}
                          onDone={(d) => void finishSignIn(d).then(() => navigate('/dashboard', { replace: true }))} />
            </div>
          )}
          {!step && state === 'invalid' && (
            <div className="space-y-3">
              <h1 className="text-xl font-bold text-slate-900">This link has expired</h1>
              {mode === 'reset' ? (
                <>
                  <p className="text-sm text-slate-600">
                    Reset links work once and expire after an hour. Ask for a new one — or, if you’ve
                    already changed your password, sign in.
                  </p>
                  <Link to="/forgot-password" className="btn-os w-full">Send a new link</Link>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    Set-up links work once and expire after 14 days. Ask One Source for a new one — or, if you’ve
                    already set your password, sign in.
                  </p>
                  <Link to="/login" className="btn-os w-full">Sign in</Link>
                </>
              )}
            </div>
          )}
          {!step && state === 'ready' && info && (
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <div>
                {mode === 'reset' ? (
                  <>
                    <h1 className="text-xl font-bold text-slate-900">Choose a new password</h1>
                    <p className="text-sm text-slate-500 mt-1">
                      For <strong className="text-slate-700">{info.email}</strong>. Anywhere you’re signed in
                      will be signed out.
                    </p>
                  </>
                ) : (
                  <>
                    <h1 className="text-xl font-bold text-slate-900">Welcome, {info.first_name}</h1>
                    <p className="text-sm text-slate-500 mt-1">
                      Set a password for <strong className="text-slate-700">{info.email}</strong> to sign in to{' '}
                      {info.company_name}’s account.
                    </p>
                  </>
                )}
              </div>
              {/* Lets password managers save the login against the right username. */}
              <input type="email" value={info.email} autoComplete="username" readOnly hidden />
              <div>
                <label className="label" htmlFor="inv_pw">New password</label>
                <div className="relative">
                  <input id="inv_pw" type={show ? 'text' : 'password'} className="input pr-10" value={password}
                         onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={128}
                         autoComplete="new-password" autoFocus />
                  <button type="button" onClick={() => setShow((v) => !v)}
                          className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600"
                          aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">At least 10 characters.</p>
              </div>
              <div>
                <label className="label" htmlFor="inv_pw2">Confirm password</label>
                <input id="inv_pw2" type={show ? 'text' : 'password'} className="input" value={confirm}
                       onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
              </div>
              {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
              <button className="btn-os w-full" disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} {mode === 'reset' ? 'Save and sign in' : 'Set password and sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
