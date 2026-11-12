import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { api, apiError } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import logo from '../../assets/onesource-logo.png';

/**
 * /accept-invite#token=… — an approved applicant sets their password.
 *
 * The token is read from the fragment once and then removed from the address
 * bar, so it isn't left in browser history or shown over a shoulder. It's
 * single-use and expires; One Source can issue a new one from the console.
 */
export function AcceptInvitePage() {
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
      await acceptInvite(token, password);
      navigate('/funding', { replace: true });
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
          <img src={logo} alt="One Source Funding" className="h-14 w-auto" />
        </div>
        <div className="card p-6 sm:p-8">
          {state === 'loading' && (
            <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-os-navy" /></div>
          )}
          {state === 'invalid' && (
            <div className="space-y-3">
              <h1 className="text-xl font-bold text-slate-900">This link has expired</h1>
              <p className="text-sm text-slate-600">
                Set-up links work once and expire after 14 days. Ask One Source for a new one — or, if you’ve
                already set your password, sign in.
              </p>
              <Link to="/login" className="btn-os w-full">Sign in</Link>
            </div>
          )}
          {state === 'ready' && info && (
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Welcome, {info.first_name}</h1>
                <p className="text-sm text-slate-500 mt-1">
                  Set a password for <strong className="text-slate-700">{info.email}</strong> to sign in to{' '}
                  {info.company_name}’s funding account.
                </p>
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
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Set password and sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
