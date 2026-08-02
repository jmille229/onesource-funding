import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HardHat, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { toast } from 'sonner';

const MIN_PASSWORD = 10; // must match the API's register schema

export function RegisterPage() {
  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    setLoading(true);
    try {
      await register({
        company_name: companyName,
        email,
        password,
        first_name: firstName,
        last_name: lastName,
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      toast.error(
        status === 409
          ? 'That email is already registered — try signing in instead.'
          : 'Could not create the account. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center">
            <HardHat className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">ConstructPM</span>
        </div>

        <div className="card p-8">
          <h1 className="text-xl font-bold text-slate-900 mb-1">Create your company</h1>
          <p className="text-sm text-slate-500 mb-6">
            Sets up your workspace and makes you its owner.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="company_name">Company name</label>
              <input
                id="company_name" className="input" value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required minLength={2} maxLength={100} autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="first_name">First name</label>
                <input
                  id="first_name" className="input" value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required maxLength={50} autoComplete="given-name"
                />
              </div>
              <div>
                <label className="label" htmlFor="last_name">Last name</label>
                <input
                  id="last_name" className="input" value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required maxLength={50} autoComplete="family-name"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="email">Work email</label>
              <input
                id="email" type="email" className="input" value={email}
                onChange={(e) => setEmail(e.target.value)}
                required maxLength={254} autoComplete="email"
              />
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password" type="password" className="input" value={password}
                onChange={(e) => setPassword(e.target.value)}
                required minLength={MIN_PASSWORD} maxLength={128}
                autoComplete="new-password"
              />
              <p className="text-xs text-slate-500 mt-1">
                At least {MIN_PASSWORD} characters.
              </p>
            </div>

            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create account
            </button>
          </form>

          <p className="text-sm text-slate-500 mt-6 text-center">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
