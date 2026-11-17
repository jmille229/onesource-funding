import { env } from './env.js';

/**
 * Today's date (YYYY-MM-DD) in the business time zone (BUSINESS_TZ, Eastern
 * by default) — not the server's UTC date, which rolls over at 7–8 pm Eastern.
 * The database uses the same zone (V021).
 */
export function businessToday(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
