import { describe, it, expect } from 'vitest';
import { enumParam, uuidParam } from './query-params.js';

const STATUSES = ['draft', 'sent', 'paid'] as const;
const UUID = '5b2c3d4e-1234-4a5b-8c9d-0123456789ab';

describe('enumParam', () => {
  it('returns undefined when the parameter is absent', () => {
    expect(enumParam(undefined, STATUSES, 'status')).toBeUndefined();
    expect(enumParam('', STATUSES, 'status')).toBeUndefined();
    expect(enumParam(null, STATUSES, 'status')).toBeUndefined();
  });

  it('returns a valid member unchanged', () => {
    expect(enumParam('paid', STATUSES, 'status')).toBe('paid');
  });

  it('throws a 422 for a value not in the set — never reaches the enum cast', () => {
    try {
      enumParam('exploded', STATUSES, 'status');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { status?: number }).status).toBe(422);
      expect((e as Error).message).toMatch(/status: must be one of: draft, sent, paid/);
    }
  });
});

describe('uuidParam', () => {
  it('returns undefined when absent', () => {
    expect(uuidParam(undefined, 'job_id')).toBeUndefined();
    expect(uuidParam('', 'job_id')).toBeUndefined();
  });

  it('returns a valid UUID unchanged', () => {
    expect(uuidParam(UUID, 'job_id')).toBe(UUID);
  });

  it('throws a 422 for a non-UUID — never reaches the uuid cast', () => {
    for (const bad of ['x', '123', 'not-a-uuid', '5b2c3d4e']) {
      try {
        uuidParam(bad, 'job_id');
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as { status?: number }).status).toBe(422);
        expect((e as Error).message).toMatch(/job_id: must be a UUID/);
      }
    }
  });
});
