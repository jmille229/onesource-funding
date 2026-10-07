import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { DOC_TYPE_LABELS, isApprovalDocType, type DocType } from '@constructpm/shared';
import { adminApi } from '../../lib/admin-api';
import { formatDate } from '../../lib/api';

interface Doc { id: string; original_name: string; doc_type: string | null; size_bytes: string; created_at: string }

/**
 * The documents a client submitted with a funding request — the invoice and
 * the agency's approval, labelled by type — so underwriting can open them
 * without leaving the queue.
 */
export function RequestDocuments({ requestId }: { requestId: string }) {
  const { data: docs, isLoading } = useQuery<Doc[]>({
    queryKey: ['admin-request-docs', requestId],
    queryFn: () => adminApi.get(`/requests/${requestId}/documents`).then((r) => r.data.data),
  });

  const download = async (d: Doc) => {
    try {
      const r = await adminApi.get(`/requests/${requestId}/documents/${d.id}/download`, { responseType: 'blob' });
      const blob = r.data as Blob;
      if (blob.type.includes('application/json')) {
        const { data } = JSON.parse(await blob.text()) as { data?: { url?: string } };
        if (data?.url) { window.open(data.url, '_blank', 'noopener'); return; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = d.original_name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error('Download failed');
    }
  };

  if (isLoading) return <div className="px-4 py-3 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading documents…</div>;
  const list = docs ?? [];
  const hasApproval = list.some((d) => isApprovalDocType(d.doc_type));

  return (
    <div className="px-4 pt-3 pb-1">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Documents</p>
      {!hasApproval && (
        <p className="text-sm text-amber-700 mb-2">No proof of agency approval attached.</p>
      )}
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">None.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {list.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => void download(d)}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 ${
                  isApprovalDocType(d.doc_type) ? 'border-green-300 text-green-800' : 'border-slate-200 text-slate-700'}`}
                title={`${d.original_name} · ${formatDate(d.created_at)}`}
              >
                <FileText className="w-4 h-4 flex-shrink-0" />
                <span>{d.doc_type ? DOC_TYPE_LABELS[d.doc_type as DocType] ?? d.doc_type : 'Document'}</span>
                <Download className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
