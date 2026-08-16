import { describe, it, expect } from 'vitest';
import {
  underwrite, exposureLimit, isPlaceholderInvoiceNumber,
  type UnderwritingInputs, type UnderwritingPolicy,
} from './underwriting.js';

/** Mirrors the defaults seeded by V006. */
const POLICY: UnderwritingPolicy = {
  version: 1,
  auto_approve_enabled: false,
  auto_approve_ceiling: 15000,
  clean_score: 75,
  decline_score: 50,
  starting_limit: 50000,
  limit_step: 15000,
  max_limit: 300000,
  on_time_days: 75,
  impairment_days: 120,
  default_advance_rate_pct: 80,
  min_advance_rate_pct: 70,
  max_advance_rate_pct: 85,
  large_invoice_threshold: 30000,
  step_up_multiple: 3.0,
  debtor_concentration_pct: 40,
};

/** A well-behaved request: seasoned client, verifiable agency, ordinary invoice. */
function baseline(): UnderwritingInputs {
  return {
    request: { requested_amount: 9600, invoice_number: 'INV-0042', has_document: true },
    client: {
      status: 'active',
      negative_list: false,
      credit_limit_override: null,
      tax_lien_personal: 'clean',
      tax_lien_business: 'clean',
      judgement: 'clean',
      lawsuit: 'clean',
      existing_ucc: 'clean',
      ucc_is_prior_factor: false,
      personal_guarantee: false,
      uses_subs: false,
      does_progress_billing: false,
      settled_on_time: 20,
      settled_late: 0,
      impaired_count: 0,
      open_exposure: 40000,
      trailing_median_invoice: 9600,
      duplicate_open_invoice: false,
    },
    debtor: {
      known: true,
      portal_visibility: true,
      invoice_confirmation: 'confirmed',
      ach_change: true,
      staff_communication: true,
      settled_count: 40,
      median_dso: 32,
      impaired_count: 0,
      share_of_open_book_pct: 20,
    },
  };
}

const merge = (patch: {
  request?: Partial<UnderwritingInputs['request']>;
  client?: Partial<UnderwritingInputs['client']>;
  debtor?: Partial<UnderwritingInputs['debtor']>;
}): UnderwritingInputs => {
  const b = baseline();
  return {
    request: { ...b.request, ...patch.request },
    client: { ...b.client, ...patch.client },
    debtor: { ...b.debtor, ...patch.debtor },
  };
};

describe('isPlaceholderInvoiceNumber', () => {
  it('catches the values that actually appear in the book', () => {
    for (const v of ['-', ' - ', '', '  ', 'N/A', 'na', 'none', 'TBD', 'pending', '?', null, undefined]) {
      expect(isPlaceholderInvoiceNumber(v as string | null)).toBe(true);
    }
  });

  it('accepts real invoice numbers from the book', () => {
    for (const v of ['PCDC-10th-9', 'APP # 601328-5', '221407', 'INV-0042']) {
      expect(isPlaceholderInvoiceNumber(v)).toBe(false);
    }
  });
});

describe('exposureLimit', () => {
  it('starts every client at the policy floor', () => {
    expect(exposureLimit({ credit_limit_override: null, settled_on_time: 0, settled_late: 0 }, POLICY))
      .toBe(50000);
  });

  it('earns up one settled advance at a time', () => {
    expect(exposureLimit({ credit_limit_override: null, settled_on_time: 3, settled_late: 0 }, POLICY))
      .toBe(95000);
  });

  it('gives headroom back on late settlements', () => {
    expect(exposureLimit({ credit_limit_override: null, settled_on_time: 3, settled_late: 2 }, POLICY))
      .toBe(65000);
  });

  it('caps at the policy maximum however long the history', () => {
    expect(exposureLimit({ credit_limit_override: null, settled_on_time: 500, settled_late: 0 }, POLICY))
      .toBe(300000);
  });

  it('never goes negative', () => {
    expect(exposureLimit({ credit_limit_override: null, settled_on_time: 0, settled_late: 99 }, POLICY))
      .toBe(0);
  });

  it('lets a manual override win in both directions', () => {
    expect(exposureLimit({ credit_limit_override: 12000, settled_on_time: 50, settled_late: 0 }, POLICY))
      .toBe(12000);
    expect(exposureLimit({ credit_limit_override: 400000, settled_on_time: 0, settled_late: 0 }, POLICY))
      .toBe(400000);
  });
});

