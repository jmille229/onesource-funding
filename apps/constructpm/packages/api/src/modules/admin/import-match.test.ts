import { describe, it, expect } from 'vitest';
import {
  normalizeName, normalizeInvoice, similarity, dayDiff, bestNameMatch, matchAdvance, type ExistingAdvance,
} from './import-match.js';

describe('normalizeName', () => {
  it('ignores case, punctuation and legal suffixes', () => {
    expect(normalizeName('Keystone Federal Services, L.L.C.')).toBe('keystone federal services');
    expect(normalizeName('KEYSTONE FEDERAL SERVICES LLC')).toBe('keystone federal services');
    expect(normalizeName('The Harbor Electric Co., Inc.')).toBe('harbor electric');
    expect(normalizeName('Smith & Sons')).toBe('smith and sons');
  });
});

describe('agency names', () => {
  it('spells out abbreviations, and Co. is County for an agency', () => {
    expect(normalizeName('PennDOT Dist. 6', 'agency')).toBe(normalizeName('PennDOT District 6', 'agency'));
    expect(normalizeName('Chester Co.', 'agency')).toBe('chester county');
    expect(normalizeName('Dept. of General Services', 'agency')).toBe('department of general services');
    expect(normalizeName('Keystone Paving Co.', 'business')).toBe('keystone paving');
  });
});

describe('normalizeInvoice', () => {
  it('reads O as 0 and I or L as 1 inside a number', () => {
    expect(normalizeInvoice('BBP-OOO3')).toBe(normalizeInvoice('BBP-0003'));
    expect(normalizeInvoice('KFS-1O01')).toBe(normalizeInvoice('KFS-1001'));
    expect(normalizeInvoice('INV-l042')).toBe(normalizeInvoice('INV-1042'));
    // Letters in a prefix stay letters.
    expect(normalizeInvoice('OSF-1001')).toBe('OSF1001');
  });

  it('ignores case, separators and leading zeros', () => {
    expect(normalizeInvoice('kfs-1001')).toBe('KFS1001');
    expect(normalizeInvoice('KFS 1001')).toBe('KFS1001');
    expect(normalizeInvoice('INV-0042')).toBe('42');
    expect(normalizeInvoice('Inv #0042')).toBe('42');
    expect(normalizeInvoice('0042')).toBe('42');
    expect(normalizeInvoice('PA-007-B')).toBe('PA7B');
  });
  it('keeps a prefix that is part of the number', () => {
    expect(normalizeInvoice('INV-42A')).toBe('INV42A');
    expect(normalizeInvoice('KFS-1001')).not.toBe(normalizeInvoice('1001'));
  });
  it('treats blanks as no number', () => {
    expect(normalizeInvoice('')).toBeNull();
    expect(normalizeInvoice(' - ')).toBeNull();
    expect(normalizeInvoice(null)).toBeNull();
  });
});

describe('similarity and dayDiff', () => {
  it('scores a one-letter typo high and different words low', () => {
    expect(similarity('keystone federal', 'keystone federel')).toBeGreaterThan(0.9);
    expect(similarity('keystone federal', 'harbor electric')).toBeLessThan(0.5);
  });
  it('counts days between dates', () => {
    expect(dayDiff('2026-03-01', '2026-03-15')).toBe(14);
    expect(dayDiff('2026-03-15T00:00:00.000Z', '2026-03-01')).toBe(14);
  });
});

describe('bestNameMatch', () => {
  const clients = [{ name: 'Keystone Federal Services LLC' }, { name: 'Harbor Electric Inc' }, { name: 'Keystone Paving LLC' }];
  const names = (c: { name: string }) => [c.name];
  it('matches exactly despite punctuation and suffix', () => {
    expect(bestNameMatch('keystone federal services, l.l.c.', clients, names, 0.88)).toMatchObject({ item: clients[0], exact: true });
  });
  it('matches a close misspelling, not a different business', () => {
    expect(bestNameMatch('Keystone Federal Servces', clients, names, 0.88)).toMatchObject({ item: clients[0], exact: false });
    expect(bestNameMatch('Keystone', clients, names, 0.88)).toBeNull();
    expect(bestNameMatch('Ridgeline Federal', clients, names, 0.88)).toBeNull();
  });
});

