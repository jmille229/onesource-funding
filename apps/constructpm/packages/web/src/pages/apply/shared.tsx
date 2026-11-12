import { useState } from 'react';
import { Check, Copy, Lock, Phone } from 'lucide-react';
import { toast } from 'sonner';
import logo from '../../assets/onesource-logo.png';

export const OS_PHONE = '(215) 436-9121';
export const OS_PHONE_TEL = '+12154369121';
export const OS_EMAIL = 'info@os-funding.com';
export const OS_SITE = 'https://os-funding.com';

/** Header, footer and page frame for apply.os-funding.com. */
export function ApplyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="os-brand min-h-[100dvh] flex flex-col bg-os-mist">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <a href={OS_SITE} className="flex items-center flex-shrink-0" aria-label="One Source Funding home">
            <img src={logo} alt="One Source Funding" className="h-10 w-auto" width={69} height={40} />
          </a>
          <a href={`tel:${OS_PHONE_TEL}`}
             className="inline-flex items-center gap-2 text-sm font-medium text-os-navy hover:underline">
            <Phone className="w-4 h-4" aria-hidden />
            <span className="hidden sm:inline">Questions? </span>{OS_PHONE}
          </a>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between text-xs text-slate-500">
          <p className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" aria-hidden />
            Secure application. Tax ID and Social Security numbers are encrypted when you save them.
          </p>
          <p>
            © {new Date().getFullYear()} One Source Funding ·{' '}
            <a href={`mailto:${OS_EMAIL}`} className="hover:underline">{OS_EMAIL}</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Label + control + optional hint, consistently spaced. */
export function Field({ label, htmlFor, hint, optional, children, className = '' }: {
  label: string; htmlFor?: string; hint?: string; optional?: boolean;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

/**
 * The private resume link, with a copy button. Email may not be set up on
 * every deployment, so the page itself always gives the applicant their way
 * back in.
 */
export function ResumeLinkBox({ link, emphasis }: { link: string; emphasis?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Couldn’t copy — select the link and copy it instead');
    }
  };
  return (
    <div className={`rounded-lg border p-4 ${emphasis ? 'border-os-green/40 bg-green-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-sm font-semibold text-slate-900">Your private link to this application</p>
      <p className="text-sm text-slate-600 mt-0.5">
        Bookmark or copy it — it’s how you get back in to finish. Anyone with the link can see your
        application, so don’t share it.
      </p>
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <input readOnly value={link} aria-label="Private application link"
               className="input font-mono text-xs flex-1 min-w-0" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={() => void copy()} className="btn-secondary flex-shrink-0">
          {copied ? <Check className="w-4 h-4 text-os-green" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}

export const ENTITY_TYPES: [string, string][] = [
  ['llc', 'LLC'],
  ['corporation', 'Corporation (C corp)'],
  ['s_corporation', 'S corporation'],
  ['partnership', 'Partnership'],
  ['sole_proprietorship', 'Sole proprietorship'],
  ['other', 'Other'],
];

export const US_STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

export function StateSelect({ id, value, onChange, required }: {
  id: string; value: string; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <select id={id} className="input" value={value} required={required}
            onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>
      {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  );
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
