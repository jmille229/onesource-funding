import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Upload } from 'lucide-react';
import { adminApi } from '../../lib/admin-api';
import { formatCurrency, formatDate } from '../../lib/api';

// ─── Advance Book import ──────────────────────────────────────────────────────
// Paste in (or upload) the Advance Book tab from the operator workbook. The
// server accepts the workbook's actual column names — no reshaping required.
//
// It's an upsert: a row that matches an advance already in the book updates it
// instead of adding a duplicate, so the same workbook can be re-imported after
// it's edited. The preview shows exactly what each row will do before anything
// is written. Fees, Days and APR are ignored — the fee schedule computes those.

interface PreviewItem {
  row: number; action: 'create' | 'update' | 'unchanged';
  client_name: string; borrower: string; creditor: string; new_agency: boolean;
  invoice_number: string | null; face_amount: number; advanced_on: string; will_settle: boolean;
  matches: { id: string; invoice_number: string | null; advanced_on: string } | null;
  changes: { label: string; from: string; to: string }[];
  warnings: string[];
}
interface ImportResult {
  dry_run: boolean; would_apply?: number; applied?: number;
  counts?: { create: number; update: number; unchanged: number };
  created?: number; updated?: number; unchanged?: number;
  errors: { row: number; message: string }[];
  preview?: PreviewItem[];
}

const ADVANCE_BOOK_HEADER =
  'Borrower,Name,Creditor,Sales person,Project,Adv Date,Invoice #,' +
  'Total Invoice,Total Advanced,Contract Ready,Invoice Ready,Check #,' +
  'Date Paid Back,Amount Received,Fees,Bal Due,Prove,Days,' +
  'Days (Pending),#Years,APR,Email,First Name,Notes';

const ACTION: Record<PreviewItem['action'], [string, string]> = {
  create: ['New', 'badge-blue'], update: ['Update', 'badge-yellow'], unchanged: ['No change', 'badge-gray'],
};