describe('matchAdvance', () => {
  const book: ExistingAdvance[] = [
    { id: 'a', invoice_number: 'KFS-1001', advanced_on: '2026-01-10', face_amount: 48250, debtor_name: 'Army Corps of Engineers' },
    { id: 'b', invoice_number: 'KFS-1004', advanced_on: '2026-01-22', face_amount: 31800, debtor_name: 'PennDOT District 6' },
    { id: 'c', invoice_number: null, advanced_on: '2026-02-03', face_amount: 18750, debtor_name: 'GSA Region 3' },
    { id: 'd', invoice_number: 'KFS-1010', advanced_on: '2026-03-01', face_amount: 20000, debtor_name: 'GSA Region 3' },
  ];
  const row = (o: Partial<{ invoice_number: string | null; advanced_on: string; face_amount: number; creditor: string }>) => ({
    invoice_number: 'KFS-1001', advanced_on: '2026-01-10', face_amount: 48250, creditor: 'Army Corps of Engineers', ...o,
  });

  it('same invoice # and date is the same advance', () => {
    expect(matchAdvance(row({}), book)).toMatchObject({ kind: 'match', existing: { id: 'a' }, fuzzy: false });
  });
  it('same invoice # written differently, or a corrected date, still matches', () => {
    expect(matchAdvance(row({ invoice_number: 'kfs 1001' }), book)).toMatchObject({ kind: 'match', existing: { id: 'a' }, fuzzy: true });
    expect(matchAdvance(row({ advanced_on: '2026-01-13', face_amount: 48520 }), book)).toMatchObject({ kind: 'match', existing: { id: 'a' } });
  });
  it('a typo in the invoice # matches only when date and amount agree', () => {
    expect(matchAdvance(row({ invoice_number: 'KFS-1O01' }), book)).toMatchObject({ kind: 'match', existing: { id: 'a' }, fuzzy: true });
    expect(matchAdvance(row({ invoice_number: 'KFS-1002' }), book)).toMatchObject({ kind: 'match', existing: { id: 'a' }, fuzzy: true });
    expect(matchAdvance(row({ invoice_number: 'KFS-1002', face_amount: 50000 }), book)).toMatchObject({ kind: 'none' });
    expect(matchAdvance(row({ invoice_number: 'KFS-1002', advanced_on: '2026-02-20' }), book)).toMatchObject({ kind: 'none' });
  });
  it('the same invoice # months later is a separate advance, with a warning', () => {
    const r = matchAdvance(row({ advanced_on: '2026-06-10' }), book);
    expect(r.kind).toBe('none');
    expect(r.kind === 'none' && r.warning).toMatch(/also advanced on 2026-01-10/);
  });
  it('without an invoice #, matches on date, amount and agency', () => {
    expect(matchAdvance(row({ invoice_number: null, advanced_on: '2026-02-03', face_amount: 18750, creditor: 'GSA Region 3' }), book))
      .toMatchObject({ kind: 'match', existing: { id: 'c' } });
    // An invoice # now filled in for an advance first imported without one.
    expect(matchAdvance(row({ invoice_number: 'KFS-1012', advanced_on: '2026-02-03', face_amount: 18750, creditor: 'GSA Region 3' }), book))
      .toMatchObject({ kind: 'match', existing: { id: 'c' } });
    expect(matchAdvance(row({ invoice_number: null, advanced_on: '2026-02-03', face_amount: 18750, creditor: 'PennDOT' }), book))
      .toMatchObject({ kind: 'none' });
  });
  it('a genuinely new invoice is new', () => {
    expect(matchAdvance(row({ invoice_number: 'KFS-1099', advanced_on: '2026-05-01', face_amount: 12000 }), book))
      .toEqual({ kind: 'none', warning: null });
  });
  it('never guesses between two equally good candidates', () => {
    const twins: ExistingAdvance[] = [
      { id: 'x', invoice_number: '500', advanced_on: '2026-04-01', face_amount: 1000, debtor_name: 'A' },
      { id: 'y', invoice_number: '0500', advanced_on: '2026-04-03', face_amount: 1000, debtor_name: 'A' },
    ];
    expect(matchAdvance({ invoice_number: '500', advanced_on: '2026-04-02', face_amount: 1000, creditor: 'A' }, twins).kind).toBe('ambiguous');
  });
});
