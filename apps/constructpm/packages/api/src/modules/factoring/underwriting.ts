/**
 * Underwriting decision engine.
 *
 * A pure function: inputs and policy in, a decision out. No database, no clock,
 * no I/O — so every rule can be tested against the historical advance book and
 * a decision can be replayed exactly as it was made.
 *
 * Calibrated against OneSource's book (339 advances, 17 clients, 16 creditors,
 * Jul 2025 – Aug 2026). Three findings drove the design:
 *
 *   • $184,698 sits unpaid from one client who ramped to $317,251 of concurrent
 *     exposure in 14 weeks. Lifetime fees across the entire book are $158,559 —
 *     one unchecked client cost more than every fee ever earned.
 *   • Both advances written with no invoice number are unpaid. $89,987, a 100%
 *     loss rate on a signal that costs nothing to check.
 *   • Their creditor is the only one in the book scoring zero on all four
 *     verification attributes OneSource already tracks, and is 0-for-2 on
 *     repayment.
 *
 * The engine therefore leads with hard stops, governs total exposure with a
 * limit that has to be earned, and scores the remainder in factors an operator
 * can read and disagree with.
 */

export interface UnderwritingPolicy {
  version: number;
  auto_approve_enabled: boolean;
  auto_approve_ceiling: number;
  clean_score: number;
  decline_score: number;
  starting_limit: number;
  limit_step: number;
  max_limit: number;
  on_time_days: number;
  impairment_days: number;
  default_advance_rate_pct: number;
  min_advance_rate_pct: number;
  max_advance_rate_pct: number;
  large_invoice_threshold: number;
  step_up_multiple: number;
  debtor_concentration_pct: number;
}

export type ScreeningStatus = 'unknown' | 'clean' | 'present';
export type InvoiceConfirmation = 'none' | 'confirmed' | 'purchase_order';

export interface UnderwritingInputs {
  /** What is being asked for. */
  request: {
    requested_amount: number;
    invoice_number: string | null;
    /** True when the client has attached a copy. Operator-keyed requests carry the emailed document instead. */
    has_document: boolean;
  };

  client: {
    status: string;                     // factoring_client_status
    negative_list: boolean;
    credit_limit_override: number | null;
    tax_lien_personal: ScreeningStatus;
    tax_lien_business: ScreeningStatus;
    judgement: ScreeningStatus;
    lawsuit: ScreeningStatus;
    existing_ucc: ScreeningStatus;
    ucc_is_prior_factor: boolean;
    personal_guarantee: boolean;
    uses_subs: boolean | null;          // null = never asked
    does_progress_billing: boolean | null;
    /** Advances settled within policy.on_time_days. */
    settled_on_time: number;
    /** Advances settled late. */
    settled_late: number;
    /** Open advances aged beyond policy.impairment_days. */
    impaired_count: number;
    /** Currently outstanding advance principal for this client. */
    open_exposure: number;
    /** Median face amount of this client's prior invoices; null when they have none. */
    trailing_median_invoice: number | null;
    /** An open advance already exists against this invoice number. */
    duplicate_open_invoice: boolean;
  };

  debtor: {
    known: boolean;                     // false when we have never dealt with this agency
    portal_visibility: boolean;
    invoice_confirmation: InvoiceConfirmation;
    ach_change: boolean;
    staff_communication: boolean;
    settled_count: number;
    median_dso: number | null;
    /** Open advances against this debtor aged beyond policy.impairment_days. */
    impaired_count: number;
    /** This debtor's share of the whole open book, as a percentage. */
    share_of_open_book_pct: number;
  };
}

export interface Factor {
  code: string;
  label: string;
  /** Negative reduces the score. */
  points: number;
}

export interface HardStop {
  code: string;
  label: string;
}

export type UnderwritingAction = 'approve' | 'refer' | 'decline';

