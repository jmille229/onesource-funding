import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { adminApi } from '../../lib/admin-api';
import { formatCurrency, todayISO } from '../../lib/api';
import { advancesQuery, distinct } from './AdvancesTable';

interface FundClient {
  company_id: string; company_name: string;
  /** The client's default schedule's advance rate, e.g. "80.0000"; null with no schedule. */
  advance_rate_pct: string | null;
  /** The client's owner login, the default Name on a first advance. */
  owner_name: string | null;
}

const money = (v: string) => Number(v.replace(/[$,\s]/g, ''));
const round2 = (n: number) => Math.round(n * 100) / 100;
/** 80 → "80%", 79.99 → "79.99%". */
const pctText = (n: number) => `${Math.round(n * 100) / 100}%`;

/**
 * Fund an invoice by hand, with the Advance Book's columns in its order:
 * Borrower, Name, Creditor, Sales person, Project, Adv date, Invoice #,
 * Total invoice, Total advanced.
 *
 * Choosing a borrower fills in Name and Sales person from its last advance
 * (Name from its owner login on a first advance) without overwriting what's
 * been typed. Total advanced follows the client's advance rate until it's
 * changed; whatever it says is what's recorded, and the reserve is the rest.
 */
export function FundForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    company_id: '', contact_name: '', debtor_id: '', sales_person: '', project: '',
    advanced_on: todayISO(), invoice_number: '', face_amount: '', invoice_due_on: '',
  });
  const [advance, setAdvance] = useState<string | null>(null);   // null: follow the client's rate
  // What choosing a borrower last filled in, so a later choice replaces it but never what was typed.
  const filled = useRef({ contact_name: '', sales_person: '' });

  const { data: clients } = useQuery<FundClient[]>({
    queryKey: ['admin-clients'], queryFn: () => adminApi.get('/clients').then((r) => r.data.data),
  });
  const { data: debtors } = useQuery<{ id: string; legal_name: string }[]>({
    queryKey: ['admin-debtors'], queryFn: () => adminApi.get('/debtors').then((r) => r.data.data),
  });
  const { data: book } = useQuery(advancesQuery());

  const client = clients?.find((c) => c.company_id === form.company_id);
  const theirs = useMemo(() => (book ?? [])
    .filter((r) => r.company_id === form.company_id)
    .sort((a, b) => (b.advanced_on ?? '').localeCompare(a.advanced_on ?? '')), [book, form.company_id]);
  const salesPeople = useMemo(() => distinct((book ?? []).map((r) => r.sales_person)), [book]);
  const names = useMemo(() => distinct([...theirs.map((r) => r.contact_name), client?.owner_name]), [theirs, client]);
  const projects = useMemo(() => distinct(theirs.map((r) => r.project)), [theirs]);

  const face = money(form.face_amount);
  const rate = client?.advance_rate_pct ? Number(client.advance_rate_pct) : null;
  const byRate = face > 0 && rate !== null ? Math.round(face * rate) / 100 : null;
  const advanced = advance === null ? byRate : money(advance);
  const tooMuch = advanced !== null && face > 0 && advanced > face + 0.005;
  const effective = advanced !== null && face > 0 ? (advanced / face) * 100 : null;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const chooseBorrower = (companyId: string) => {
    const mine = (book ?? []).filter((r) => r.company_id === companyId)
      .sort((a, b) => (b.advanced_on ?? '').localeCompare(a.advanced_on ?? ''));
    const owner = clients?.find((c) => c.company_id === companyId)?.owner_name ?? '';
    const next = {
      contact_name: mine.find((r) => r.contact_name)?.contact_name ?? owner,
      sales_person: mine.find((r) => r.sales_person)?.sales_person ?? '',
    };
    setForm((f) => ({
      ...f, company_id: companyId,
      contact_name: !f.contact_name || f.contact_name === filled.current.contact_name ? next.contact_name : f.contact_name,
      sales_person: !f.sales_person || f.sales_person === filled.current.sales_person ? next.sales_person : f.sales_person,
    }));
    filled.current = next;
  };

  const fund = useMutation({
    mutationFn: () => adminApi.post('/invoices', {
      company_id: form.company_id,
      debtor_id: form.debtor_id,
      contact_name: form.contact_name.trim() || null,
      sales_person: form.sales_person.trim() || null,
      project: form.project.trim() || null,
      advanced_on: form.advanced_on,
      invoice_number: form.invoice_number.trim() || null,
      face_amount: face,
      // Only when changed: otherwise the server applies the client's rate itself.
      advance_amount: advance === null ? null : round2(money(advance)),
      invoice_due_on: form.invoice_due_on || null,
    }),
    onSuccess: () => {
      toast.success('Advance funded');
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
      qc.invalidateQueries({ queryKey: ['admin-clients'] });
      onDone();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'Could not fund the invoice'),
  });

  const invalidAdvance = advance !== null && !(money(advance) > 0);

  return (
    <form className="card p-4 space-y-4 mb-5" onSubmit={(e) => { e.preventDefault(); fund.mutate(); }}>
      <h3>Fund an invoice</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="fund-borrower">Borrower</label>
          <select id="fund-borrower" className="input" value={form.company_id}
                  onChange={(e) => chooseBorrower(e.target.value)} required>
            <option value="">Select…</option>
            {(clients ?? []).map((c) => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fund-name">Name</label>
          <input id="fund-name" className="input" value={form.contact_name} onChange={set('contact_name')}
                 maxLength={200} list="fund-names" placeholder="The borrower’s contact on this deal" />
          <datalist id="fund-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        </div>
        <div>
          <label className="label" htmlFor="fund-creditor">Creditor</label>
          <select id="fund-creditor" className="input" value={form.debtor_id} onChange={set('debtor_id')} required>
            <option value="">Select…</option>
            {(debtors ?? []).map((d) => <option key={d.id} value={d.id}>{d.legal_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fund-sales">Sales person</label>
          <input id="fund-sales" className="input" value={form.sales_person} onChange={set('sales_person')}
                 maxLength={100} list="fund-sales-people" />
          <datalist id="fund-sales-people">{salesPeople.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="fund-project">Project</label>
          <input id="fund-project" className="input" value={form.project} onChange={set('project')}
                 maxLength={300} list="fund-projects" placeholder="e.g. 241 N. 10th St. — housing" />
          <datalist id="fund-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div>
          <label className="label" htmlFor="fund-date">Adv date</label>
          <input id="fund-date" className="input" type="date" value={form.advanced_on} onChange={set('advanced_on')} required />
        </div>
        <div>
          <label className="label" htmlFor="fund-invoice">Invoice #</label>
          <input id="fund-invoice" className="input" value={form.invoice_number} onChange={set('invoice_number')}
                 maxLength={60} placeholder="Optional — leave blank for an auto INV-… id" />
        </div>
        <div>
          <label className="label" htmlFor="fund-total">Total invoice</label>
          <input id="fund-total" className="input" inputMode="decimal" value={form.face_amount}
                 onChange={set('face_amount')} required pattern="\$?\s*[0-9][0-9,]*(\.[0-9]{1,2})?"
                 title="An amount, like 48690 or 48,690.00" />
        </div>
        <div>
          <label className="label" htmlFor="fund-advanced">Total advanced</label>
          <input id="fund-advanced" className="input" inputMode="decimal"
                 value={advance ?? (byRate !== null ? byRate.toFixed(2) : '')}
                 onChange={(e) => setAdvance(e.target.value)}
                 placeholder={rate === null ? 'Choose a borrower' : 'Enter the total invoice'}
                 aria-describedby="fund-advanced-help" />
          <p id="fund-advanced-help" className={`text-xs mt-1 ${tooMuch ? 'text-red-600' : 'text-slate-500'}`}>
            {tooMuch ? 'More than the invoice — check the amounts.'
              : advance === null
                ? (rate !== null ? `${pctText(rate)} of the invoice, the client’s rate. Change it if you advanced a different amount.` : ' ')
                : <>
                    {effective !== null && `${pctText(effective)} of the invoice`}
                    {rate !== null && effective !== null && Math.abs(effective - rate) >= 0.005 && ` · the client’s rate is ${pctText(rate)}`}
                    {advanced !== null && face > 0 && !tooMuch && ` · reserve ${formatCurrency(face - advanced)}`}
                    {' · '}
                    <button type="button" className="underline hover:text-slate-800" onClick={() => setAdvance(null)}>
                      use the client’s rate
                    </button>
                  </>}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="fund-due">Invoice due <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="fund-due" className="input" type="date" value={form.invoice_due_on} onChange={set('invoice_due_on')} />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        The advance rate and recourse period are snapshotted onto the advance, so later schedule edits can’t
        rewrite funded terms. Fees are on the total invoice.
      </p>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={fund.isPending || tooMuch || invalidAdvance}>
          {fund.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Fund
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
