import { api } from './api';
import {
  INVOICE_STATUS_LABELS, AWAITING_AGENCY, type InvoiceStatus,
} from '@constructpm/shared';

/**
 * Invoice tracking in the UI.
 *
 * The app doesn't send invoices — the contractor bills the agency however they
 * already do (portal, email, mail) and records each step here. These helpers
 * keep the wording and the "what's next" logic in one place.
 */

export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: 'badge-gray',
  sent: 'badge-blue',
  viewed: 'badge-blue',
  overdue: 'badge-blue',
  approved: 'badge-green',
  returned: 'badge-orange',
  partially_paid: 'badge-yellow',
  paid: 'badge-green',
  void: 'badge-gray',
};

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? status.replace(/_/g, ' ');
}

export function invoiceStatusBadge(status: string): string {
  return INVOICE_STATUS_BADGE[status as InvoiceStatus] ?? 'badge-gray';
}

export function isAwaitingAgency(status: string): boolean {
  return (AWAITING_AGENCY as readonly string[]).includes(status);
}

export type InvoiceAction = 'submit' | 'approve' | 'return' | 'payment';

/** The one thing to do next on an invoice, shown as its primary button. */
export function nextAction(status: string): { action: InvoiceAction; label: string } | null {
  if (status === 'draft') return { action: 'submit', label: 'Mark submitted' };
  if (status === 'returned') return { action: 'submit', label: 'Mark resubmitted' };
  if (isAwaitingAgency(status)) return { action: 'approve', label: 'Mark approved' };
  if (status === 'approved' || status === 'partially_paid') return { action: 'payment', label: 'Record payment' };
  return null;
}

/** Funding request statuses, as the client sees them. */
export const FUNDING_LABEL: Record<string, string> = {
  submitted: 'Funding requested', under_review: 'Under review', approved: 'Funding approved',
  declined: 'Funding declined', withdrawn: 'Withdrawn',
};
export const FUNDING_BADGE: Record<string, string> = {
  submitted: 'badge-blue', under_review: 'badge-yellow', approved: 'badge-green',
  declined: 'badge-red', withdrawn: 'badge-gray',
};

/** Days since a calendar date, or null. */
export function daysSince(d: string | null | undefined): number | null {
  if (!d) return null;
  const then = Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d);
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((todayUTC - then) / 86400_000));
}

// ─── Documents ────────────────────────────────────────────────────────────────

export interface InvoiceDocument {
  id: string;
  original_name: string;
  doc_type: string | null;
  created_at: string;
  uploaded_by_name?: string | null;
}

/** Attach a document to an invoice, labelled with what it is. */
export async function uploadInvoiceDocument(invoiceId: string, docType: string, file: File) {
  const fd = new FormData();
  // Fields before the file: the server reads them as the file starts streaming.
  fd.append('entity_type', 'invoice');
  fd.append('entity_id', invoiceId);
  fd.append('doc_type', docType);
  fd.append('file', file);
  const r = await api.post('/files/upload', fd);
  return r.data.data as InvoiceDocument;
}

/** Download an attachment, whichever way the server delivers it (URL or bytes). */
export async function downloadAttachment(path: string, filename: string) {
  const r = await api.get(path, { responseType: 'blob' });
  const blob = r.data as Blob;
  if (blob.type.includes('application/json')) {
    const { data } = JSON.parse(await blob.text()) as { data?: { url?: string } };
    if (data?.url) { window.open(data.url, '_blank', 'noopener'); return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Roles, matching the API's guards. */
export const canEditInvoices = (role?: string) => ['owner', 'admin', 'project_manager', 'accountant'].includes(role ?? '');
export const canRecordPayments = (role?: string) => ['owner', 'admin', 'accountant'].includes(role ?? '');
export const canSeeFunding = (role?: string) => ['owner', 'admin', 'accountant'].includes(role ?? '');
export const canVoid = (role?: string) => ['owner', 'admin'].includes(role ?? '');
