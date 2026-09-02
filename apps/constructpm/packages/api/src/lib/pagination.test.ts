import { describe, it, expect } from 'vitest';
import { parsePagination, escapeLike } from './pagination.js';

describe('parsePagination', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(parsePagination({})).toEqual({ page: 1, per_page: 200, limit: 200, offset: 0 });
  });

  it('reads page and per_page and computes the offset', () => {
    expect(parsePagination({ page: '3', per_page: '25' }))
      .toEqual({ page: 3, per_page: 25, limit: 25, offset: 50 });
  });

  it('clamps per_page to the maximum — the old unbounded-query-with-extra-steps case', () => {
    expect(parsePagination({ per_page: '999999999' }).limit).toBe(500);
    expect(parsePagination({ per_page: '999' }, { maxPerPage: 100 }).limit).toBe(100);
  });

  it('never produces a negative or zero OFFSET/LIMIT', () => {
    // page=0 used to give OFFSET -25 and a Postgres error surfaced as a 500.
    expect(parsePagination({ page: '0', per_page: '25' }).offset).toBe(0);
    expect(parsePagination({ page: '-4' }).page).toBe(1);
    expect(parsePagination({ per_page: '0' }).limit).toBe(1);
    expect(parsePagination({ per_page: '-10' }).limit).toBe(1);
  });

  it('treats garbage as unset rather than passing NaN to SQL', () => {
    expect(parsePagination({ page: 'abc', per_page: 'xyz' }))
      .toEqual({ page: 1, per_page: 200, limit: 200, offset: 0 });
    expect(parsePagination({ page: '', per_page: '  ' }).limit).toBe(200);
  });

  it('honours a smaller default without exceeding the max', () => {
    expect(parsePagination({}, { defaultPerPage: 50 }).limit).toBe(50);
    expect(parsePagination({}, { defaultPerPage: 5000, maxPerPage: 1000 }).limit).toBe(1000);
  });
});

describe('escapeLike', () => {
  it('neutralises LIKE wildcards so they match literally', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike("O'Brien Plumbing")).toBe("O'Brien Plumbing");
  });

  it('caps length so a giant term cannot become a giant scan', () => {
    expect(escapeLike('x'.repeat(5000)).length).toBe(100);
  });
});
