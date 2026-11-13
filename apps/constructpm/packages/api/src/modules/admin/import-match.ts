/**
 * Matching imported Advance Book rows to advances already in the book, so a
 * re-import updates them instead of adding duplicates.
 *
 * Pure functions — no database — so every rule is tested in isolation
 * (import-match.test.ts). The import route loads the candidates and applies
 * the result.
 *
 * The rules, in order:
 *   1. Same client, same invoice number (normalised: case, spaces, dashes and
 *      leading zeros ignored), advanced within 14 days of each other.
 *   2. Same client, an invoice number one or two keystrokes off (a typo),
 *      advanced within 3 days, for the same amount (within 1%).
 *   3. No invoice number on one side: same client, advanced within a day,
 *      same amount (within $1), same agency.
 * More than one equally good candidate is never guessed at: the row is
 * refused and the operator resolves it.
 */

const LEGAL_WORDS = new Set(['llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited',
  'lp', 'llp', 'pllc', 'pc', 'the']);

/** Abbreviations written both ways in workbooks, spelled out before comparing. */
const ABBREVIATIONS: Record<string, string> = {
  dist: 'district', dept: 'department', dpt: 'department', twp: 'township', govt: 'government', gov: 'government',
  admin: 'administration', ctr: 'center', cntr: 'center', med: 'medical', natl: 'national', svc: 'service',
  svcs: 'services', srvs: 'services', div: 'division', ofc: 'office', auth: 'authority', univ: 'university',
  hosp: 'hospital', intl: 'international', mgmt: 'management', reg: 'region', rgn: 'region', assoc: 'associates',
  bros: 'brothers', const: 'construction', constr: 'construction', engr: 'engineers', engrs: 'engineers',
  cnty: 'county', cty: 'county', commw: 'commonwealth', comm: 'commission', sch: 'school', hwy: 'highway',
};

/**
 * Name for comparison: no case or punctuation, abbreviations spelled out.
 * A business also loses its legal suffix (LLC, Inc, Co…); for an agency
 * "Co." means County ("Chester Co." = "Chester County").
 */
