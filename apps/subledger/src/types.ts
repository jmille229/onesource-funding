export type TradeKey =
  | "concrete"
  | "carpentry"
  | "plumbing"
  | "hvac"
  | "electric"
  | "roofing"
  | "sitework";

export type Cert = "—" | "MBE" | "WBE" | "WBE / MBE" | "DBE" | "SDVOSB";

export type SubStatus = "Not started" | "In progress" | "Complete";

/** A bill the sub has sent you (a sub invoice) against their subcontract. */
export interface Bill {
  id: number;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  amount: number;
  note?: string;
}

/** Cash you have actually paid the sub. */
export interface Payment {
  id: number;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  amount: number;
  note?: string;
}

export interface Subcontract {
  id: number;
  firm: string;
  trade: TradeKey;
  costCode: string;
  /** Committed subcontract value (the total you owe if they finish the scope). */
  amount: number;
  retainagePct: number;
  /** Sub invoices received. Billed-to-date is the sum of these. */
  bills: Bill[];
  /** Cash paid out. Paid-to-date is the sum of these. */
  payments: Payment[];
  /** ISO date (yyyy-mm-dd). */
  start: string;
  /** ISO date (yyyy-mm-dd). */
  finish: string;
  status: SubStatus;
  scope: string;
  permits: string;
  cert: Cert;
  /** Insurance certificate expiry, ISO date. `null` means none on file (unknown coverage). */
  coi: string | null;
  w9: boolean;
  contact: string;
}

export interface Project {
  number: string;
  name: string;
  address: string;
  client: string;
  contractValue: number;
  start: string;
  finish: string;
}
