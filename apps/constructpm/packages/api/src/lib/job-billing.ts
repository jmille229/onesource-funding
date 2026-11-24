/**
 * What has been billed on each job, from its invoices — the figures the jobs
 * list and a job's page lead with. One definition, used by both:
 *
 *   billed       invoices sent to the agency (not drafts, not void)
 *   paid         what the agency has paid against them
 *   outstanding  still owed on billed invoices
 *   funded       advanced by One Source against the job's invoices
 *   drafts       logged but not yet sent
 *
 * "Left to bill" is the job's contract value less `billed`, worked out by the
 * caller when the job has a contract value.
 *
 * Use with a jobs alias `j`, through an RLS client: the subqueries then see
 * only the company's own invoices and advances.
 */
export const JOB_BILLING_JOIN = `
  LEFT JOIN (
    SELECT i.job_id,
           COUNT(*) FILTER (WHERE i.status NOT IN ('draft','void'))                        AS invoice_count,
           COUNT(*) FILTER (WHERE i.status = 'draft')                                      AS drafts,
           SUM(i.total) FILTER (WHERE i.status NOT IN ('draft','void'))                    AS billed,
           SUM(i.paid_amount) FILTER (WHERE i.status <> 'void')                            AS paid,
           SUM(i.balance_due) FILTER (WHERE i.status NOT IN ('draft','void','paid'))       AS outstanding
      FROM invoices i
     WHERE i.job_id IS NOT NULL AND i.deleted_at IS NULL
     GROUP BY i.job_id
  ) jb ON jb.job_id = j.id
  LEFT JOIN (
    SELECT i.job_id, SUM(fi.advance_amount) AS funded
      FROM factored_invoices fi
      JOIN invoices i ON i.id = fi.invoice_id
     WHERE i.job_id IS NOT NULL AND i.deleted_at IS NULL
     GROUP BY i.job_id
  ) jf ON jf.job_id = j.id`;

export const JOB_BILLING_COLUMNS = `
  COALESCE(jb.invoice_count, 0)::int AS invoice_count,
  COALESCE(jb.drafts, 0)::int        AS draft_count,
  COALESCE(jb.billed, 0)             AS billed,
  COALESCE(jb.paid, 0)               AS paid,
  COALESCE(jb.outstanding, 0)        AS outstanding,
  COALESCE(jf.funded, 0)             AS funded`;
