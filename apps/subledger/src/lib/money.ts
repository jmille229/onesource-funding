import type { Project, Subcontract } from "../types";

export interface SubTotals {
  /** Sum of all bills received. */
  billed: number;
  /** Retainage withheld from billings (retainagePct of billed). */
  held: number;
  /** Cash actually paid out. */
  paid: number;
  /** Approved and owed, net of retainage, not yet paid. */
  due: number;
  /** Committed value not yet billed. */
  remaining: number;
}

export function subTotals(s: Subcontract): SubTotals {
  const billed = s.bills.reduce((a, b) => a + b.amount, 0);
  const held = billed * (s.retainagePct / 100);
  const paid = s.payments.reduce((a, p) => a + p.amount, 0);
  const due = Math.max(0, billed - held - paid);
  const remaining = Math.max(0, s.amount - billed);
  return { billed, held, paid, due, remaining };
}

export interface ProjectTotals {
  committed: number;
  billed: number;
  held: number;
  paid: number;
  due: number;
  /** Committed but not yet billed. */
  unbilled: number;
  /** Committed beyond the owner contract value. */
  over: number;
  /** Contract value still uncommitted. */
  headroom: number;
  // Rail segments, clipped so nothing but the overrun crosses the contract line.
  segPaid: number;
  segDue: number;
  segHeld: number;
  segUnbilled: number;
}

export function projectTotals(subs: Subcontract[], project: Project): ProjectTotals {
  let committed = 0, billed = 0, held = 0, paid = 0, due = 0;
  for (const s of subs) {
    const t = subTotals(s);
    committed += s.amount;
    billed += t.billed;
    held += t.held;
    paid += t.paid;
    due += t.due;
  }
  const cv = project.contractValue;
  const unbilled = Math.max(0, committed - billed);
  const over = Math.max(0, committed - cv);

  const segPaid = Math.min(paid, cv);
  const segDue = Math.min(due, Math.max(0, cv - segPaid));
  const segHeld = Math.min(held, Math.max(0, cv - segPaid - segDue));
  const segUnbilled = Math.min(unbilled, Math.max(0, cv - segPaid - segDue - segHeld));

  return {
    committed, billed, held, paid, due, unbilled, over,
    headroom: Math.max(0, cv - committed),
    segPaid, segDue, segHeld, segUnbilled,
  };
}