export interface UnderwritingDecision {
  score: number;
  action: UnderwritingAction;
  /** True when policy allows the engine to act without a human on this request. */
  auto_applied: boolean;
  /** Conditions that are never funded, whatever the score says. */
  hard_stops: HardStop[];
  /**
   * Conditions that require a human but are routinely fine.
   *
   * Kept separate from hard stops because the distinction is expensive to get
   * wrong in either direction. Replaying the book with the exposure ceiling as a
   * hard decline blocks $35,776 of fees from clients who repaid without issue —
   * $28,834 of it from a single good client — to stop one bad one. Those are
   * conversations to have, not advances to refuse.
   */
  referrals: HardStop[];
  factors: Factor[];
  recommended_advance_rate_pct: number;
  exposure_limit: number;
  exposure_current: number;
  exposure_headroom: number;
}

const PLACEHOLDER_INVOICE = new Set(['', '-', '--', 'n/a', 'na', 'none', 'tbd', 'pending', '?']);

/** An invoice number that is missing or a placeholder. Both such advances in the book are unpaid. */
export function isPlaceholderInvoiceNumber(n: string | null | undefined): boolean {
  if (n === null || n === undefined) return true;
  return PLACEHOLDER_INVOICE.has(n.trim().toLowerCase());
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The graduated exposure ceiling.
 *
 * Every client starts at the same limit and earns headroom one settled advance
 * at a time; a late settlement gives some back.
 *
 * On the two parameters: the $50,000 starting limit is OneSource's existing
 * policy for new clients. The step is **not** — there is no formal step today,
 * so it was derived by replaying the book. Any step below roughly $100,000
 * avoids the entire historical loss (the starting limit does that work, not the
 * step); above it, one settled advance buys enough headroom for the $94,710
 * advance that went bad. $25,000 sits well clear of that cliff while letting a
 * client reach the exposure good clients actually ran at within a few
 * settlements. It is a proposal to tune, not an observed constant.
 *
 * A manually set limit on the client record always wins, so an operator can
 * override in either direction without fighting the formula.
 */
export function exposureLimit(
  client: Pick<UnderwritingInputs['client'], 'credit_limit_override' | 'settled_on_time' | 'settled_late'>,
  policy: UnderwritingPolicy,
): number {
  if (client.credit_limit_override !== null && client.credit_limit_override !== undefined) {
    return round2(clamp(client.credit_limit_override, 0, Number.MAX_SAFE_INTEGER));
  }
  const earned = client.settled_on_time - client.settled_late;
  const limit = policy.starting_limit + policy.limit_step * earned;
  return round2(clamp(limit, 0, policy.max_limit));
}

export function underwrite(inputs: UnderwritingInputs, policy: UnderwritingPolicy): UnderwritingDecision {
  const { request, client, debtor } = inputs;

  const limit = exposureLimit(client, policy);
  const current = round2(client.open_exposure);
  const headroom = round2(Math.max(0, limit - current));

  // ── Hard stops ───────────────────────────────────────────────────────────
  // Signals that have never produced a good outcome, or that make the advance
  // structurally unsafe. These are not scored — no combination of positives
  // argues them away.
  const hard_stops: HardStop[] = [];
  // Conditions that need a person but are frequently fine. See UnderwritingDecision.
  const referrals: HardStop[] = [];

  if (isPlaceholderInvoiceNumber(request.invoice_number)) {
    hard_stops.push({
      code: 'no_invoice_number',
      label: 'No invoice number. Both advances written this way in the historical book are unpaid.',
    });
  }
  if (client.negative_list) {
    hard_stops.push({ code: 'client_negative_list', label: 'Client is on the negative list.' });
  }
  if (client.status !== 'active') {
    hard_stops.push({ code: 'client_not_active', label: `Client status is "${client.status}", not active.` });
  }
  if (client.impaired_count > 0) {
    hard_stops.push({
      code: 'client_impaired',
      label: `Client has ${client.impaired_count} advance(s) outstanding beyond ${policy.impairment_days} days.`,
    });
  }

  // A second advance against an open invoice number is double-pledging — unless
  // the client bills progress applications, where successive draws against the
  // same application number are ordinary practice. Same fact, opposite meaning,
  // so the client's billing method decides which it is.
  if (client.duplicate_open_invoice) {
    const entry = {
      code: 'duplicate_open_invoice',
      label: client.does_progress_billing === true
        ? 'An advance is already open against this invoice number. Expected on progress applications — confirm this is a later draw, not the same one twice.'
        : 'An advance is already open against this invoice number.',
    };
    if (client.does_progress_billing === true) referrals.push(entry);
    else hard_stops.push(entry);
  }

  // Exceeding the ceiling is a conversation, not a refusal. Replayed against the
  // book, treating it as a decline would have blocked 8 of one good client's 17
  // advances and $35,776 of fees on business that repaid in full.
  if (request.requested_amount > headroom) {
    referrals.push({
      code: 'exceeds_headroom',
      label: `Request of ${request.requested_amount.toFixed(2)} exceeds available headroom of ${headroom.toFixed(2)} ` +
             `(limit ${limit.toFixed(2)}, currently out ${current.toFixed(2)}).`,
    });
  }

  // ── Scored factors ───────────────────────────────────────────────────────
  const factors: Factor[] = [];
  const deduct = (code: string, label: string, points: number) => {
    if (points !== 0) factors.push({ code, label, points });
  };

  // Debtor verifiability. The heaviest block, because it is the strongest
  // predictor in the data: can we confirm the invoice is real, and can we be
  // paid directly rather than relying on the client to forward the money?
  if (debtor.invoice_confirmation === 'none') {
    deduct('debtor_no_confirmation', 'Agency will not confirm invoices.', -20);
  }
  if (!debtor.ach_change) {
    deduct('debtor_no_ach', 'Agency will not redirect remittance to us — the client receives the funds.', -12);
  }
  if (!debtor.portal_visibility) {
    deduct('debtor_no_portal', 'No portal visibility into invoice or payment status.', -4);
  }
  if (!debtor.staff_communication) {
    deduct('debtor_no_contact', 'No working staff contact at the agency.', -4);
  }

  // Debtor track record with us.
  if (!debtor.known || debtor.settled_count === 0) {
    deduct('debtor_unproven', 'No advance against this agency has ever settled.', -10);
  } else if (debtor.median_dso !== null) {
    if (debtor.median_dso > 90) {
      deduct('debtor_very_slow', `Agency median ${Math.round(debtor.median_dso)} days to pay.`, -10);
    } else if (debtor.median_dso > 60) {
      deduct('debtor_slow', `Agency median ${Math.round(debtor.median_dso)} days to pay.`, -5);
    }
  }
  if (debtor.impaired_count > 0) {
    deduct('debtor_impaired', `${debtor.impaired_count} advance(s) against this agency are impaired.`, -25);
  }
  if (debtor.share_of_open_book_pct > policy.debtor_concentration_pct) {
    deduct('debtor_concentration',
      `Agency already carries ${debtor.share_of_open_book_pct.toFixed(1)}% of the open book.`, -10);
  }

  // Client seasoning.
  const settledTotal = client.settled_on_time + client.settled_late;
  if (settledTotal === 0) {
    deduct('client_new', 'First advance for this client — no settled history.', -12);
  } else if (settledTotal <= 2) {
    deduct('client_thin', `Only ${settledTotal} settled advance(s) of history.`, -6);
  } else if (settledTotal <= 9) {
    deduct('client_developing', `${settledTotal} settled advances of history.`, -2);
  }
  if (client.settled_late > 0) {
    deduct('client_late_history',
      `${client.settled_late} advance(s) settled beyond ${policy.on_time_days} days.`,
      Math.max(-15, -5 * client.settled_late));
  }

  // Invoice shape.
  if (client.trailing_median_invoice !== null && client.trailing_median_invoice > 0) {
    const multiple = request.requested_amount / client.trailing_median_invoice;
    if (multiple >= policy.step_up_multiple) {
      deduct('invoice_step_up',
        `${multiple.toFixed(1)}x this client's typical invoice of ` +
        `${client.trailing_median_invoice.toFixed(0)}.`, -12);
    }
  }
  const isLarge = request.requested_amount > policy.large_invoice_threshold;
  if (isLarge) {
    deduct('invoice_large', `Above the ${policy.large_invoice_threshold.toFixed(0)} scrutiny threshold.`, -5);
  }
  // Progress billing carries withholding risk inherently: payment can be held
  // back for incomplete or non-conforming work on a draw that has already been
  // advanced against. The one realised loss in the book was a progress biller,
  // so the penalty applies to every progress-billed invoice and compounds above
  // the scrutiny threshold — but stays modest, because a single loss is thin
  // evidence and several good clients bill the same way.
  if (client.does_progress_billing === true) {
    deduct('progress_billing', 'Progress-billed work — payment can be withheld for incomplete performance.', -4);
    if (isLarge) {
      deduct('progress_withholding',
        'Large progress draw — the portion most often disputed at closeout.', -8);
    }
  }
  if (client.uses_subs === true) {
    deduct('uses_subs', 'Client uses subcontractors — unpaid subs create competing claims on this receivable.', -6);
  } else if (client.uses_subs === null) {
    deduct('subs_unknown', 'Never asked whether this client uses subcontractors.', -3);
  }
  if (client.does_progress_billing === null) {
    deduct('progress_unknown', 'Never asked whether this client bills progress payments.', -3);
  }
  if (!request.has_document) {
    deduct('no_document', 'No invoice copy on file.', -10);
  }

  // Client screening.
  if (client.ucc_is_prior_factor) {
    deduct('ucc_prior_factor',
      'A prior factor holds a UCC-1 — risk of the same receivable being pledged twice.', -15);
  } else if (client.existing_ucc === 'present') {
    deduct('ucc_present', 'An existing UCC-1 filing is on record.', -5);
  }
  if (client.tax_lien_business === 'present') deduct('lien_business', 'Business tax lien on record.', -8);
  if (client.tax_lien_personal === 'present') deduct('lien_personal', 'Personal tax lien on record.', -5);
  if (client.judgement === 'present')         deduct('judgement', 'Judgement on record.', -8);
  if (client.lawsuit === 'present')           deduct('lawsuit', 'Active lawsuit on record.', -5);
  if (client.personal_guarantee)              deduct('personal_guarantee', 'Personal guarantee in place.', +5);

  const raw = 100 + factors.reduce((sum, f) => sum + f.points, 0);
  const score = clamp(Math.round(raw), 0, 100);

  // ── Action ───────────────────────────────────────────────────────────────
  let action: UnderwritingAction;
  if (hard_stops.length > 0) {
    action = 'decline';
  } else if (score < policy.decline_score) {
    action = 'decline';
  } else if (referrals.length > 0) {
    // Never auto-approved, never auto-declined: a person decides.
    action = 'refer';
  } else if (score >= policy.clean_score) {
    action = 'approve';
  } else {
    action = 'refer';
  }

  // Auto-application is deliberately narrow: policy must allow it, the decision
  // must be clean, the amount must sit under the ceiling, and nothing may be
  // unknown about the client. With auto_approve_enabled off — the current
  // setting — every request still gets scored and banded, a human just confirms.
  const auto_applied =
    policy.auto_approve_enabled &&
    action === 'approve' &&
    hard_stops.length === 0 &&
    referrals.length === 0 &&
    request.requested_amount <= policy.auto_approve_ceiling &&
    client.uses_subs !== null &&
    client.does_progress_billing !== null;

  // ── Advance rate ─────────────────────────────────────────────────────────
  // 80% is the book's median and mean and stays the default. The engine only
  // recommends a band around it; the operator sets the number that ships.
  let rate = policy.default_advance_rate_pct;
  const seasoned = settledTotal >= 10 && client.settled_late === 0;
  const fastDebtor = debtor.median_dso !== null && debtor.median_dso <= 40 && debtor.settled_count >= 3;
  if (action === 'approve' && seasoned && fastDebtor) {
    rate = policy.max_advance_rate_pct;
  } else if (action === 'decline') {
    rate = policy.min_advance_rate_pct;
  }
  const recommended_advance_rate_pct = clamp(rate, policy.min_advance_rate_pct, policy.max_advance_rate_pct);

  return {
    score,
    action,
    auto_applied,
    hard_stops,
    referrals,
    factors,
    recommended_advance_rate_pct,
    exposure_limit: limit,
    exposure_current: current,
    exposure_headroom: headroom,
  };
}
