import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileText, Loader2, RotateCcw } from 'lucide-react';
import {
  applyApi, applyError, setApplicationToken, tokenFromLocation,
  type ApplicationState, type Requirement,
} from '../../lib/apply-api';
import { formatDate } from '../../lib/api';
import { ApplyShell, Field, OS_PHONE, OS_PHONE_TEL } from './shared';
import { ApplicationWizard } from './ApplicationWizard';

/**
 * apply.os-funding.com — the funding application, for prospects who don't
 * have (and don't need) a ConstructPM account.
 *
 *   no #t= in the URL → the start form
 *   a valid #t=       → the application, step by step, until it's submitted
 *   submitted         → what happens next
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'start' }
  | { kind: 'expired'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error' }
  | { kind: 'ready'; state: ApplicationState; justStarted: boolean };

export function ApplyPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    const prev = document.title;
    document.title = 'Apply for funding · One Source Funding';
    return () => { document.title = prev; };
  }, []);

  const load = useCallback(async (justStarted = false) => {
    const token = tokenFromLocation();
    if (!token) { setApplicationToken(null); setPhase({ kind: 'start' }); return; }
    setApplicationToken(token);
    try {
      const r = await applyApi.get('/me');
      setPhase({ kind: 'ready', state: r.data.data, justStarted });
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 401) {
        setPhase({ kind: 'expired', message: applyError(e, 'This application link is no longer active.') });
      } else if (status === 503) {
        setPhase({ kind: 'unavailable', message: applyError(e, 'Online applications are unavailable right now.') });
      } else {
        setPhase({ kind: 'error' });
      }
    }
  }, []);

  useEffect(() => {
    void load();
    // Pasting a different application link into the same tab.
    const onHash = () => void load();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [load]);

  const started = (token: string) => {
    // replaceState, not location.hash: no extra history entry, no hashchange.
    window.history.replaceState(null, '', `${window.location.pathname}#t=${token}`);
    void load(true);
  };

  const startOver = () => {
    setApplicationToken(null);
    window.history.replaceState(null, '', window.location.pathname);
    setPhase({ kind: 'start' });
  };

  return (
    <ApplyShell>
      {phase.kind === 'loading' && (
        <div className="py-24 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-os-navy" /></div>
      )}
      {phase.kind === 'start' && <StartScreen onStarted={started} />}
      {phase.kind === 'expired' && (
        <Notice icon={<Clock className="w-6 h-6 text-slate-500" />} title="This link isn’t active any more">
          <p>{phase.message}</p>
          <p>If One Source sent you a newer link, use that one. Otherwise you can start a new application,
             or call us at <a className="font-medium text-os-navy hover:underline" href={`tel:${OS_PHONE_TEL}`}>{OS_PHONE}</a>.</p>
          <button className="btn-os mt-2" onClick={startOver}>Start a new application</button>
        </Notice>
      )}
      {phase.kind === 'unavailable' && (
        <Notice icon={<AlertTriangle className="w-6 h-6 text-orange-500" />} title="Applications are paused">
          <p>{phase.message}</p>
          <p>Call us at <a className="font-medium text-os-navy hover:underline" href={`tel:${OS_PHONE_TEL}`}>{OS_PHONE}</a>.</p>
        </Notice>
      )}
      {phase.kind === 'error' && (
        <Notice icon={<AlertTriangle className="w-6 h-6 text-orange-500" />} title="We couldn’t load your application">
          <p>Check your connection and try again. Nothing you saved has been lost.</p>
          <button className="btn-os mt-2" onClick={() => void load()}><RotateCcw className="w-4 h-4" /> Try again</button>
        </Notice>
      )}
      {phase.kind === 'ready' && (phase.state.editable
        ? <ApplicationWizard
            state={phase.state}
            justStarted={phase.justStarted}
            onChange={(state) => setPhase({ kind: 'ready', state, justStarted: false })}
          />
        : <SubmittedScreen state={phase.state} />)}
    </ApplyShell>
  );
}

function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-xl mx-auto card p-6 sm:p-8">
      <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mb-4">{icon}</div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <div className="mt-2 space-y-3 text-sm text-slate-600">{children}</div>
    </div>
  );
}

// ─── Start ────────────────────────────────────────────────────────────────────

function StartScreen({ onStarted }: { onStarted: (token: string) => void }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', legal_name: '' });
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<Requirement[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    applyApi.get('/requirements')
      .then((r) => setRequirements(r.data.data))
      .catch((e) => {
        if ((e as { response?: { status?: number } }).response?.status === 503) {
          setUnavailable(applyError(e, 'Online applications are unavailable right now.'));
        }
        setRequirements([]);
      });
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await applyApi.post('/start', {
        ...form, phone: form.phone.trim() || null, ...(trap ? { company_website: trap } : {}),
      });
      onStarted(r.data.data.token as string);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setError(status === 429
        ? 'Too many applications have been started from this connection. Please try again later or call us.'
        : applyError(err, 'We couldn’t start your application. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const docs = (requirements ?? []).filter((r) => r.required);

  return (
    <div className="grid lg:grid-cols-[1fr_minmax(0,28rem)] gap-8 lg:gap-12 items-start">
      <section className="lg:pt-4">
        <p className="text-sm font-semibold text-os-green uppercase tracking-wide">Funding application</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-os-navy mt-2 leading-tight">
          Get paid on approved government invoices — without the wait.
        </h1>
        <p className="text-slate-600 mt-4 max-w-xl">
          Apply in about 15 minutes. Save as you go and come back any time with your private link.
          We review every application within one business day.
        </p>

        <div className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">What you’ll need</h2>
          <p className="text-sm text-slate-500 mt-0.5">Photos from your phone are fine.</p>
          {requirements === null ? (
            <div className="mt-4 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-5 w-2/3 rounded bg-slate-200 animate-pulse" />)}</div>
          ) : (
            <ul className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {docs.map((r) => (
                <li key={r.key} className="flex items-start gap-2 text-sm text-slate-700">
                  <FileText className="w-4 h-4 text-os-green flex-shrink-0 mt-0.5" aria-hidden />
                  {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card p-5 sm:p-7">
        {unavailable ? (
          <div className="text-sm text-slate-600 space-y-2">
            <p className="font-semibold text-slate-900">Applications are paused</p>
            <p>{unavailable}</p>
            <p>Call <a className="font-medium text-os-navy hover:underline" href={`tel:${OS_PHONE_TEL}`}>{OS_PHONE}</a>.</p>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Start your application</h2>
              <p className="text-sm text-slate-500 mt-0.5">No account needed.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" htmlFor="a_first">
                <input id="a_first" className="input" value={form.first_name} onChange={set('first_name')}
                       required autoComplete="given-name" maxLength={80} />
              </Field>
              <Field label="Last name" htmlFor="a_last">
                <input id="a_last" className="input" value={form.last_name} onChange={set('last_name')}
                       required autoComplete="family-name" maxLength={80} />
              </Field>
            </div>
            <Field label="Work email" htmlFor="a_email">
              <input id="a_email" type="email" className="input" value={form.email} onChange={set('email')}
                     required autoComplete="email" maxLength={254} />
            </Field>
            <Field label="Phone" htmlFor="a_phone" optional>
              <input id="a_phone" type="tel" className="input" value={form.phone} onChange={set('phone')}
                     autoComplete="tel" maxLength={30} />
            </Field>
            <Field label="Legal business name" htmlFor="a_legal" hint="As it appears on your Articles of Incorporation.">
              <input id="a_legal" className="input" value={form.legal_name} onChange={set('legal_name')}
                     required minLength={2} maxLength={200} autoComplete="organization" />
            </Field>

            {/* Honeypot: invisible to people and to screen readers; bots fill it. */}
            <div aria-hidden="true" className="absolute -left-[10000px] w-px h-px overflow-hidden">
              <label htmlFor="a_site">Company website</label>
              <input id="a_site" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
            </div>

            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">{error}</p>}

            <button className="btn-os w-full py-2.5" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Start application
            </button>
            <p className="text-xs text-slate-500">
              We’ll only use your details to review your application and contact you about it.
            </p>
          </form>
        )}
      </section>
    </div>
  );
}