export function ImportPanel() {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // The operator downloads the Advance Book as .csv/.tsv/.txt and picks it
  // here; the parser auto-detects comma vs tab.
  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(typeof reader.result === 'string' ? reader.result : '');
      setPreview(null);
      setUploadedName(f.name);
    };
    reader.onerror = () => toast.error(`Could not read ${f.name}`);
    reader.readAsText(f);
  };

  const run = useMutation({
    mutationFn: (dry: boolean) => adminApi.post('/invoices/import', { csv, dry_run: dry }).then((r) => r.data.data as ImportResult),
    onSuccess: (data, dry) => {
      if (dry) { setPreview(data); setShowUnchanged(false); return; }
      const bits = [data.created ? `${data.created} added` : '', data.updated ? `${data.updated} updated` : '',
                    data.unchanged ? `${data.unchanged} unchanged` : ''].filter(Boolean);
      toast.success(`Import done: ${bits.join(', ') || 'nothing to change'}`);
      setCsv(''); setPreview(null); setUploadedName(null);
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
      qc.invalidateQueries({ queryKey: ['admin-clients'] });
      qc.invalidateQueries({ queryKey: ['admin-client-history'] });
      qc.invalidateQueries({ queryKey: ['admin-debtors'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message ?? 'Import failed'),
  });

  const items = preview?.preview ?? [];
  const counts = preview?.counts ?? { create: 0, update: 0, unchanged: 0 };
  const warnings = useMemo(() => items.flatMap((i) => i.warnings.map((w) => ({ row: i.row, message: w }))), [items]);
  const shown = items.filter((i) => showUnchanged || i.action !== 'unchanged')
    .sort((a, b) => (a.action === b.action ? a.row - b.row : a.action === 'update' ? -1 : b.action === 'update' ? 1 : a.action === 'create' ? -1 : 1));
  const errors = preview?.errors ?? [];
  const canApply = Boolean(preview) && errors.length === 0 && (counts.create + counts.update) > 0;

  return (
    <div className="card p-4 space-y-4">
      <div>
        <h3>Import advances from the workbook</h3>
        <p className="text-sm text-slate-500 mt-1">
          Upload a downloaded .csv/.tsv, or paste rows straight from the Advance Book tab. Re-importing is safe:
          rows already in the book are <strong>updated</strong>, not added again. Nothing is written until you’ve
          seen the preview and every row checks out.
        </p>
      </div>

      <details className="rounded-lg border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">How rows are matched, and which columns are used</summary>
        <div className="px-3 pb-3 pt-1 space-y-2 text-xs text-slate-600">
          <p><strong>Same advance</strong> when the client matches and the invoice # matches (case, spaces, dashes and
            leading zeros ignored) with advance dates within 14 days. A one-character typo in the invoice # still matches
            if the date and amount agree. Rows without an invoice # match on advance date, amount and agency.
            Client and agency names match despite punctuation or “LLC / Inc.” differences.</p>
          <p><strong>Updates overwrite</strong> the advance with what the sheet says — invoice #, agency, amount,
            advance date, notes, and the payment (date paid, amount received, check #). <strong>A blank cell never
            erases</strong> anything already recorded, e.g. a payment entered in the console.</p>
          <p><strong>Refused, not guessed:</strong> a row that could be either of two advances, two rows for the same
            advance, or a Borrower that isn’t a set-up client.</p>
          <p><strong>Required per row:</strong> Borrower, Creditor, Total Invoice, Adv Date (Invoice # strongly recommended).
            <strong> Ignored on purpose:</strong> Fees, Bal Due, Days, #Years, APR — the fee schedule computes those.</p>
          <p className="pt-1"><code className="text-[11px] break-all">{ADVANCE_BOOK_HEADER}</code></p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" className="hidden"
               onChange={(e) => { onFile(e.target.files?.[0] ?? null); if (fileRef.current) fileRef.current.value = ''; }} />
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4" /> Choose file
        </button>
        {uploadedName && <span className="text-xs text-slate-600">Loaded <span className="font-mono">{uploadedName}</span></span>}
        <span className="text-xs text-slate-400">— or paste below —</span>
      </div>

      <textarea className="input font-mono text-xs" rows={8} value={csv}
                onChange={(e) => { setCsv(e.target.value); setPreview(null); setUploadedName(null); }}
                placeholder="Paste the header row, then the advance rows below it" aria-label="Rows pasted from the Advance Book tab" />

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={!csv || run.isPending} onClick={() => run.mutate(true)}>
          {run.isPending && run.variables === true && <Loader2 className="w-4 h-4 animate-spin" />} Preview
        </button>
        <button className="btn-primary" disabled={!canApply || run.isPending} onClick={() => run.mutate(false)}>
          {run.isPending && run.variables === false && <Loader2 className="w-4 h-4 animate-spin" />}
          {preview ? `Apply: ${counts.create} new, ${counts.update} update${counts.update === 1 ? '' : 's'}` : 'Apply'}
        </button>
      </div>

      {preview && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="badge-blue">{counts.create} new</span>
          <span className="badge-yellow">{counts.update} to update</span>
          <span className="badge-gray">{counts.unchanged} already up to date</span>
          {errors.length > 0 && <span className="badge-red">{errors.length} problem{errors.length === 1 ? '' : 's'}</span>}
        </div>
      )}

      {errors.length > 0 && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50">
          <p className="text-red-800 font-medium flex items-center gap-2 text-sm">
            <AlertTriangle className="w-4 h-4" /> Fix these rows first — nothing is written until every row checks out
          </p>
          <ul className="mt-2 space-y-0.5 text-red-700 text-xs max-h-48 overflow-y-auto">
            {errors.slice(0, 60).map((e, i) => <li key={`${e.row}-${i}`}><span className="font-mono">Row {e.row}:</span> {e.message}</li>)}
            {errors.length > 60 && <li className="italic">… and {errors.length - 60} more.</li>}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <details className="p-3 rounded-md border border-amber-200 bg-amber-50" open={warnings.length <= 8}>
          <summary className="text-amber-900 font-medium text-sm cursor-pointer">
            {warnings.length} thing{warnings.length === 1 ? '' : 's'} to double-check (won’t stop the import)
          </summary>
          <ul className="mt-2 space-y-0.5 text-amber-900 text-xs max-h-48 overflow-y-auto">
            {warnings.map((w, i) => <li key={i}><span className="font-mono">Row {w.row}:</span> {w.message}</li>)}
          </ul>
        </details>
      )}

      {preview && items.length > 0 && (
        <div className="space-y-2">
          {counts.unchanged > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
              Show the {counts.unchanged} row{counts.unchanged === 1 ? '' : 's'} with no changes
            </label>
          )}
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-xs min-w-[56rem]">
              <thead className="bg-slate-50 text-left text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">Row</th><th className="py-2 px-3">Action</th><th className="py-2 px-3">Client</th>
                  <th className="py-2 px-3">Agency</th><th className="py-2 px-3">Invoice #</th>
                  <th className="py-2 px-3 text-right">Amount</th><th className="py-2 px-3">Advanced</th>
                  <th className="py-2 px-3">What changes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((i) => (
                  <tr key={i.row} className="align-top">
                    <td className="py-1.5 px-3 tabular-nums text-slate-500">{i.row}</td>
                    <td className="py-1.5 px-3"><span className={ACTION[i.action][1]}>{ACTION[i.action][0]}</span></td>
                    <td className="py-1.5 px-3">{i.client_name}</td>
                    <td className="py-1.5 px-3">{i.creditor}{i.new_agency && <span className="ml-1 text-[10px] text-amber-700">(new)</span>}</td>
                    <td className="py-1.5 px-3 font-mono">{i.invoice_number ?? <span className="text-slate-400">—</span>}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{formatCurrency(i.face_amount)}</td>
                    <td className="py-1.5 px-3 tabular-nums">{formatDate(i.advanced_on)}</td>
                    <td className="py-1.5 px-3">
                      {i.action === 'create' && <span className="text-slate-600">New advance{i.will_settle ? ', already paid' : ''}</span>}
                      {i.action === 'unchanged' && <span className="text-slate-400">Matches the book</span>}
                      {i.action === 'update' && (
                        <ul className="space-y-0.5">
                          {i.changes.map((ch) => (
                            <li key={ch.label}>
                              <span className="text-slate-500">{ch.label}:</span>{' '}
                              <span className="line-through text-slate-400">{ch.from}</span> → <span className="font-medium text-slate-900">{ch.to}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
