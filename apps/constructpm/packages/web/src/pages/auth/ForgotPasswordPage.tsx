import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { api, apiError } from '../../lib/api';
import { LedgerMark } from '../../components/brand/LedgerMark';

/**
 * Ask for a password-reset link. The answer is the same whether or not the
 * address has an account, so this page can't be used to find out who does.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/forgot', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(apiError(err, 'Something went wrong. Please try again.'));
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
          {sent ? (
            <div className="space-y-3 text-center">
              <MailCheck className="w-10 h-10 mx-auto text-os-green" />
              <h1 className="text-xl font-bold text-slate-900">Check your email</h1>
              <p className="text-sm text-slate-600">
                If <strong>{email}</strong> has an account, a link to reset the password is on its way. It works once,
                for an hour. Nothing arrived? Check spam, or ask whoever manages your account.
              </p>
              <Link to="/login" className="btn-os w-full">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Reset your password</h1>
                <p className="text-sm text-slate-500 mt-1">We’ll email you a link to choose a new one.</p>
              </div>
              <div>
                <label className="label" htmlFor="fp_email">Email</label>
                <input id="fp_email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)}
                       required autoFocus autoComplete="username" />
              </div>
              {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
              <button className="btn-os w-full" disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send the link
              </button>
              <p className="text-sm text-center"><Link to="/login" className="text-os-navy hover:underline">Back to sign in</Link></p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