// ─── After submission ─────────────────────────────────────────────────────────

function SubmittedScreen({ state }: { state: ApplicationState }) {
  const a = state.application;
  const approved = a.status === 'approved';
  const closed = a.status === 'declined' || a.status === 'withdrawn';

  if (closed) {
    return (
      <Notice icon={<Clock className="w-6 h-6 text-slate-500" />} title="This application is closed">
        <p>If you think that’s a mistake, call us at{' '}
          <a className="font-medium text-os-navy hover:underline" href={`tel:${OS_PHONE_TEL}`}>{OS_PHONE}</a>.</p>
      </Notice>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="card p-6 sm:p-8">
        <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-7 h-7 text-os-green" />
        </div>
        <h1 className="text-2xl font-bold text-os-navy">
          {approved ? 'You’re approved' : 'Application received'}
        </h1>
        <p className="text-slate-600 mt-2">
          {approved
            ? <>Welcome to One Source Funding, {a.contact_first_name}. Check your email for the link to set
                your password and sign in.</>
            : <>Thanks, {a.contact_first_name}. We’re reviewing the application for <strong>{a.legal_name}</strong> and
                will be in touch within one business day — usually sooner.</>}
        </p>
        {a.submitted_at && (
          <p className="text-xs text-slate-500 mt-4">
            Submitted {formatDate(a.submitted_at)}{a.signature_name ? ` · signed by ${a.signature_name}` : ''}
          </p>
        )}
      </div>

      {!approved && (
        <div className="card p-6 sm:p-8">
          <h2 className="text-base font-semibold text-slate-900">What happens next</h2>
          <ol className="mt-4 space-y-4">
            {[
              ['We review your application', 'We check your documents and may call with a question or two.'],
              ['You sign your agreement', 'We send the funding agreement to sign electronically.'],
              ['Your account is set up', 'You’ll get a link to set your password. From then on you submit approved invoices and see every advance in one place.'],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="w-7 h-7 rounded-full bg-os-navy text-white text-sm font-semibold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{title}</p>
                  <p className="text-sm text-slate-600">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-sm text-slate-600 mt-6">
            Need to change something? Call us at{' '}
            <a className="font-medium text-os-navy hover:underline" href={`tel:${OS_PHONE_TEL}`}>{OS_PHONE}</a>.
          </p>
        </div>
      )}
    </div>
  );
}

