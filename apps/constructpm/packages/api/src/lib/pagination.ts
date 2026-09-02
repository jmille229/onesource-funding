/**
 * Bounded list queries.
 *
 * Every list endpoint used to select every matching row. That is fine for a
 * tenant with forty invoices and a slow-motion outage for one with three years
 * of daily logs and time entries: the query runs to the 30-second request
 * deadline, the response is tens of megabytes, and the browser tab hangs. The
 * jobs endpoint had pagination but read `page` and `per_page` straight off the
 * query string — `per_page=999999999` was an unbounded query with extra steps,
 * and `page=0` produced a negative OFFSET that Postgres rejected as a 500.
 *
 * `parsePagination` is the one place those numbers are read and clamped. Every
 * list handler passes its LIMIT (and, where it pages, OFFSET) through here.
 */

export interface Pagination {
  /** 1-based page, clamped to >= 1. */
  page: number;
  /** Rows per page, clamped to [1, maxPerPage]. */
  per_page: number;
  /** Alias of per_page — what goes into the SQL LIMIT. */
  limit: number;
  /** (page - 1) * per_page — what goes into the SQL OFFSET. */
  offset: number;
}

export interface PaginationOptions {
  defaultPerPage?: number;
  maxPerPage?: number;
}

const DEFAULT_PER_PAGE = 200;
const DEFAULT_MAX_PER_PAGE = 500;

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function parsePagination(
  query: Record<string, unknown>,
  opts: PaginationOptions = {}
): Pagination {
  const max = Math.max(1, opts.maxPerPage ?? DEFAULT_MAX_PER_PAGE);
  const dflt = Math.min(max, Math.max(1, opts.defaultPerPage ?? DEFAULT_PER_PAGE));

  const rawPer = toInt(query['per_page']);
  const per_page = rawPer === null ? dflt : Math.min(max, Math.max(1, rawPer));

  const rawPage = toInt(query['page']);
  const page = rawPage === null ? 1 : Math.max(1, rawPage);

  return { page, per_page, limit: per_page, offset: (page - 1) * per_page };
}

/**
 * Escapes a user-supplied search string for use inside an ILIKE pattern, so
 * `%` and `_` in the input match themselves rather than acting as wildcards.
 * Postgres' default ESCAPE character is backslash, so no ESCAPE clause is
 * required. Also caps length: a 10 KB search term is never a real search.
 */
export function escapeLike(input: string, maxLength = 100): string {
  return input.slice(0, maxLength).replace(/[\\%_]/g, (c) => `\\${c}`);
}
