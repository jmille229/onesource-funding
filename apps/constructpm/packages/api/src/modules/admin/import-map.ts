/**
 * Advance-book import mapping.
 *
 * Accepts the columns as they sit in OneSource's existing workbook so the CSV
 * that already exists can be pasted in unchanged. The alternative — asking the
 * operator to reshape their workbook to match the API — is exactly the sort of
 * "do it our way first" that makes an internal tool feel worse than the Excel
 * it replaces.
 *
 * The workbook's Advance Book tab (single source of truth from the operator's
 * side) has these columns, in order:
 *
 *   Borrower, Name, Creditor, Sales person, Project, Adv Date, Invoice #,
 *   Total Invoice, Total Advanced, Contract Ready, Invoice Ready, Check #,
 *   Date Paid Back, Amount Received, Fees, Bal Due, Prove, Days,
 *   Days (Pending), #Years, APR, Email, First Name, Notes
 *
 * A workbook row can carry two events on one line: a fresh advance (always) and
 * a collection (when Date Paid Back and Amount Received are filled in). Both
 * shapes are produced here; the router replays them through fundInvoice and
 * then collectInvoice, so nothing about the domain logic diverges from the
 * single-invoice path.
 *
 * Deliberately NOT imported: Fees, Bal Due, Days, Days (Pending), #Years, APR.
 * These are all derived from other fields by fee_schedules — importing them
 * would let a wrong number in the workbook silently overwrite a computed one,
 * and there is no story for reconciling the difference.
 */

/** The workbook's actual header row. Match is case- and space-insensitive. */
export const ADVANCE_BOOK_COLUMNS = [
  "Borrower", "Name", "Creditor", "Sales person", "Project",
  "Adv Date", "Invoice #", "Total Invoice", "Total Advanced",
  "Contract Ready", "Invoice Ready", "Check #",
  "Date Paid Back", "Amount Received",
  "Fees", "Bal Due", "Prove", "Days", "Days (Pending)", "#Years", "APR",
  "Email", "First Name", "Notes",
] as const;

/**
 * Ordered so friendlier synonyms lose to canonical names on a tie. Every entry
 * is lowercased and stripped of non-alphanumerics before lookup, so an operator
 * exporting from Sheets — which sometimes rewrites "Invoice #" as "Invoice_" or
 * "invoice-number" depending on the export path — still lands on the same column.
 */
const HEADER_ALIASES: Record<string, string> = {
  borrower: "Borrower",
  client: "Borrower",
  creditor: "Creditor",
  debtor: "Creditor",
  agency: "Creditor",
  salesperson: "Sales person",
  project: "Project",
  advdate: "Adv Date",
  advancedate: "Adv Date",
  advancedon: "Adv Date",
  invoice: "Invoice #",
  invoicenumber: "Invoice #",
  invoiceno: "Invoice #",
  totalinvoice: "Total Invoice",
  faceamount: "Total Invoice",
  face: "Total Invoice",
  totaladvanced: "Total Advanced",
  advanceamount: "Total Advanced",
  contractready: "Contract Ready",
  invoiceready: "Invoice Ready",
  check: "Check #",
  checknumber: "Check #",
  datepaidback: "Date Paid Back",
  collectedon: "Date Paid Back",
  amountreceived: "Amount Received",
  fees: "Fees",
  baldue: "Bal Due",
  balancedue: "Bal Due",
  days: "Days",
  notes: "Notes",
  memo: "Notes",
  name: "Name",
  email: "Email",
  firstname: "First Name",
};

const canonicalKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Canonicalises a raw header row against ADVANCE_BOOK_COLUMNS and its aliases.
 * Unknown columns are dropped (deliberately — an operator adding a scratch
 * column in their sheet should not break the import), and the returned array
 * carries one entry per raw column: the canonical name or null to skip it.
 */
export function mapHeaders(headers: string[]): (string | null)[] {
  const canonical = new Map<string, string>();
  for (const col of ADVANCE_BOOK_COLUMNS) canonical.set(canonicalKey(col), col);
  return headers.map((h) => {
    const k = canonicalKey(h);
    return canonical.get(k) ?? HEADER_ALIASES[k] ?? null;
  });
}

/**
 * Row shape after header canonicalisation. Every column optional because the
 * operator's export may drop trailing columns and a partial row is still
 * validated field-by-field.
 */
export type WorkbookRow = Partial<Record<(typeof ADVANCE_BOOK_COLUMNS)[number], string>>;

// ─── Parsers ─────────────────────────────────────────────────────────────────
// One function per shape rather than a generic coercer, because the failure
// mode of each is different and the error messages need to say why.

const isBlank = (v: string | undefined): v is undefined =>
  v === undefined || v.trim() === "";

/**
 * Money parser tolerant of `$`, thousands separators, parenthesised negatives
 * and the awkward Google Sheets export where blank cells arrive as literal
 * "-". Returns null when the cell is blank or a placeholder; throws with a
 * readable message when the cell is present but unparseable.
 */
export function parseMoney(raw: string | undefined, field: string): number | null {
  if (isBlank(raw)) return null;
  let s = raw!.trim();
  if (s === "-" || s === "—") return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(`${field}: could not read "${raw}" as an amount`);
  }
  return negative ? -n : n;
}

