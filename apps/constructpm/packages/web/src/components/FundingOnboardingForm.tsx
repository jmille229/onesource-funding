import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileCheck2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';

/**
 * "Set me up for funding" — for companies that use the software but aren't
 * One Source clients yet. Starts a conversation; no commitment. Prefilled from
 * the signed-in user. Shows a confirmation instead once an enquiry is in.
 */
export function FundingOnboardingForm({ invoiceId, onDone, showIntro = true }: {
  invoiceId?: string; onDone?: () => void; showIntro?: boolean;
}) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    contact_name: user ? `${user.first_name} ${user.last_name}`.trim() : '',
    contact_email: user?.email ?? '',
    contact_phone: '', monthly_volume: '', note: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: existing, isLoading } = useQuery({
    queryKey: ['factoring-onboarding'],
    queryFn: () => api.get('/factoring/onboarding').then((r) => r.data.data),
  });

  const submit = async () => {
    if (!form.contact_name.trim() || !form.contact_email.trim()) {
      toast.error('Name and email are required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/factoring/onboarding', {
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        contact_phone: form.contact_phone.trim() || null,
        monthly_volume: form.monthly_volume ? Number(form.monthly_volume) : null,
        note: form.note.trim() || null,
        invoice_id: invoiceId ?? null,
      });
      toast.success('Thanks — One Source will reach out shortly');
      qc.invalidateQueries({ queryKey: ['factoring-onboarding'] });
      onDone?.();
    } catch (e) {
      toast.error(apiError(e, 'Could not send the enquiry'));
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" /></div>;

  if (existing) {
    return (
      <div className="space-y-3 text-center">
        <FileCheck2 className="w-10 h-10 mx-auto text-green-600" />
        <p className="font-medium text-slate-800">Your enquiry is with us</p>
        <p className="text-sm text-slate-500">
          One Source has your details and will be in touch. No need to send another.
        </p>
        {onDone && <button className="btn-secondary w-full" onClick={onDone}>Close</button>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showIntro && <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
        <p className="text-sm text-slate-700 font-medium">Not set up for funding yet</p>
        <p className="text-sm text-slate-500 mt-0.5">
          One Source advances most of an approved invoice&rsquo;s value now, instead of you
          waiting on the agency. Tell us where to reach you and we&rsquo;ll take it from there.
        </p>
      </div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ob_name">Your name *</label>
          <input id="ob_name" className="input" value={form.contact_name}
                 onChange={(e) => set('contact_name', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ob_phone">Phone</label>
          <input id="ob_phone" className="input" type="tel" value={form.contact_phone}
                 onChange={(e) => set('contact_phone', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="ob_email">Email *</label>
        <input id="ob_email" type="email" className="input" value={form.contact_email}
               onChange={(e) => set('contact_email', e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ob_vol">Rough monthly invoicing ($)</label>
        <input id="ob_vol" type="number" min="0" step="1000" className="input" value={form.monthly_volume}
               onChange={(e) => set('monthly_volume', e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ob_note">Anything else? (optional)</label>
        <textarea id="ob_note" className="input" rows={2} value={form.note}
                  onChange={(e) => set('note', e.target.value)} />
      </div>
      <button className="btn-primary w-full" disabled={submitting} onClick={() => void submit()}>
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Talk to One Source about funding <ArrowRight className="w-4 h-4" />
      </button>
      <p className="text-xs text-slate-500 text-center">No commitment — this just starts a conversation.</p>
    </div>
  );
}