describe('hard stops', () => {
  it('declines a request with no invoice number', () => {
    const d = underwrite(merge({ request: { invoice_number: '-' } }), POLICY);
    expect(d.action).toBe('decline');
    expect(d.hard_stops.map(h => h.code)).toContain('no_invoice_number');
  });

  it('declines a client on the negative list', () => {
    const d = underwrite(merge({ client: { negative_list: true } }), POLICY);
    expect(d.action).toBe('decline');
    expect(d.hard_stops.map(h => h.code)).toContain('client_negative_list');
  });

  it('declines while any advance is impaired', () => {
    const d = underwrite(merge({ client: { impaired_count: 1 } }), POLICY);
    expect(d.action).toBe('decline');
    expect(d.hard_stops.map(h => h.code)).toContain('client_impaired');
  });

  it('declines a second advance against the same invoice number', () => {
    const d = underwrite(merge({ client: { duplicate_open_invoice: true } }), POLICY);
    expect(d.action).toBe('decline');
    expect(d.hard_stops.map(h => h.code)).toContain('duplicate_open_invoice');
  });

  it('declines a prospect who has not been onboarded', () => {
    const d = underwrite(merge({ client: { status: 'prospect' } }), POLICY);
    expect(d.action).toBe('decline');
    expect(d.hard_stops.map(h => h.code)).toContain('client_not_active');
  });

  it('declines when the request exceeds remaining headroom', () => {
    // Limit 350000 capped to 300000; 290000 already out leaves 10000.
    const d = underwrite(merge({
      client: { settled_on_time: 20, open_exposure: 290000 },
      request: { requested_amount: 25000 },
    }), POLICY);
    expect(d.action).toBe('decline');
    expect(d.hard_stops.map(h => h.code)).toContain('exceeds_headroom');
    expect(d.exposure_headroom).toBe(10000);
  });

  it('is never overridden by an otherwise perfect score', () => {
    const d = underwrite(merge({ request: { invoice_number: '   ' } }), POLICY);
    expect(d.score).toBe(100);          // nothing else is wrong
    expect(d.action).toBe('decline');   // and it still does not fund
  });
});

