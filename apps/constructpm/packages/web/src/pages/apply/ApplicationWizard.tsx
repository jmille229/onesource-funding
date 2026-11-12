import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { APPLICATION_CONSENT_TEXT } from '@constructpm/shared';
import {
  applyApi, applyError, getApplicationToken, resumeLinkFor,
  type Application, type ApplicationState,
} from '../../lib/apply-api';
import { ENTITY_TYPES, Field, ResumeLinkBox, StateSelect, US_STATES } from './shared';
import { DocumentsStep } from './DocumentsStep';

type StepId = 'business' | 'work' | 'ownership' | 'documents' | 'review';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'business', label: 'Business' },
  { id: 'work', label: 'Government work' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'documents', label: 'Documents' },
  { id: 'review', label: 'Review & sign' },
];

type Kind = 'text' | 'required' | 'state' | 'money' | 'number' | 'int' | 'bool';

/** Which fields each form step saves, and how to turn the input back into API values. */
const STEP_FIELDS: Record<'business' | 'work' | 'ownership', [keyof Application, Kind][]> = {
  business: [
    ['contact_first_name', 'required'], ['contact_last_name', 'required'], ['contact_email', 'required'],
    ['contact_phone', 'text'], ['legal_name', 'required'], ['dba', 'text'], ['entity_type', 'text'],
    ['state_of_formation', 'state'], ['years_in_business', 'number'],
    ['address_line1', 'text'], ['city', 'text'], ['state_code', 'state'], ['zip', 'text'],
  ],
  work: [
    ['agencies', 'text'], ['monthly_volume', 'money'], ['typical_invoice', 'money'],
    ['typical_days_to_pay', 'int'], ['has_existing_lender', 'bool'], ['existing_lender', 'text'],
    ['how_heard', 'text'],
  ],
  ownership: [
    ['owner_name', 'text'], ['owner_title', 'text'], ['owner_ownership_pct', 'number'],
    ['signer_name', 'text'], ['signer_title', 'text'],
  ],
};

const FIELD_STEP: Record<string, StepId> = Object.fromEntries(
  (Object.entries(STEP_FIELDS) as [StepId, [string, Kind][]][])
    .flatMap(([step, fields]) => fields.map(([k]) => [k, step])));

type Form = Record<string, string>;

function toForm(a: Application): Form {
  const f: Form = {};
  for (const fields of Object.values(STEP_FIELDS)) {
    for (const [k, kind] of fields) {
      const v = a[k];
      if (v === null || v === undefined) f[k] = '';
      else if (kind === 'bool') f[k] = v ? 'yes' : 'no';
      else if (kind === 'money') f[k] = Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
      else if (kind === 'number' || kind === 'int') f[k] = String(Number(v));
      else f[k] = String(v);
    }
  }
  return f;
}

