/**
 * A factoring client's statements and insights, computed from the ledger.
 *
 * Every query runs as the tenant (row security scopes it to the client's own
 * company), and fees come from factoring_accrued_fee, the same function the
 * console and the client's Funding page use — so a statement, the overview
 * and One Source's own books never disagree.
 */
import type pg from 'pg';

/** Anything that can run a query: a pool client, or the RLS client. */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<pg.QueryResult>;
}

const ACTIVITY_TYPES = `('advance','payment_received','reserve_release','chargeback','direct_payment_reported')`;

export interface StatementLine {
  date: string;
  type: 'advance' | 'payment_received' | 'reserve_release' | 'chargeback' | 'direct_payment_reported';
  amount: number | null;
  memo: string | null;
  advance_id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  agency: string;
}

export interface Statement {
  from: string;
  to: string;
  lines: StatementLine[];
  totals: {
    advanced: number;
    agency_paid: number;
    reserve_released: number;
    charged_back: number;
    /** Fees on the invoices settled (reserve released) in the period. */
    fees_on_settled: number;
    short_paid_on_settled: number;
    settled_count: number;
  };
  /** Funded and not yet paid by the agency, as at the period's last day. */
  open_at_end: { count: number; advanced: number; reserve: number; fees_accrued: number };
}

/** Everything that happened on the client's funding between two dates, inclusive. */
export async function fundingStatement(db: Queryable, from: string, to: string): Promise<Statement> {
  // One after another: on a single connection pg runs them in turn anyway.
  const lines = await db.query(
      `SELECT fe.occurred_on::text AS date, fe.event_type::text AS type, fe.amount::float AS amount,
              CASE WHEN fe.event_type = 'payment_received' THEN fe.memo END AS memo,
              fi.id AS advance_id, fi.invoice_id, fi.invoice_number, fi.debtor_name AS agency
         FROM factoring_events fe JOIN factored_invoices fi ON fi.id = fe.factored_invoice_id
        WHERE fe.occurred_on BETWEEN $1 AND $2 AND fe.event_type IN ${ACTIVITY_TYPES}
        ORDER BY fe.occurred_on, fe.created_at`, [from, to]);
  const settled = await db.query(
      `SELECT COUNT(*)::int AS settled_count,
              COALESCE(SUM(factoring_accrued_fee(id)), 0)::float AS fees,
              COALESCE(SUM(factoring_shortfall(id)), 0)::float AS short_paid
         FROM factored_invoices WHERE closed_on BETWEEN $1 AND $2`, [from, to]);
  const open = await db.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(advance_amount), 0)::float AS advanced,
              COALESCE(SUM(reserve_amount), 0)::float AS reserve,
              COALESCE(SUM(factoring_accrued_fee(id, $1)), 0)::float AS fees_accrued
         FROM factored_invoices fi
        WHERE fi.advanced_on <= $1
          AND (fi.collected_on IS NULL OR fi.collected_on > $1)
          AND NOT EXISTS (SELECT 1 FROM factoring_events e
                           WHERE e.factored_invoice_id = fi.id AND e.event_type = 'chargeback' AND e.occurred_on <= $1)`,
      [to]);
  const sum = (t: string) => (lines.rows as StatementLine[])
    .filter((l) => l.type === t).reduce((s, l) => s + (l.amount ?? 0), 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    from, to,
    lines: lines.rows as StatementLine[],
    totals: {
      advanced: round(sum('advance')),
      agency_paid: round(sum('payment_received')),
      reserve_released: round(sum('reserve_release')),
      charged_back: round(sum('chargeback')),
      fees_on_settled: settled.rows[0].fees,
      short_paid_on_settled: settled.rows[0].short_paid,
      settled_count: settled.rows[0].settled_count,
    },
    open_at_end: open.rows[0],
  };
}

export interface Insights {
  /** The twelve months ending with the month of `asOf`, oldest first. */
  months: { month: string; billed: number; funded: number; advanced: number; fees: number }[];
  /** Funded as a share of everything billed over those twelve months (0–1), or null with nothing billed. */
  share_funded_12m: number | null;
  lifetime: {
    funded_count: number; funded: number; advanced: number; fees: number;
    /** Fees as a share of what was funded (0–1). */
    effective_fee_rate: number | null;
    avg_days_to_pay: number | null;
    since: string | null;
  };
  agencies: {
    agency: string; funded_count: number; funded: number; open_count: number;
    avg_days_to_pay: number | null; slowest_days: number | null; short_paid: number;
  }[];
}

/** How the client uses funding: volume and cost over time, and how each agency pays. */
export async function fundingInsights(db: Queryable, asOf: string): Promise<Insights> {
  const months = await db.query(
      `WITH m AS (
         SELECT generate_series(date_trunc('month', $1::date) - interval '11 months',
                                date_trunc('month', $1::date), interval '1 month')::date AS month)
       SELECT to_char(m.month, 'YYYY-MM') AS month,
              (SELECT COALESCE(SUM(i.total), 0) FROM invoices i
                WHERE i.deleted_at IS NULL AND i.status NOT IN ('draft', 'void')
                  AND date_trunc('month', i.issue_date)::date = m.month)::float AS billed,
              COALESCE(SUM(f.face_amount), 0)::float AS funded,
              COALESCE(SUM(f.advance_amount), 0)::float AS advanced,
              COALESCE(SUM(factoring_accrued_fee(f.id)), 0)::float AS fees
         FROM m LEFT JOIN factored_invoices f ON date_trunc('month', f.advanced_on)::date = m.month
        GROUP BY m.month ORDER BY m.month`, [asOf]);
  const lifetime = await db.query(
      `SELECT COUNT(*)::int AS funded_count,
              COALESCE(SUM(face_amount), 0)::float AS funded,
              COALESCE(SUM(advance_amount), 0)::float AS advanced,
              COALESCE(SUM(factoring_accrued_fee(id)), 0)::float AS fees,
              ROUND(AVG(collected_on - advanced_on) FILTER (WHERE collected_on IS NOT NULL))::int AS avg_days_to_pay,
              MIN(advanced_on)::text AS since
         FROM factored_invoices WHERE advanced_on IS NOT NULL`);
  const agencies = await db.query(
      `SELECT debtor_name AS agency,
              COUNT(*)::int AS funded_count,
              SUM(face_amount)::float AS funded,
              COUNT(*) FILTER (WHERE status IN ('pending', 'advanced'))::int AS open_count,
              ROUND(AVG(collected_on - advanced_on) FILTER (WHERE collected_on IS NOT NULL))::int AS avg_days_to_pay,
              MAX(collected_on - advanced_on) FILTER (WHERE collected_on IS NOT NULL) AS slowest_days,
              COALESCE(SUM(factoring_shortfall(id)), 0)::float AS short_paid
         FROM factored_invoices WHERE advanced_on IS NOT NULL
        GROUP BY debtor_name ORDER BY SUM(face_amount) DESC`);
  const ms = months.rows as Insights['months'];
  const billed = ms.reduce((s, m) => s + m.billed, 0);
  const funded = ms.reduce((s, m) => s + m.funded, 0);
  const life = lifetime.rows[0];
  return {
    months: ms,
    share_funded_12m: billed > 0 ? Math.min(1, funded / billed) : null,
    lifetime: { ...life, effective_fee_rate: life.funded > 0 ? life.fees / life.funded : null },
    agencies: agencies.rows as Insights['agencies'],
  };
}
