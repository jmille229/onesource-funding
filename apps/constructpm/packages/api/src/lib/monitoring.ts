/**
 * Error tracking. Off unless SENTRY_DSN is set (Sentry, or any
 * Sentry-compatible service such as GlitchTip).
 *
 * Deliberately minimal: no performance tracing, no automatic HTTP
 * instrumentation, and nothing about the request beyond its method and path —
 * no headers, cookies, bodies or query strings, so tokens and client data
 * never leave the server. Server errors (5xx), crashes, and errors reported
 * by browsers (via /api/telemetry) are what's sent.
 */
import * as Sentry from '@sentry/node';
import { env } from './env.js';

export const monitoringEnabled = Boolean(env.SENTRY_DSN);

if (monitoringEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.APP_RELEASE,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    defaultIntegrations: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    beforeSend(event) {
      // Belt and braces: drop anything request-shaped that slipped in.
      if (event.request) event.request = { method: event.request.method, url: event.request.url?.split('?')[0] };
      delete event.user;
      return event;
    },
  });
}

export function reportError(err: unknown, context: Record<string, unknown> = {}) {
  if (!monitoringEnabled) return;
  Sentry.captureException(err, { extra: context });
}

export function reportMessage(message: string, context: Record<string, unknown> = {}, tags: Record<string, string> = {}) {
  if (!monitoringEnabled) return;
  Sentry.captureMessage(message, { level: 'error', extra: context, tags });
}

/** Give queued reports a moment to send before the process exits. */
export async function flushReports(ms = 2000) {
  if (monitoringEnabled) await Sentry.flush(ms).catch(() => false);
}
