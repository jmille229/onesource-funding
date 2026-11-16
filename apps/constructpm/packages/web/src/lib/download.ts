import type { AxiosInstance } from 'axios';

/**
 * Download a file from an API route, whichever way the server delivers it:
 * streamed bytes, or JSON with a short-lived presigned URL (when the object
 * store is reachable from the browser). Works with any of the axios clients,
 * so each keeps its own credential.
 */
export async function downloadVia(client: AxiosInstance, path: string, fallbackName: string) {
  const r = await client.get(path, { responseType: 'blob' });
  const blob = r.data as Blob;
  if (blob.type.includes('application/json')) {
    const { data } = JSON.parse(await blob.text()) as { data?: { url?: string } };
    if (data?.url) { window.open(data.url, '_blank', 'noopener'); return; }
  }
  const cd = String(r.headers['content-disposition'] ?? '');
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) ?? /filename="?([^";]+)"?/i.exec(cd);
  let name = fallbackName;
  if (m?.[1]) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save rows as a CSV the way Excel expects: UTF-8 with a BOM (agency names
 * carry dashes and accents), CRLF lines, and any cell that starts like a
 * formula (= + - @) neutralised so a spreadsheet never runs it.
 */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [header, ...rows].map((line) => line.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
