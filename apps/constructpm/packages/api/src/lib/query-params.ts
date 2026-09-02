/**
 * Query- and body-parameter guards for typed columns.
 *
 * Request *bodies* go through Zod (the `validate` middleware). Query-string
 * filters did not, so a value that reaches a typed column raw — an enum status,
 * a UUID foreign key — was cast by Postgres and a bad value came back as a 500
 * (`invalid input value for enum …`, `invalid input syntax for type uuid`).
 *
 * That was inconsistent: some handlers guarded their `?status=` and most did
 * not, and none checked that `?job_id=` was actually a UUID. These helpers make
 * the guard uniform and turn "garbage in a filter" into a 422 the client can
 * read, not a 500 the operator has to decode from the logs. Absent (undefined
 * or empty) is always allowed — the filter is optional.
 */

import { validate as isUuid } from 'uuid';

/** A present-but-invalid parameter is a 422; asyncHandler forwards it as such. */
function badParam(field: string, message: string): never {
  throw Object.assign(new Error(`${field}: ${message}`), { status: 422 });
}

/**
 * Returns the value if it is one of `allowed`, `undefined` if the parameter was
 * not supplied, and throws 422 if it was supplied but is not a member — so an
 * enum-typed column never receives a value it cannot cast.
 */
export function enumParam<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return badParam(field, `must be one of: ${allowed.join(', ')}`);
}

/** As enumParam, for a UUID-typed column. */
export function uuidParam(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && isUuid(value)) return value;
  return badParam(field, 'must be a UUID');
}
