import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import logo from '../../assets/onesource-logo.png';

/** /verify-email#token=… — confirms the address on a new account. */
export function VerifyEmailPage() {
  const tokenRef = useRef<string | null>(null);
  if (tokenRef.current === null) {
    const m = /(?:^|[#&])token=([A-Za-z0-9_-]{20,200})/.exec(window.location.hash);
    tokenRef.current = m?.[1] ?? '';
  }
  const [state, setState] = useState<'working' | 'done' | 'invalid'>(tokenRef.current ? 'working' : 'invalid');
  const user = useAuthStore((s) => s.user);
  const reloadUser = useAuthStore((s) => s.reloadUser);

  useEffect(() => {
    const token = tokenRef.current;
    if (!token) return;
    window.history.replaceState(null, '', window.location.pathname);
    api.post('/auth/email/verify', { token })
      .then(() => {
        setState('done');
        // Signed in here too? Refresh the profile so the reminder banner goes.
        if (useAuthStore.getState().user) void reloadUser().catch(() => {});
      })
      .catch(() => setState('invalid'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="os-brand min-h-[100dvh] flex items-center justify-center bg-os-mist px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8"><img src={logo} alt="One Source Funding" className="h-14 w-auto" /></div>
        <div className="card p-6 sm:p-8 text-center space-y-3">
          {state === 'working' && <Loader2 className="w-6 h-6 animate-spin mx-auto text-os-navy" />}
          {state === 'done' && (
            <>
              <CheckCircle2 className="w-10 h-10 mx-auto text-os-green" />
              <h1 className="text-xl font-bold text-slate-900">Email confirmed</h1>
              <p className="text-sm text-slate-600">Thanks — you’re all set.</p>
              <Link to={user ? '/dashboard' : '/login'} className="btn-os w-full">{user ? 'Go to your dashboard' : 'Sign in'}</Link>
            </>
          )}
          {state === 'invalid' && (
            <>
              <h1 className="text-xl font-bold text-slate-900">This link has expired</h1>
              <p className="text-sm text-slate-600">
                Confirmation links work once and expire after 7 days. Sign in and use “Resend” on the banner for a new one.
              </p>
              <Link to="/login" className="btn-os w-full">Sign in</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
