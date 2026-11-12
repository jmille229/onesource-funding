import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { adminApi } from '../../lib/admin-api';

/**
 * What applicants are asked for on apply.os-funding.com. Editable here so a
 * new requirement doesn't need a code change. Deactivating hides it from new
 * and in-progress applications; anything already uploaded is kept.
 */

interface Req {
  id: string; key: string; label: string; description: string | null; kind: 'document' | 'ein' | 'ssn';
  required: boolean; active: boolean; sort_order: number; template_name: string | null; has_template: boolean;
}
type ErrorLike = { response?: { data?: { message?: string; details?: Record<string, string[]> } } };
const errMsg = (e: unknown, fallback: string) => {
  const d = (e as ErrorLike).response?.data;
  const field = d?.details && Object.entries(d.details).find(([, v]) => v?.length);
  return field ? `${field[0]}: ${field[1][0]}` : d?.message ?? fallback;
};
const KIND_LABEL = { document: 'Document upload', ein: 'EIN (typed, encrypted)', ssn: 'SSN (typed, encrypted)' };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export function RequirementsPanel() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { data, isLoading } = useQuery<Req[]>({
    queryKey: ['admin-app-requirements'],
    queryFn: () => adminApi.get('/application-requirements').then((r) => r.data.data),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-app-requirements'] });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Req> }) => adminApi.patch(`/application-requirements/${id}`, body),
    onSuccess: () => { refresh(); setEditing(null); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t save')),
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h2>What applicants provide</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            The checklist on apply.os-funding.com. Required items must be in before an applicant can submit.
          </p>
        </div>
        {!adding && <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add a requirement</button>}
      </div>

      {adding && <AddRequirement nextOrder={((data ?? []).at(-1)?.sort_order ?? 0) + 10}
                                 onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}

      <div className="card divide-y divide-slate-100">
        {isLoading && <p className="p-6 text-center text-sm text-slate-500">Loading…</p>}
        {(data ?? []).map((r) => (
          <div key={r.id} className={`p-4 ${r.active ? '' : 'bg-slate-50'}`}>
            {editing === r.id
              ? <EditRequirement req={r} saving={patch.isPending} onCancel={() => setEditing(null)}
                                 onSave={(body) => patch.mutate({ id: r.id, body })} />
              : (
                <div className="flex flex-col md:flex-row md:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-semibold ${r.active ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{r.label}</p>
                      <span className="badge-gray">{KIND_LABEL[r.kind]}</span>
                      {r.required ? <span className="badge-blue">Required</span> : <span className="badge-gray">Optional</span>}
                      {!r.active && <span className="badge-gray">Hidden</span>}
                    </div>
                    {r.description && <p className="text-sm text-slate-600 mt-1">{r.description}</p>}
                    {r.kind === 'document' && <TemplateControl req={r} onChanged={refresh} />}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button className="btn-secondary btn-sm" onClick={() => setEditing(r.id)}>Edit</button>
                    <button className="btn-ghost btn-sm" disabled={patch.isPending}
                            onClick={() => patch.mutate({ id: r.id, body: { active: !r.active } })}>
                      {r.active ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              )}
          </div>
        ))}
      </div>
    </>
  );
}

function AddRequirement({ nextOrder, onDone, onCancel }: { nextOrder: number; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ label: '', description: '', kind: 'document' as Req['kind'], required: true });
  const add = useMutation({
    mutationFn: () => adminApi.post('/application-requirements', {
      key: slug(form.label), label: form.label.trim(), description: form.description.trim() || null,
      kind: form.kind, required: form.required, sort_order: nextOrder,
    }),
    onSuccess: () => { toast.success('Added — applicants see it now'); onDone(); },
    onError: (e) => toast.error(errMsg(e, 'Couldn’t add it')),
  });
  return (
    <form className="card p-4 mb-4 space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <h3>Add a requirement</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="rq_label">Name</label>
          <input id="rq_label" className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
                 required minLength={2} maxLength={120} placeholder="e.g. Certificate of insurance" />
        </div>
        <div>
          <label className="label" htmlFor="rq_kind">Type</label>
          <select id="rq_kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Req['kind'] })}>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="rq_desc">What to tell the applicant <span className="font-normal text-slate-400">(optional)</span></label>
          <textarea id="rq_desc" className="input" rows={2} maxLength={600} value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="w-4 h-4" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
        Required before they can submit
      </label>
      <p className="text-xs text-slate-500">
        It appears on every application that hasn’t been submitted yet. Applications already submitted aren’t affected.
      </p>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={add.isPending || slug(form.label).length < 2}>Add</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function EditRequirement({ req, saving, onSave, onCancel }: {
  req: Req; saving: boolean; onSave: (b: Partial<Req>) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({
    label: req.label, description: req.description ?? '', required: req.required, sort_order: String(req.sort_order),
  });
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      onSave({ label: form.label.trim(), description: form.description.trim() || null, required: form.required,
               sort_order: Math.max(0, Math.round(Number(form.sort_order) || 0)) });
    }}>
      <div className="grid sm:grid-cols-[1fr_7rem] gap-3">
        <div>
          <label className="label" htmlFor={`e_label_${req.id}`}>Name</label>
          <input id={`e_label_${req.id}`} className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required minLength={2} maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor={`e_order_${req.id}`}>Order</label>
          <input id={`e_order_${req.id}`} className="input" inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`e_desc_${req.id}`}>What to tell the applicant</label>
          <textarea id={`e_desc_${req.id}`} className="input" rows={2} maxLength={600} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="w-4 h-4" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
        Required before they can submit
      </label>
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" disabled={saving}>Save</button>
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** The blank form applicants download for this item (e.g. the payment directive). */
function TemplateControl({ req, onChanged }: { req: Req; onChanged: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await adminApi.post(`/application-requirements/${req.id}/template`, fd);
      toast.success('Blank form uploaded');
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, 'Upload failed — use a PDF or Word file under 15 MB'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm('Remove the blank form? Applicants won’t be able to download it.')) return;
    try {
      await adminApi.delete(`/application-requirements/${req.id}/template`);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, 'Couldn’t remove it'));
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input ref={ref} type="file" className="hidden" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
             onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      {req.has_template ? (
        <>
          <span className="text-slate-600">Blank form: <span className="font-medium">{req.template_name}</span></span>
          <button className="text-brand-700 hover:underline text-xs" disabled={busy} onClick={() => ref.current?.click()}>Replace</button>
          <button className="text-slate-500 hover:text-red-600 text-xs inline-flex items-center gap-0.5" onClick={() => void remove()}>
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        </>
      ) : (
        <button className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 hover:underline" disabled={busy}
                onClick={() => ref.current?.click()}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload a blank form for applicants to download
        </button>
      )}
    </div>
  );
}
