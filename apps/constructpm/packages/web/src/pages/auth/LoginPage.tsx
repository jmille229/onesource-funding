import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { LedgerMark } from '../../components/brand/LedgerMark';
import { useAuthStore, type SignInResult } from '../../stores/auth.store';
import { api } from '../../lib/api';
import { SecondStep } from '../../components/SecondStep';
import { toast } from 'sonner';

const postData = (path: string, body: object) => api.post(path, body).then((r) => r.data.data);

export function LoginPage() {
  // Start empty. These fields used to be pre-filled with seed-data credentials,
  // which don't exist in a real deployment — the form looked broken before you
  // typed anything, and advertising credentials in the UI is a bad habit.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Extract<SignInResult, { done: false }> | null>(null);
  const login = useAuthStore(s => s.login);
  const finishSignIn = useAuthStore(s => s.finishSignIn);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await login(email, password);
      if (r.done) navigate(from, { replace: true });
      else setStep(r);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      toast.error(status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <LedgerMark tone="dark" size="lg" />
        </div>

        <div className="card p-8">
          {step ? (
            <>
              <h1 className="text-xl font-bold text-slate-900 mb-4">
                {step.mode === 'verify' ? 'Two-step sign-in' : 'Set up two-step sign-in'}
              </h1>
              <SecondStep mode={step.mode} challenge={step.challenge} post={postData}
                          onCancel={() => { setStep(null); setPassword(''); }}
                          onDone={(d) => void finishSignIn(d).then(() => navigate(from, { replace: true }))} />
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-slate-900 mb-1">Sign in</h1>
              <p className="text-sm text-slate-500 mb-6">Track your invoices and funding</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label" htmlFor="email">Email</label>
                  <input id="email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)}
                         required autoFocus autoComplete="username" />
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <label className="label" htmlFor="password">Password</label>
                    <Link to="/forgot-password" className="text-xs text-brand-600 hover:underline">Forgot password?</Link>
                  </div>
                  <input id="password" type="password" className="input" value={password} onChange={e => setPassword(e.target.value)}
                         required autoComplete="current-password" />
                </div>
                <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Sign in
                </button>
              </form>

              <p className="text-sm text-slate-500 mt-6 text-center">
                New here?{' '}
                <Link to="/register" className="text-brand-600 font-medium hover:underline">
                  Create your company
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
