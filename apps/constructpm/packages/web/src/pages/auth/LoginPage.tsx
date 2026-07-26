import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { HardHat, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { toast } from 'sonner';

export function LoginPage() {
  const [email, setEmail] = useState('admin@hartwell.com');
  const [password, setPassword] = useState('demo1234');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore(s => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch {
      toast.error('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center">
            <HardHat className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">ConstructPM</span>
        </div>

        <div className="card p-8">
          <h1 className="text-xl font-bold text-slate-900 mb-1">Sign in</h1>
          <p className="text-sm text-slate-500 mb-6">Construction project management</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Sign in
            </button>
          </form>

          <div className="mt-6 p-3 bg-slate-50 rounded-md border border-slate-200">
            <p className="text-xs text-slate-600 font-medium mb-1">Demo credentials</p>
            <p className="text-xs text-slate-500">Email: admin@hartwell.com</p>
            <p className="text-xs text-slate-500">Password: demo1234</p>
          </div>
        </div>
      </div>
    </div>
  );
}