export function normalizeName(s: string | null | undefined, kind: 'business' | 'agency' = 'business'): string {
  const words = (s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bl\.?\s?l\.?\s?c\b\.?/g, ' llc ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => (kind === 'agency' && w === 'co' ? 'county' : ABBREVIATIONS[w] ?? w));
  return (kind === 'business' ? words.filter((w) => !LEGAL_WORDS.has(w)) : words.filter((w) => w !== 'the'))
    .join(' ');
}

/** Letters easily typed for digits inside a number: O for 0, I or L for 1. */
const foldDigitLookalikes = (s: string) =>
  s.replace(/[0-9OIL]*[0-9][0-9OIL]*/g, (run) => run.replace(/O/g, '0').replace(/[IL]/g, '1'));

/**
 * Invoice number, for comparison: upper case, letters and digits only, leading
 * zeros dropped from each run of digits, and a bare "INV"/"NO"/"INVOICE"
 * prefix dropped when what follows is all digits ("Inv #0042" = "42").
 */
export function normalizeInvoice(s: string | null | undefined): string | null {
  if (!s) return null;
  let t = foldDigitLookalikes(s.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  t = t.replace(/^(INVOICE|INV|NO)(?=\d+$)/, '');
  t = t.replace(/(^|[A-Z])0+(?=\d)/g, '$1');
  return t || null;
}

/** Upper-case letters and digits only — the form typos are measured on (zeros kept). */
const lettersAndDigits = (s: string | null | undefined) => foldDigitLookalikes((s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));

/** Levenshtein distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = above;
    }
  }
  return prev[b.length]!;
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/** Whole days between two YYYY-MM-DD dates (absolute). */
export function dayDiff(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

/**
 * The best match for `query` among `names` by normalised name: an exact
 * normalised match, else the single closest at or above `threshold`.
 * Returns null when nothing is close enough or two are equally close.
 */
export function bestNameMatch<T>(query: string, items: T[], nameOf: (t: T) => string[], threshold: number,
  kind: 'business' | 'agency' = 'business'): { item: T; exact: boolean; score: number } | null {
  const norm = (x: string) => normalizeName(x, kind);
  const q = norm(query);
  if (!q) return null;
  const exact = items.filter((t) => nameOf(t).some((n) => n && norm(n) === q));
  if (exact.length === 1) return { item: exact[0]!, exact: true, score: 1 };
  if (exact.length > 1) return null;
  let best: { item: T; score: number } | null = null;
  let tie = false;
  for (const t of items) {
    const score = Math.max(...nameOf(t).filter(Boolean).map((n) => similarity(q, norm(n))));
    if (!best || score > best.score + 1e-9) { best = { item: t, score }; tie = false; }
    else if (Math.abs(score - best.score) <= 1e-9) tie = true;
  }
  if (!best || tie || best.score < threshold) return null;
  return { item: best.item, exact: false, score: best.score };
}

export interface ExistingAdvance {
  id: string;
  invoice_number: string | null;
  advanced_on: string;          // YYYY-MM-DD
  face_amount: number;
  debtor_name: string;
}

export interface IncomingAdvance {
  invoice_number: string | null;
  advanced_on: string;
  face_amount: number;
  creditor: string;
}

export type MatchResult<T extends ExistingAdvance = ExistingAdvance> =
  | { kind: 'match'; existing: T; fuzzy: boolean; reason: string }
  | { kind: 'none'; warning: string | null }
  | { kind: 'ambiguous'; candidates: T[] };

const closeAmount = (a: number, b: number, pct: number, floor: number) => Math.abs(a - b) <= Math.max(floor, pct * Math.max(a, b));

/** Pick the one candidate with the closest advance date, or report a tie. */
function closest<T extends ExistingAdvance>(row: IncomingAdvance, cands: T[]): T | null {
  const sorted = [...cands].sort((x, y) => dayDiff(x.advanced_on, row.advanced_on) - dayDiff(y.advanced_on, row.advanced_on));
  if (sorted.length > 1 && dayDiff(sorted[0]!.advanced_on, row.advanced_on) === dayDiff(sorted[1]!.advanced_on, row.advanced_on)) return null;
  return sorted[0] ?? null;
}

export function matchAdvance<T extends ExistingAdvance>(row: IncomingAdvance, existing: T[]): MatchResult<T> {
  const inv = normalizeInvoice(row.invoice_number);

  if (inv) {
    // 1. Same invoice number, close in time.
    const same = existing.filter((e) => normalizeInvoice(e.invoice_number) === inv);
    const near = same.filter((e) => dayDiff(e.advanced_on, row.advanced_on) <= 14);
    if (near.length) {
      const pick = closest(row, near);
      if (!pick) return { kind: 'ambiguous', candidates: near };
      const sameText = (pick.invoice_number ?? '').trim() === (row.invoice_number ?? '').trim();
      const sameDay = pick.advanced_on === row.advanced_on;
      return {
        kind: 'match', existing: pick, fuzzy: !sameText || !sameDay,
        reason: sameDay ? 'same invoice #' : `same invoice #, advance date ${dayDiff(pick.advanced_on, row.advanced_on)} day(s) apart`,
      };
    }

    // 2. A typo in the invoice number, but the same date and amount.
    const raw = lettersAndDigits(row.invoice_number);
    if (raw.length >= 4) {
      const typos = existing.filter((e) => {
        const n = normalizeInvoice(e.invoice_number);
        const r = lettersAndDigits(e.invoice_number);
        return n && n !== inv && editDistance(r, raw) <= (raw.length >= 8 ? 2 : 1)
          && dayDiff(e.advanced_on, row.advanced_on) <= 3
          && closeAmount(e.face_amount, row.face_amount, 0.01, 1);
      });
      if (typos.length === 1) {
        return { kind: 'match', existing: typos[0]!, fuzzy: true,
                 reason: `invoice # "${typos[0]!.invoice_number}" looks like a typo of "${row.invoice_number}" (same date and amount)` };
      }
      if (typos.length > 1) return { kind: 'ambiguous', candidates: typos };
    }

    // An earlier advance on the same invoice number, months apart: keep both,
    // but say so — funding one invoice twice deserves a look.
    if (same.length) {
      return { kind: 'none', warning: `Invoice # ${row.invoice_number} was also advanced on ${same.map((e) => e.advanced_on).join(', ')} — added as a separate advance` };
    }
  }

  // 3. No invoice number on one side: date, amount and agency.
  const agency = normalizeName(row.creditor, 'agency');
  const loose = existing.filter((e) =>
    (!inv || !normalizeInvoice(e.invoice_number))
    && dayDiff(e.advanced_on, row.advanced_on) <= 1
    && closeAmount(e.face_amount, row.face_amount, 0, 1)
    && similarity(normalizeName(e.debtor_name, 'agency'), agency) >= 0.85);
  if (loose.length === 1) {
    return { kind: 'match', existing: loose[0]!, fuzzy: true, reason: 'same date, amount and agency (no invoice # to compare)' };
  }
  if (loose.length > 1) return { kind: 'ambiguous', candidates: loose };

  return { kind: 'none', warning: null };
}
