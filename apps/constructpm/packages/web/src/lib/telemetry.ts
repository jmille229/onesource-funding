/**
 * Browser crashes go to /api/telemetry/client-error, and from there to error
 * tracking (if the server has it on). Same origin, so the strict CSP stays
 * as it is. At most a handful of reports per page load, each message once;
 * the URL is sent without query string or fragment (links carry tokens).
 */
const seen = new Set<string>();
let sent = 0;

export function reportClientError(message: string, stack?: string | null, componentStack?: string | null) {
  if (sent >= 10 || seen.has(message)) return;
  seen.add(message);
  sent += 1;
  try {
    void fetch('/api/telemetry/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: message.slice(0, 1000),
        stack: stack?.slice(0, 8000) ?? null,
        component_stack: componentStack?.slice(0, 4000) ?? null,
        url: window.location.origin + window.location.pathname,
      }),
    }).catch(() => {});
  } catch { /* never let reporting break the page */ }
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => {
    if (!e.message) return;   // resource load errors carry no message
    reportClientError(e.message, (e.error as Error | undefined)?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string; isAxiosError?: boolean } | undefined;
    if (r?.isAxiosError) return;   // API errors are the server's to report
    reportClientError(r?.message ?? String(e.reason), r?.stack);
  });
}