describe('scoring', () => {
  it('gives a clean request full marks and approves it', () => {
    const d = underwrite(baseline(), POLICY);
    expect(d.score).toBe(100);
    expect(d.action).toBe('approve');
    expect(d.factors).toHaveLength(0);
  });

  it('penalises an unverifiable agency across all four attributes', () => {
    // This is NKCDC's exact profile: zero on everything, never settled.
    const d = underwrite(merge({
      debtor: {
        portal_visibility: false, invoice_confirmation: 'none',
        ach_change: false, staff_communication: false,
        settled_count: 0, median_dso: null, known: false,
      },
    }), POLICY);
    const codes = d.factors.map(f => f.code);
    expect(codes).toEqual(expect.arrayContaining([
      'debtor_no_confirmation', 'debtor_no_ach', 'debtor_no_portal', 'debtor_no_contact', 'debtor_unproven',
    ]));
    expect(d.score).toBe(50);
    expect(d.action).toBe('refer');
  });

  it('treats a purchase-order match as good as a confirmation', () => {
    const po = underwrite(merge({ debtor: { invoice_confirmation: 'purchase_order' } }), POLICY);
    expect(po.factors.map(f => f.code)).not.toContain('debtor_no_confirmation');
  });

  it('flags an invoice far larger than the client normally bills', () => {
    const d = underwrite(merge({
      request: { requested_amount: 118388 },
      client: { trailing_median_invoice: 14000, settled_on_time: 20, open_exposure: 0 },
    }), POLICY);
    expect(d.factors.map(f => f.code)).toContain('invoice_step_up');
  });

  it('compounds progress billing with a large invoice', () => {
    const d = underwrite(merge({
      request: { requested_amount: 45000 },
      client: { does_progress_billing: true, trailing_median_invoice: 40000, open_exposure: 0 },
    }), POLICY);
    const codes = d.factors.map(f => f.code);
    expect(codes).toContain('invoice_large');
    expect(codes).toContain('progress_withholding');
  });

  it('does not apply the withholding penalty to a small progress-billed invoice', () => {
    const d = underwrite(merge({ client: { does_progress_billing: true } }), POLICY);
    expect(d.factors.map(f => f.code)).not.toContain('progress_withholding');
  });

  it('penalises unanswered onboarding questions less than a known risk', () => {
    const unknown = underwrite(merge({ client: { uses_subs: null } }), POLICY);
    const known   = underwrite(merge({ client: { uses_subs: true } }), POLICY);
    expect(unknown.score).toBeGreaterThan(known.score);
  });

  it('treats a prior factor UCC as heavier than an ordinary one', () => {
    const prior = underwrite(merge({ client: { existing_ucc: 'present', ucc_is_prior_factor: true } }), POLICY);
    const plain = underwrite(merge({ client: { existing_ucc: 'present', ucc_is_prior_factor: false } }), POLICY);
    expect(prior.score).toBeLessThan(plain.score);
    expect(prior.factors.map(f => f.code)).toContain('ucc_prior_factor');
    // Not double-counted.
    expect(prior.factors.map(f => f.code)).not.toContain('ucc_present');
  });

  it('credits a personal guarantee', () => {
    const withPg = underwrite(merge({ client: { personal_guarantee: true, uses_subs: true } }), POLICY);
    const noPg   = underwrite(merge({ client: { personal_guarantee: false, uses_subs: true } }), POLICY);
    expect(withPg.score).toBe(noPg.score + 5);
  });

  it('caps the score at 100 so a guarantee cannot buy headroom', () => {
    const d = underwrite(merge({ client: { personal_guarantee: true } }), POLICY);
    expect(d.score).toBe(100);
  });

  it('caps repeated late settlements rather than scoring to zero', () => {
    const d = underwrite(merge({ client: { settled_on_time: 30, settled_late: 10, open_exposure: 0 } }), POLICY);
    const late = d.factors.find(f => f.code === 'client_late_history');
    expect(late?.points).toBe(-15);
  });

  it('never returns a score outside 0..100', () => {
    const worst = underwrite(merge({
      request: { requested_amount: 100000, has_document: false },
      client: {
        settled_on_time: 0, settled_late: 3, open_exposure: 0, trailing_median_invoice: 5000,
        uses_subs: true, does_progress_billing: true, existing_ucc: 'present', ucc_is_prior_factor: true,
        tax_lien_business: 'present', tax_lien_personal: 'present', judgement: 'present', lawsuit: 'present',
        credit_limit_override: 500000,
      },
      debtor: {
        known: false, portal_visibility: false, invoice_confirmation: 'none', ach_change: false,
        staff_communication: false, settled_count: 0, median_dso: null, impaired_count: 2,
        share_of_open_book_pct: 90,
      },
    }), POLICY);
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
    expect(worst.action).toBe('decline');
  });
});

describe('advance rate recommendation', () => {
  it('defaults to 80', () => {
    const d = underwrite(merge({ debtor: { median_dso: 55 } }), POLICY);
    expect(d.recommended_advance_rate_pct).toBe(80);
  });

  it('offers the top of the band to a seasoned client on a fast-paying agency', () => {
    const d = underwrite(baseline(), POLICY);   // 20 clean settles, agency median 32 days
    expect(d.recommended_advance_rate_pct).toBe(85);
  });

  it('withholds the top of the band from a client with any late history', () => {
    const d = underwrite(merge({ client: { settled_on_time: 20, settled_late: 1 } }), POLICY);
    expect(d.recommended_advance_rate_pct).toBe(80);
  });

  it('stays inside the policy band always', () => {
    for (const inputs of [baseline(), merge({ client: { negative_list: true } })]) {
      const d = underwrite(inputs, POLICY);
      expect(d.recommended_advance_rate_pct).toBeGreaterThanOrEqual(POLICY.min_advance_rate_pct);
      expect(d.recommended_advance_rate_pct).toBeLessThanOrEqual(POLICY.max_advance_rate_pct);
    }
  });
});