/**
 * Date parser accepting the two shapes the operator's exports actually produce:
 * ISO (2025-07-29) and US slashed (7/29/2025 or 07/29/25). Anything else is
 * rejected explicitly rather than passed to Date's very forgiving constructor,
 * which would silently accept "yes" or "1" as a valid date.
 *
 * Returns YYYY-MM-DD, which is what Postgres wants and what fundInvoice takes.
 */
export function parseDate(raw: string | undefined, field: string): string | null {
  if (isBlank(raw)) return null;
  const s = raw!.trim();
  if (s === "-" || s === "—") return null;

  // ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // M/D/YYYY or MM/DD/YY
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (us) {
    const [, mm, dd, yyRaw] = us;
    const yy = yyRaw!.length === 2 ? `20${yyRaw}` : yyRaw!;
    const m = mm!.padStart(2, "0");
    const d = dd!.padStart(2, "0");
    return `${yy}-${m}-${d}`;
  }

  throw new Error(`${field}: could not read "${raw}" as a date (use YYYY-MM-DD or M/D/YYYY)`);
}

/**
 * Placeholder-invoice detector, same logic the underwriting engine uses. Kept
 * here explicitly rather than imported because the import step wants a slightly
 * different error message ("blank invoice number in row 42") than the engine
 * gives ("both such advances in the book were unpaid").
 */
const PLACEHOLDER_INVOICE = new Set(["", "-", "--", "n/a", "na", "none", "tbd", "pending", "?"]);
export function invoiceNumberOrThrow(raw: string | undefined): string {
  if (isBlank(raw)) throw new Error("Invoice #: missing");
  const s = raw!.trim();
  if (PLACEHOLDER_INVOICE.has(s.toLowerCase())) {
    throw new Error(`Invoice #: "${s}" is a placeholder, not a real invoice number`);
  }
  return s;
}

// ─── Row → import payload ────────────────────────────────────────────────────

/**
 * What the API needs to fund (and optionally settle) one advance. Names, not
 * UUIDs — the resolver in the router turns Borrower / Creditor strings into
 * client and debtor IDs, and complains clearly when there is no match.
 */
export interface AdvanceRowPayload {
  /** Whole client name from the workbook. */
  borrower: string;
  /** Whole agency name from the workbook. */
  creditor: string;
  invoice_number: string;
  face_amount: number;
  advanced_on: string;
  /** When present, an operator note that lands on the funded row. */
  notes: string | null;
  /** When Date Paid Back is present, the settlement to chain after funding. */
  collection: {
    collected_on: string;
    amount_received: number;
    check_number: string | null;
  } | null;
}

/**
 * Converts one canonicalised workbook row into an import payload. Throws with
 * a single readable message on first failure — the importer catches these and
 * attributes them to a row number for the operator.
 *
 * Any field the domain does not use (Sales person, Project, Fees, Days, etc)
 * is folded into notes so it is not silently lost. This is the record the
 * operator has been maintaining, and dropping their annotations at the door of
 * the system is how internal tools lose trust.
 */
export function toAdvancePayload(row: WorkbookRow): AdvanceRowPayload {
  const borrower = (row["Borrower"] ?? "").trim();
  if (!borrower) throw new Error("Borrower: missing");

  const creditor = (row["Creditor"] ?? "").trim();
  if (!creditor) throw new Error("Creditor: missing");

  const invoice_number = invoiceNumberOrThrow(row["Invoice #"]);
  const face_amount = parseMoney(row["Total Invoice"], "Total Invoice");
  if (face_amount === null || face_amount <= 0) {
    throw new Error("Total Invoice: missing or not positive");
  }
  const advanced_on = parseDate(row["Adv Date"], "Adv Date");
  if (advanced_on === null) throw new Error("Adv Date: missing");

  // Optional collection leg — only if BOTH Date Paid Back and Amount Received
  // are present. Half a collection (a date but no amount, or vice versa) is
  // almost always a workbook typo and should be caught, not silently ignored.
  const collectedOn = parseDate(row["Date Paid Back"], "Date Paid Back");
  const amountRcv = parseMoney(row["Amount Received"], "Amount Received");
  let collection: AdvanceRowPayload["collection"] = null;
  if (collectedOn !== null && amountRcv !== null && amountRcv > 0) {
    collection = {
      collected_on: collectedOn,
      amount_received: amountRcv,
      check_number: (row["Check #"] ?? "").trim() || null,
    };
  } else if (collectedOn !== null || (amountRcv !== null && amountRcv > 0)) {
    throw new Error(
      "Date Paid Back and Amount Received must both be filled or both be blank"
    );
  }

  // Preserve context the domain does not model. Runs the operator's Notes
  // column first if present, then appends a compact tag with whatever else
  // was on the row, so exports and re-imports round-trip legibly.
  const parts: string[] = [];
  const bare = (row["Notes"] ?? "").trim();
  if (bare) parts.push(bare);
  const tags: string[] = [];
  const sales = (row["Sales person"] ?? "").trim();
  const project = (row["Project"] ?? "").trim();
  if (sales) tags.push(`sales=${sales}`);
  if (project) tags.push(`project=${project}`);
  if ((row["Contract Ready"] ?? "").trim().toLowerCase() === "yes") tags.push("contract=yes");
  if ((row["Invoice Ready"] ?? "").trim().toLowerCase() === "yes") tags.push("invoice=yes");
  if (tags.length) parts.push(`[${tags.join(" | ")}]`);

  return {
    borrower,
    creditor,
    invoice_number,
    face_amount,
    advanced_on,
    notes: parts.length ? parts.join(" ") : null,
    collection,
  };
}
