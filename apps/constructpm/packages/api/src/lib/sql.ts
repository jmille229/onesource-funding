/**
 * Safe dynamic-UPDATE construction.
 *
 * SECURITY: Column names cannot be parameterized in SQL — they have to be
 * interpolated into the statement text. That makes any `Object.keys(req.body)`
 * loop a SQL-injection sink, because a crafted JSON key like
 *
 *   { "summary=(SELECT password_hash FROM users LIMIT 1), notes": "x" }
 *
 * becomes executable SQL. `buildUpdateSet` closes that hole by only ever
 * emitting identifiers drawn from a hard-coded allowlist, and asserting the
 * allowlist itself contains nothing but plain identifiers.
 *
 * Always pass a literal allowlist — never one derived from user input.
 */

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface UpdateSet {
  /** e.g. `summary = $2, notes = $3` — empty string when nothing is updatable. */
  clause: string;
  /** Values positionally matching the placeholders in `clause`. */
  values: unknown[];
}

export function buildUpdateSet(
  body: Record<string, unknown>,
  allowed: readonly string[],
  startIndex = 2
): UpdateSet {
  // Fail loudly on a bad allowlist rather than emitting unsafe SQL. This is a
  // programmer error, not user input, so throwing is correct.
  for (const col of allowed) {
    if (!SAFE_IDENTIFIER.test(col)) {
      throw new Error(`buildUpdateSet: unsafe column name in allowlist: ${col}`);
    }
  }

  const keys = Object.keys(body).filter(
    (k) => allowed.includes(k) && body[k] !== undefined
  );

  return {
    clause: keys.map((k, i) => `${k} = $${i + startIndex}`).join(', '),
    values: keys.map((k) => body[k]),
  };
}
