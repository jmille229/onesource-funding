/**
 * Addresses of the other One Source sites, in one place.
 *
 * Each can be overridden per environment (e.g. a staging build) with a Vite
 * env var; the defaults are production.
 */

/** The client portal (invoice tracking and funding): sign in, register. */
export const APP_URL =
  (import.meta.env.VITE_APP_URL as string | undefined) ?? "https://app.os-funding.com";

/** The online funding application: no account needed to start. */
export const APPLY_URL =
  (import.meta.env.VITE_APPLY_URL as string | undefined) ?? "https://apply.os-funding.com";
