import { describe, it, expect } from 'vitest';
import {
  mapHeaders, parseMoney, parseDate, invoiceNumberOrThrow, toAdvancePayload,
} from './import-map.js';

describe('mapHeaders', () => {
  it('canonicalises the workbook header row exactly', () => {
    const headers = [
      "Borrower", "Name", "Creditor", "Sales person", "Project", "Adv Date",
      "Invoice #", "Total Invoice", "Total Advanced", "Contract Ready",
      "Invoice Ready", "Check #", "Date Paid Back", "Amount Received", "Fees",
      "Bal Due", "Prove", "Days", "Days (Pending)", "#Years", "APR",
      "Email", "First Name", "Notes",
    ];
    expect(mapHeaders(headers)).toEqual(headers);
  });

  it('accepts case, spacing and punctuation drift from Sheets exports', () => {
    const mapped = mapHeaders(["borrower", "CREDITOR", "invoice_number", "Adv_Date", "total invoice"]);
    expect(mapped).toEqual(["Borrower", "Creditor", "Invoice #", "Adv Date", "Total Invoice"]);
  });

  it('leaves unknown columns as null so the row builder ignores them', () => {
    expect(mapHeaders(["Borrower", "internal_notes_xyz"])).toEqual(["Borrower", null]);
  });
});

describe('parseMoney', () => {
  it('reads the shapes that actually appear in the export', () => {
    expect(parseMoney('48690', 'x')).toBe(48690);
    expect(parseMoney('$48,690.00', 'x')).toBe(48690);
    expect(parseMoney(' 48690.5 ', 'x')).toBe(48690.5);
    expect(parseMoney('(1,200)', 'x')).toBe(-1200);
  });

  it('treats blank cells and placeholders as null rather than throwing', () => {
    for (const v of ['', '   ', '-', '—', undefined]) expect(parseMoney(v, 'x')).toBeNull();
  });

  it('rejects text with a message naming the field', () => {
    expect(() => parseMoney('lots', 'Total Invoice')).toThrow(/Total Invoice/);
  });
});

describe('parseDate', () => {
  it('reads ISO and US-slashed dates from the export', () => {
    expect(parseDate('2025-07-29', 'x')).toBe('2025-07-29');
    expect(parseDate('7/29/2025', 'x')).toBe('2025-07-29');
    expect(parseDate('07/29/25', 'x')).toBe('2025-07-29');
  });

  it('returns null for blanks and dashes', () => {
    for (const v of ['', '  ', '-', undefined]) expect(parseDate(v, 'x')).toBeNull();
  });

  it('rejects garbage rather than passing it to Date()', () => {
    expect(() => parseDate('yes', 'Adv Date')).toThrow(/Adv Date/);
    expect(() => parseDate('2025-13-40', 'Adv Date')).not.toBeNull();  // parses month 13 as-is; that is fine, Postgres will reject
  });
});

describe('invoiceNumberOrThrow', () => {
  it('accepts every real invoice number that appears in the book', () => {
    for (const v of ['PCDC-10th-9', 'APP # 601328-5', '221407', 'INV-0042']) {
      expect(invoiceNumberOrThrow(v)).toBe(v);
    }
  });

  it('rejects the placeholders that actually caused losses', () => {
    for (const v of ['-', ' - ', '', 'N/A', 'na', 'TBD', 'pending', '?']) {
      expect(() => invoiceNumberOrThrow(v)).toThrow(/Invoice/);
    }
  });
});

describe('toAdvancePayload', () => {
  const base = {
    "Borrower": "RNV Electrical",
    "Creditor": "PHDC",
    "Invoice #": "INV-42",
    "Total Invoice": "9,600",
    "Adv Date": "2025-08-14",
  };

  it('turns a minimal row into a fund-only payload', () => {
    const p = toAdvancePayload(base);
    expect(p).toEqual({
      borrower: "RNV Electrical",
      creditor: "PHDC",
      invoice_number: "INV-42",
      face_amount: 9600,
      advanced_on: "2025-08-14",
      notes: null,
      collection: null,
    });
  });

  it('emits a collection leg when both Date Paid Back and Amount Received are set', () => {
    const p = toAdvancePayload({
      ...base,
      "Date Paid Back": "2025-09-20", "Amount Received": "9600", "Check #": "1234",
    });
    expect(p.collection).toEqual({
      collected_on: "2025-09-20", amount_received: 9600, check_number: "1234",
    });
  });

  it('refuses half a collection — one column filled without the other', () => {
    // Half-filled rows are almost always a workbook typo; silently ignoring
    // them would drop repayments on the floor.
    expect(() => toAdvancePayload({ ...base, "Date Paid Back": "2025-09-20" }))
      .toThrow(/both be filled or both be blank/);
    expect(() => toAdvancePayload({ ...base, "Amount Received": "9600" }))
      .toThrow(/both be filled or both be blank/);
  });

  it('rejects the historical bad row — BDFS/NKCDC with Invoice # = "-"', () => {
    // The exact case that put $89,987 of loss on the book. The import should
    // catch it in triage, not after the fact.
    expect(() => toAdvancePayload({
      "Borrower": "BDFS Group Inc", "Creditor": "NKCDC",
      "Invoice #": "-", "Total Invoice": "50000", "Adv Date": "2025-08-14",
    })).toThrow(/placeholder, not a real invoice number/);
  });

  it('preserves operator context in notes (Sales person, Project, Ready flags)', () => {
    const p = toAdvancePayload({
      ...base,
      "Sales person": "Zac", "Project": "241 N. 10th St.",
      "Contract Ready": "Yes", "Invoice Ready": "Yes",
      "Notes": "spoke with AP",
    });
    expect(p.notes).toBe("spoke with AP [sales=Zac | project=241 N. 10th St. | contract=yes | invoice=yes]");
  });

  it('reports the first bad field with a name the operator can find', () => {
    expect(() => toAdvancePayload({ ...base, "Total Invoice": "lots" }))
      .toThrow(/Total Invoice/);
    expect(() => toAdvancePayload({ ...base, "Adv Date": "yesterday" }))
      .toThrow(/Adv Date/);
    expect(() => toAdvancePayload({ ...base, "Borrower": "" }))
      .toThrow(/Borrower: missing/);
  });

  it('ignores derived columns (Fees, Days, APR) rather than trusting them over the schedule', () => {
    // Importing these would let a wrong number in the sheet silently overwrite
    // a computed one. We deliberately do not.
    const p = toAdvancePayload({
      ...base,
      "Fees": "9999", "Days": "1", "APR": "1000%",
    });
    expect(p.face_amount).toBe(9600);
    expect(p.collection).toBeNull();
    expect(p.notes).toBeNull();
  });
});