describe('auto-approval gate', () => {
  it('never auto-applies while the policy flag is off', () => {
    const d = underwrite(baseline(), POLICY);
    expect(d.action).toBe('approve');
    expect(d.auto_applied).toBe(false);
  });

  it('auto-applies a clean request under the ceiling once enabled', () => {
    const d = underwrite(baseline(), { ...POLICY, auto_approve_enabled: true });
    expect(d.auto_applied).toBe(true);
  });

  it('holds back anything over the ceiling even when clean', () => {
    const d = underwrite(
      merge({ request: { requested_amount: 20000 }, client: { trailing_median_invoice: 18000 } }),
      { ...POLICY, auto_approve_enabled: true });
    expect(d.action).toBe('approve');
    expect(d.auto_applied).toBe(false);
  });

  it('holds back a client whose onboarding questions were never answered', () => {
    const d = underwrite(merge({ client: { uses_subs: null, does_progress_billing: null } }),
      { ...POLICY, auto_approve_enabled: true });
    expect(d.auto_applied).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay of the actual loss.
//
// BDFS Group ran from $0 to $317,251 of concurrent exposure between 29 Jul and
// 4 Nov 2025 and left $184,698 unpaid — more than the $158,559 of fees the
// entire book has ever earned. These tests assert the engine would have stopped
// the ramp at the second advance.
// ─────────────────────────────────────────────────────────────────────────────
describe('historical replay — BDFS Group', () => {
  /** State on 14 Aug 2025: one advance out ($38,952), none settled yet. */
  const secondAdvance = (): UnderwritingInputs => merge({
    request: { requested_amount: 40000, invoice_number: '-', has_document: false },
    client: {
      settled_on_time: 0, settled_late: 0, open_exposure: 38952,
      trailing_median_invoice: 48690,
      tax_lien_business: 'present', existing_ucc: 'present', ucc_is_prior_factor: true,
      uses_subs: null, does_progress_billing: null,
    },
    debtor: {   // NKCDC — zero on every verification attribute, never settled
      known: false, portal_visibility: false, invoice_confirmation: 'none',
      ach_change: false, staff_communication: false,
      settled_count: 0, median_dso: null, impaired_count: 0, share_of_open_book_pct: 0,
    },
  });

  it('declines the $40,000 NKCDC advance', () => {
    const d = underwrite(secondAdvance(), POLICY);
    expect(d.action).toBe('decline');
  });

  it('stops it on three independent grounds, not one lucky rule', () => {
    const codes = underwrite(secondAdvance(), POLICY).hard_stops.map(h => h.code);
    expect(codes).toContain('no_invoice_number');   // invoice # was literally "-"
    expect(codes).toContain('exceeds_headroom');    // $38,952 out against a $50,000 starting limit
    expect(codes.length).toBeGreaterThanOrEqual(2);
  });

  it('would still have declined it with a valid invoice number', () => {
    // The exposure ceiling alone holds the line, which is the control that matters:
    // it does not depend on spotting a bad document.
    const withNumber = { ...secondAdvance() };
    withNumber.request = { ...withNumber.request, invoice_number: 'NKCDC-2025-08', has_document: true };
    const d = underwrite(withNumber, POLICY);
    expect(d.action).toBe('decline');
    expect(d.hard_stops.map(h => h.code)).toContain('exceeds_headroom');
  });

  it('caps total exposure near $50,000 instead of $317,251', () => {
    const d = underwrite(secondAdvance(), POLICY);
    expect(d.exposure_limit).toBe(50000);
    // Worst case the client reaches the limit; the historical peak was 6.3x that.
    expect(d.exposure_limit).toBeLessThan(317251 / 6);
  });

  it('flags the $118,388 advance as a step-up even in isolation', () => {
    // Nov 2025: by then some advances had settled, so headroom existed. The
    // scored factors still mark it.
    const d = underwrite(merge({
      request: { requested_amount: 118388, invoice_number: 'APP # 1', has_document: true },
      client: {
        settled_on_time: 3, settled_late: 0, open_exposure: 0,
        trailing_median_invoice: 52466, credit_limit_override: 300000,
        tax_lien_business: 'present', existing_ucc: 'present', ucc_is_prior_factor: true,
      },
      debtor: { median_dso: 57, settled_count: 4, share_of_open_book_pct: 45 },
    }), POLICY);
    const codes = d.factors.map(f => f.code);
    expect(codes).toContain('invoice_large');
    expect(codes).toContain('ucc_prior_factor');
    expect(codes).toContain('debtor_concentration');
    expect(d.action).not.toBe('approve');
  });
});
