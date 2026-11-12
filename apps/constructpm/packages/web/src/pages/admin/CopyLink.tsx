import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { toast } from 'sonner';

/** A link to hand over by hand (email may not be configured), with copy. */
export function CopyLink({ label, url, note, onDismiss }: { label: string; url: string; note?: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <button onClick={onDismiss} className="p-1 -m-1 text-slate-400 hover:text-slate-600" aria-label="Dismiss"><X className="w-4 h-4" /></button>
      </div>
      <div className="mt-2 flex flex-col sm:flex-row gap-2">
        <input readOnly value={url} className="input font-mono text-xs flex-1 min-w-0" onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button className="btn-secondary flex-shrink-0" onClick={() => {
          void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
            () => toast.error('Couldn’t copy — select the link instead'));
        }}>
          {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {note && <p className="text-xs text-slate-600 mt-1.5">{note}</p>}
    </div>
  );
}
