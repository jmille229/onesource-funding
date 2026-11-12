import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Download, FileText, Loader2, Lock, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  applyApi, applyError, type ApplicationItem, type ApplicationState, type Requirement,
} from '../../lib/apply-api';
import { downloadVia } from '../../lib/download';
import { formatBytes } from './shared';

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

/**
 * One row per requirement One Source has set (the list is theirs to edit in
 * the operator console). Documents upload as files; EIN and SSN are typed,
 * encrypted by the server on save, and only ever shown back masked.
 */
export function DocumentsStep({ state, onChange, highlight }: {
  state: ApplicationState; onChange: (s: ApplicationState) => void; highlight: Set<string>;
}) {
  const byKey = new Map<string, ApplicationItem[]>();
  for (const i of state.items) byKey.set(i.requirement_key, [...(byKey.get(i.requirement_key) ?? []), i]);

  return (
    <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
      {state.requirements.map((r) => (
        <RequirementRow key={r.key} requirement={r} items={byKey.get(r.key) ?? []}
                        requested={highlight.has(r.key)} onChange={onChange} />
      ))}
    </ul>
  );
}

function RequirementRow({ requirement: r, items, requested, onChange }: {
  requirement: Requirement; items: ApplicationItem[]; requested: boolean;
  onChange: (s: ApplicationState) => void;
}) {
  const provided = items.length > 0;
  const fromOneSource = items.filter((i) => i.source === 'operator');
  const icon = provided
    ? <CheckCircle2 className="w-5 h-5 text-os-green" aria-label="Provided" />
    : requested
      ? <AlertCircle className="w-5 h-5 text-amber-500" aria-label="Requested" />
      : <Circle className="w-5 h-5 text-slate-300" aria-label="Not yet provided" />;

  return (
    <li className={`py-4 flex gap-3 ${requested && !provided ? 'bg-amber-50/60 -mx-3 px-3 rounded-md' : ''}`}>
      <div className="pt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-semibold text-slate-900">{r.label}</p>
          {!r.required && <span className="text-xs text-slate-400">Optional</span>}
          {requested && <span className="badge-yellow">Requested</span>}
        </div>
        {r.description && <p className="text-sm text-slate-600 mt-0.5">{r.description}</p>}
        {r.has_template && (
          <button type="button"
             onClick={() => void downloadVia(applyApi, `/requirements/${encodeURIComponent(r.key)}/template`, `${r.label}.pdf`)
               .catch(() => toast.error('Couldn’t download the form — please call us'))}
             className="inline-flex items-center gap-1.5 text-sm font-medium text-os-navy hover:underline mt-1.5">
            <Download className="w-4 h-4" /> Download the blank form
          </button>
        )}

        {fromOneSource.map((i) => (
          <p key={i.id} className="text-sm text-os-green mt-2">Received by One Source{i.note ? ` — ${i.note}` : ''}</p>
        ))}

        {r.kind === 'document'
          ? <DocumentFiles requirement={r} items={items.filter((i) => i.source === 'applicant')} onChange={onChange} />
          : fromOneSource.length === 0 && (
              <SecureNumber requirement={r} item={items.find((i) => i.source === 'applicant')} onChange={onChange} />
            )}
      </div>
    </li>
  );
}

function DocumentFiles({ requirement: r, items, onChange }: {
  requirement: Requirement; items: ApplicationItem[]; onChange: (s: ApplicationState) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) { toast.error(`${file.name} is over 25 MB`); continue; }
      const fd = new FormData();
      // The requirement goes first: the server picks where to store the file from it.
      fd.append('requirement_key', r.key);
      fd.append('file', file);
      setProgress(0);
      try {
        const res = await applyApi.post('/me/documents', fd, {
          onUploadProgress: (e) => setProgress(e.total ? Math.round((e.loaded / e.total) * 100) : null),
        });
        onChange(res.data.data);
      } catch (e) {
        const status = (e as { response?: { status?: number } }).response?.status;
        toast.error(status === 415
          ? `${file.name}: upload a PDF or a photo (JPG, PNG, HEIC)`
          : `${file.name}: ${applyError(e, 'upload failed')}`);
      }
    }
    setProgress(null);
  };

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      const res = await applyApi.delete(`/me/documents/${id}`);
      onChange(res.data.data);
    } catch (e) {
      toast.error(applyError(e, 'Couldn’t remove that file'));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-sm rounded-md bg-slate-50 border border-slate-200 px-2.5 py-1.5">
              <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="truncate flex-1 min-w-0 text-slate-800">{i.original_name}</span>
              <span className="text-xs text-slate-400 flex-shrink-0">{formatBytes(i.size_bytes)}</span>
              <button type="button" onClick={() => void remove(i.id)} disabled={removing === i.id}
                      className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                      aria-label={`Remove ${i.original_name}`}>
                {removing === i.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden"
             onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
      <button type="button" className="btn-secondary btn-sm" disabled={progress !== null}
              onClick={() => fileRef.current?.click()}>
        {progress !== null
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading{progress ? ` ${progress}%` : '…'}</>
          : <><Upload className="w-4 h-4" /> {items.length ? 'Add another file' : 'Upload'}</>}
      </button>
    </div>
  );
}

/** Format as the user types: 12-3456789 for an EIN, 123-45-6789 for an SSN. */
function formatNumber(kind: 'ein' | 'ssn', raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 9);
  if (kind === 'ein') return d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
  if (d.length > 5) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

function SecureNumber({ requirement: r, item, onChange }: {
  requirement: Requirement; item: ApplicationItem | undefined; onChange: (s: ApplicationState) => void;
}) {
  const kind = r.kind as 'ein' | 'ssn';
  const [editing, setEditing] = useState(!item);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `num_${r.key}`;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await applyApi.put(`/me/numbers/${encodeURIComponent(r.key)}`, { value });
      setValue('');           // never keep the full number around once it's saved
      setEditing(false);
      onChange(res.data.data);
    } catch (e) {
      setError(applyError(e, 'That number couldn’t be saved'));
    } finally {
      setBusy(false);
    }
  };

  if (!editing && item) {
    return (
      <div className="mt-2 flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-mono text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
          <Lock className="w-3.5 h-3.5 text-slate-400" /> {item.masked}
        </span>
        <button type="button" className="text-sm font-medium text-os-navy hover:underline"
                onClick={() => setEditing(true)}>Change</button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <label htmlFor={id} className="sr-only">{r.label}</label>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input id={id} className="input font-mono sm:w-48" inputMode="numeric" autoComplete="off" spellCheck={false}
               placeholder={kind === 'ein' ? '12-3456789' : '123-45-6789'}
               value={value} onChange={(e) => setValue(formatNumber(kind, e.target.value))}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (value.replace(/\D/g, '').length === 9) void save(); } }}
               aria-invalid={Boolean(error)} aria-describedby={`${id}_hint`} />
        <div className="flex gap-2">
          <button type="button" className="btn-os btn-sm" disabled={busy || value.replace(/\D/g, '').length !== 9}
                  onClick={() => void save()}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
          {item && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(false); setValue(''); setError(null); }}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {error
        ? <p className="text-sm text-red-700 mt-1" role="alert">{error}</p>
        : <p id={`${id}_hint`} className="text-xs text-slate-500 mt-1 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Encrypted as soon as you save it. Only our underwriting team can see it.
          </p>}
    </div>
  );
}