/** Changed fields for a step, as API values. Throws a readable message on a bad number. */
function payloadFor(step: keyof typeof STEP_FIELDS, form: Form, initial: Form): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, kind] of STEP_FIELDS[step]) {
    const raw = (form[k] ?? '').trim();
    if (raw === (initial[k] ?? '').trim()) continue;
    if (kind === 'required') { out[k] = raw; continue; }
    if (raw === '') { out[k] = null; continue; }
    if (kind === 'bool') { out[k] = raw === 'yes'; continue; }
    if (kind === 'money' || kind === 'number' || kind === 'int') {
      const n = Number(raw.replace(/[$,%\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) throw new Error(`Enter a number for ${LABELS[k] ?? k}`);
      out[k] = kind === 'int' ? Math.round(n) : n;
      continue;
    }
    out[k] = kind === 'state' ? raw.toUpperCase() : raw;
  }
  return out;
}

const LABELS: Record<string, string> = {
  years_in_business: 'years in business', monthly_volume: 'monthly invoicing',
  typical_invoice: 'typical invoice', typical_days_to_pay: 'days to pay', owner_ownership_pct: 'ownership',
};

export function ApplicationWizard({ state, justStarted, onChange }: {
  state: ApplicationState; justStarted: boolean; onChange: (s: ApplicationState) => void;
}) {
  const a = state.application;
  const reopened = a.status === 'docs_requested';
  const [step, setStep] = useState<StepId>(reopened ? 'documents' : 'business');
  const [initial, setInitial] = useState<Form>(() => toForm(a));
  const [form, setForm] = useState<Form>(() => toForm(a));
  const [signerIsOwner, setSignerIsOwner] = useState(
    () => !a.signer_name || (a.signer_name === a.owner_name && (a.signer_title ?? '') === (a.owner_title ?? '')));
  const [saving, setSaving] = useState(false);
  const [showLink, setShowLink] = useState(justStarted);
  const topRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const link = resumeLinkFor(getApplicationToken() ?? '');
  const index = STEPS.findIndex((s) => s.id === step);

  // Scroll to the top of the card on every step change, so a phone user isn't
  // left at the bottom of the next step.
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [step]);

  const apply = (s: ApplicationState) => {
    const f = toForm(s.application);
    setInitial(f);
    setForm(f);
    onChange(s);
  };

  /** Save the fields on the current step. Returns false (and says why) if it couldn't. */
  const save = async (): Promise<boolean> => {
    if (step !== 'business' && step !== 'work' && step !== 'ownership') return true;
    let merged = form;
    if (step === 'ownership' && signerIsOwner) {
      merged = { ...form, signer_name: form['owner_name'] ?? '', signer_title: form['owner_title'] ?? '' };
    }
    if (step === 'work' && merged['has_existing_lender'] !== 'yes') merged = { ...merged, existing_lender: '' };
    let body: Record<string, unknown>;
    try {
      body = payloadFor(step, merged, initial);
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
    if (!Object.keys(body).length) return true;
    setSaving(true);
    try {
      const r = await applyApi.patch('/me', body);
      apply(r.data.data);
      return true;
    } catch (e) {
      toast.error(applyError(e, 'We couldn’t save that. Please try again.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const go = async (to: StepId) => {
    if (to === step) return;
    if (await save()) setStep(to);
  };

  const next = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = STEPS[index + 1];
    if (n) await go(n.id);
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const val = (k: string) => form[k] ?? '';

  // A step is "done" when nothing it owns is on the missing list.
  const stepDone = useMemo(() => {
    const missingSteps = new Set<StepId>(state.missing.fields.map((m) => FIELD_STEP[m.key] ?? 'business'));
    if (state.missing.items.length) missingSteps.add('documents');
    return (id: StepId) => id !== 'review' && !missingSteps.has(id);
  }, [state.missing]);

  const requestedLabels = (a.requested_items ?? [])
    .map((k) => state.requirements.find((r) => r.key === k)?.label).filter(Boolean) as string[];

  return (
    <div ref={topRef} className="max-w-3xl mx-auto scroll-mt-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-os-navy">{a.legal_name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">Funding application · saved automatically as you continue</p>
        </div>
        <button type="button" className="btn-ghost btn-sm self-start sm:self-auto"
                onClick={() => setShowLink((v) => !v)} aria-expanded={showLink}>
          <Link2 className="w-4 h-4" /> {showLink ? 'Hide' : 'Save and finish later'}
        </button>
      </div>

      {showLink && <div className="mb-5"><ResumeLinkBox link={link} emphasis={justStarted} /></div>}

      {reopened && (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 flex gap-3" role="status">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm text-amber-900 space-y-1">
            <p className="font-semibold">One Source needs a little more before we can finish reviewing</p>
            {a.request_message && <p className="whitespace-pre-line">{a.request_message}</p>}
            {requestedLabels.length > 0 && <p>Requested: {requestedLabels.join(', ')}.</p>}
            <p>Add it below, then send it back to us from <strong>Review &amp; sign</strong>.</p>
          </div>
        </div>
      )}

      {/* Steps. A horizontal row that scrolls on a phone rather than wrapping. */}
      <nav aria-label="Application steps" className="mb-5 -mx-4 px-4 overflow-x-auto">
        <ol className="flex gap-1.5 min-w-max">
          {STEPS.map((s, i) => {
            const current = s.id === step;
            const done = stepDone(s.id);
            return (
              <li key={s.id}>
                <button type="button" onClick={() => void go(s.id)} disabled={saving}
                  aria-current={current ? 'step' : undefined}
                  className={`flex items-center gap-2 rounded-full pl-1.5 pr-3.5 py-1.5 text-sm font-medium transition-colors border ${
                    current ? 'bg-os-navy text-white border-os-navy'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                    current ? 'bg-white/15' : done ? 'bg-green-50 text-os-green' : 'bg-slate-100 text-slate-500'}`}>
                    {done && !current ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="card p-5 sm:p-7">
        {(step === 'business' || step === 'work' || step === 'ownership') && (
          <form ref={formRef} onSubmit={(e) => void next(e)} className="space-y-5">
            {step === 'business' && (
              <>
                <StepTitle title="About your business" sub="We use this to confirm the business with the state and check public records." />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Your first name" htmlFor="f_first">
                    <input id="f_first" className="input" value={val('contact_first_name')} onChange={set('contact_first_name')} required autoComplete="given-name" />
                  </Field>
                  <Field label="Your last name" htmlFor="f_last">
                    <input id="f_last" className="input" value={val('contact_last_name')} onChange={set('contact_last_name')} required autoComplete="family-name" />
                  </Field>
                  <Field label="Email" htmlFor="f_email">
                    <input id="f_email" type="email" className="input" value={val('contact_email')} onChange={set('contact_email')} required autoComplete="email" />
                  </Field>
                  <Field label="Phone" htmlFor="f_phone">
                    <input id="f_phone" type="tel" className="input" value={val('contact_phone')} onChange={set('contact_phone')} required autoComplete="tel" />
                  </Field>
                </div>
                <hr className="divider" />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Legal business name" htmlFor="f_legal" className="sm:col-span-2">
                    <input id="f_legal" className="input" value={val('legal_name')} onChange={set('legal_name')} required minLength={2} autoComplete="organization" />
                  </Field>
                  <Field label="Doing business as (DBA)" htmlFor="f_dba" optional>
                    <input id="f_dba" className="input" value={val('dba')} onChange={set('dba')} />
                  </Field>
                  <Field label="Type of business" htmlFor="f_entity">
                    <select id="f_entity" className="input" value={val('entity_type')} onChange={set('entity_type')} required>
                      <option value="">Select…</option>
                      {ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="State where it was formed" htmlFor="f_formed" optional>
                    <StateSelect id="f_formed" value={val('state_of_formation')}
                                 onChange={(v) => setForm((f) => ({ ...f, state_of_formation: v }))} />
                  </Field>
                  <Field label="Years in business" htmlFor="f_years" optional>
                    <input id="f_years" className="input" inputMode="decimal" value={val('years_in_business')} onChange={set('years_in_business')} placeholder="e.g. 4" />
                  </Field>
                  <Field label="Business address" htmlFor="f_addr" className="sm:col-span-2">
                    <input id="f_addr" className="input" value={val('address_line1')} onChange={set('address_line1')} required autoComplete="address-line1" />
                  </Field>
                  <Field label="City" htmlFor="f_city">
                    <input id="f_city" className="input" value={val('city')} onChange={set('city')} required autoComplete="address-level2" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="State" htmlFor="f_state">
                      <select id="f_state" className="input" value={val('state_code')} onChange={set('state_code')} required autoComplete="address-level1">
                        <option value="">—</option>
                        {US_STATES.map(([c]) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="ZIP" htmlFor="f_zip">
                      <input id="f_zip" className="input" inputMode="numeric" value={val('zip')} onChange={set('zip')} required pattern="\d{5}(-\d{4})?" title="5-digit ZIP code" autoComplete="postal-code" />
                    </Field>
                  </div>
                </div>
              </>
            )}

            {step === 'work' && (
              <>
                <StepTitle title="Your government work" sub="Rough numbers are fine — this helps us size your funding line." />
                <Field label="Which agencies or prime contractors do you invoice?" htmlFor="f_agencies"
                       hint="List each one, e.g. “Army Corps of Engineers – Philadelphia District”, “PennDOT District 6”.">
                  <textarea id="f_agencies" className="input" rows={3} value={val('agencies')} onChange={set('agencies')} required maxLength={2000} />
                </Field>
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="Invoiced per month" htmlFor="f_volume" optional>
                    <MoneyInput id="f_volume" value={val('monthly_volume')} onChange={set('monthly_volume')} />
                  </Field>
                  <Field label="Typical invoice" htmlFor="f_typical" optional>
                    <MoneyInput id="f_typical" value={val('typical_invoice')} onChange={set('typical_invoice')} />
                  </Field>
                  <Field label="Days the agency takes to pay" htmlFor="f_days" optional>
                    <input id="f_days" className="input" inputMode="numeric" value={val('typical_days_to_pay')} onChange={set('typical_days_to_pay')} placeholder="e.g. 45" />
                  </Field>
                </div>
                <fieldset>
                  <legend className="label">Do you have a lender or factor with a lien on your receivables today?</legend>
                  <div className="flex gap-2 mt-1">
                    {[['no', 'No'], ['yes', 'Yes']].map(([v, l]) => (
                      <label key={v} className={`flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm cursor-pointer ${
                        val('has_existing_lender') === v ? 'border-os-navy bg-os-mist font-medium' : 'border-slate-300 bg-white'}`}>
                        <input type="radio" name="has_existing_lender" value={v} checked={val('has_existing_lender') === v}
                               onChange={set('has_existing_lender')} className="accent-os-navy" />
                        {l}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {val('has_existing_lender') === 'yes' && (
                  <Field label="Who is it?" htmlFor="f_lender" hint="Having one doesn’t rule you out — we often pay off an existing factor.">
                    <input id="f_lender" className="input" value={val('existing_lender')} onChange={set('existing_lender')} />
                  </Field>
                )}
                <Field label="How did you hear about us?" htmlFor="f_heard" optional>
                  <input id="f_heard" className="input" value={val('how_heard')} onChange={set('how_heard')} />
                </Field>
              </>
            )}

            {step === 'ownership' && (
              <>
                <StepTitle title="Ownership" sub="The majority owner, and who will sign the funding agreement." />
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="Owner’s full name" htmlFor="f_owner" className="sm:col-span-2">
                    <input id="f_owner" className="input" value={val('owner_name')} onChange={set('owner_name')} required autoComplete="name" />
                  </Field>
                  <Field label="Ownership %" htmlFor="f_pct" optional>
                    <input id="f_pct" className="input" inputMode="decimal" value={val('owner_ownership_pct')} onChange={set('owner_ownership_pct')} placeholder="e.g. 100" />
                  </Field>
                  <Field label="Owner’s title" htmlFor="f_otitle" optional className="sm:col-span-2">
                    <input id="f_otitle" className="input" value={val('owner_title')} onChange={set('owner_title')} placeholder="e.g. President" />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="w-4 h-4 accent-os-navy" checked={signerIsOwner}
                         onChange={(e) => setSignerIsOwner(e.target.checked)} />
                  The owner will sign the agreement
                </label>
                {!signerIsOwner && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Authorized signer’s full name" htmlFor="f_signer">
                      <input id="f_signer" className="input" value={val('signer_name')} onChange={set('signer_name')} required />
                    </Field>
                    <Field label="Signer’s title" htmlFor="f_stitle" optional>
                      <input id="f_stitle" className="input" value={val('signer_title')} onChange={set('signer_title')} />
                    </Field>
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  You’ll add the owner’s Social Security number and the signer’s driver’s license on the next step.
                </p>
              </>
            )}

            <StepNav index={index} saving={saving} onBack={() => void go(STEPS[index - 1]!.id)} />
          </form>
        )}

        {step === 'documents' && (
          <>
            <StepTitle title="Documents" sub="Upload a PDF or a clear photo of each. You can add more than one file per item." />
            <DocumentsStep state={state} onChange={apply} highlight={new Set(a.requested_items ?? [])} />
            <StepNav index={index} saving={saving} onBack={() => void go('ownership')}
                     onNext={() => void go('review')} />
          </>
        )}

        {step === 'review' && (
          <ReviewStep state={state} onChange={apply} goTo={(s) => void go(s)} onBack={() => void go('documents')} />
        )}
      </div>
    </div>
  );
}

function StepTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-1">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function MoneyInput(props: { id: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement> }) {
  return (
    <div className="relative">
      <span className="absolute inset-y-0 left-3 flex items-center text-sm text-slate-400 pointer-events-none">$</span>
      <input {...props} className="input pl-7" inputMode="decimal" />
    </div>
  );
}

function StepNav({ index, saving, onBack, onNext }: {
  index: number; saving: boolean; onBack: () => void; onNext?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-5 mt-2 border-t border-slate-100">
      {index > 0
        ? <button type="button" className="btn-ghost" onClick={onBack} disabled={saving}><ChevronLeft className="w-4 h-4" /> Back</button>
        : <span />}
      <button type={onNext ? 'button' : 'submit'} onClick={onNext} className="btn-os" disabled={saving}>
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        Continue <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Review & sign ────────────────────────────────────────────────────────────

function ReviewStep({ state, onChange, goTo, onBack }: {
  state: ApplicationState; onChange: (s: ApplicationState) => void;
  goTo: (s: StepId) => void; onBack: () => void;
}) {
  const a = state.application;
  const [signature, setSignature] = useState(a.signature_name ?? '');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const missing = [
    ...state.missing.fields.map((m) => ({ ...m, step: FIELD_STEP[m.key] ?? 'business' as StepId })),
    ...state.missing.items.map((m) => ({ ...m, step: 'documents' as StepId })),
  ];
  const resubmit = a.status === 'docs_requested';
  const entity = ENTITY_TYPES.find(([v]) => v === a.entity_type)?.[1];
  const money = (v: unknown) => (v === null || v === undefined || v === '' ? null
    : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await applyApi.post('/me/submit', { signature_name: signature.trim(), consent: true });
      onChange(r.data.data);
      window.scrollTo({ top: 0 });
    } catch (err) {
      toast.error(applyError(err, 'We couldn’t submit your application. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-6">
      <StepTitle title="Review & sign" sub="Check everything over, then sign to send it to One Source." />

      {missing.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Still needed before you can submit</p>
          <ul className="mt-2 space-y-1">
            {missing.map((m) => (
              <li key={m.key} className="text-sm text-amber-900 flex items-center justify-between gap-3">
                <span>{m.label}</span>
                <button type="button" className="text-os-navy font-medium hover:underline text-sm flex-shrink-0"
                        onClick={() => goTo(m.step)}>Add</button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900 flex items-center gap-2">
          <Check className="w-4 h-4 text-os-green" /> Everything we need is here.
        </div>
      )}

      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <Summary label="Business" onEdit={() => goTo('business')}
          lines={[a.legal_name, a.dba && `DBA ${a.dba}`, entity, [a.address_line1, a.city, [a.state_code, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')]} />
        <Summary label="Contact" onEdit={() => goTo('business')}
          lines={[`${a.contact_first_name} ${a.contact_last_name}`, a.contact_email, a.contact_phone]} />
        <Summary label="Government work" onEdit={() => goTo('work')}
          lines={[a.agencies, money(a.monthly_volume) && `${money(a.monthly_volume)} a month`,
                  a.has_existing_lender ? `Current lender: ${a.existing_lender || 'yes'}` : a.has_existing_lender === false ? 'No current lender' : null]} />
        <Summary label="Ownership" onEdit={() => goTo('ownership')}
          lines={[a.owner_name && `${a.owner_name}${a.owner_title ? `, ${a.owner_title}` : ''}${a.owner_ownership_pct ? ` (${Number(a.owner_ownership_pct)}%)` : ''}`,
                  a.signer_name && a.signer_name !== a.owner_name ? `Signer: ${a.signer_name}${a.signer_title ? `, ${a.signer_title}` : ''}` : null]} />
      </dl>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900 mb-1.5">Authorization</p>
        <p className="text-sm text-slate-600 leading-relaxed">{APPLICATION_CONSENT_TEXT}</p>
      </div>

      <div className="space-y-4">
        <label className="flex items-start gap-2.5 text-sm text-slate-800">
          <input type="checkbox" className="w-4 h-4 mt-0.5 accent-os-navy flex-shrink-0" checked={agree}
                 onChange={(e) => setAgree(e.target.checked)} required />
          I have read and agree to the authorization above.
        </label>
        <Field label="Type your full name to sign" htmlFor="f_sig"
               hint={`Signing for ${a.legal_name}. This is your electronic signature.`}>
          <input id="f_sig" className="input font-medium" value={signature} required minLength={2} maxLength={160}
                 onChange={(e) => setSignature(e.target.value)} autoComplete="name" />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3 pt-5 border-t border-slate-100">
        <button type="button" className="btn-ghost" onClick={onBack}><ChevronLeft className="w-4 h-4" /> Back</button>
        <button className="btn-os px-5" disabled={busy || missing.length > 0 || !agree || signature.trim().length < 2}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {resubmit ? 'Send to One Source' : 'Sign and submit'}
        </button>
      </div>
    </form>
  );
}

function Summary({ label, lines, onEdit }: { label: string; lines: (string | null | undefined | false)[]; onEdit: () => void }) {
  const shown = lines.filter(Boolean) as string[];
  return (
    <div>
      <dt className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <button type="button" onClick={onEdit} className="text-xs font-medium text-os-navy hover:underline">Edit</button>
      </dt>
      <dd className="mt-1 text-slate-800 space-y-0.5">
        {shown.length ? shown.map((l, i) => <p key={i} className="break-words">{l}</p>) : <p className="text-slate-400">Not filled in</p>}
      </dd>
    </div>
  );
}
