-- ═══════════════════════════════════════════════════════════════════════════
-- V015 — Job names on funded advances, for the operator console
--
-- The Advances list and a client's history show which job or contract each
-- advance was against. The operator role had no access to jobs at all; this
-- gives it the job number and name only, and only for jobs that a funded
-- advance points at. Budgets, tasks, subcontracts and every other job column
-- stay out of reach, as do jobs that were never funded.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT (id, name, job_number) ON jobs TO constructpm_factoring_admin;

DROP POLICY IF EXISTS jobs_factoring_admin_read ON jobs;
CREATE POLICY jobs_factoring_admin_read ON jobs
  FOR SELECT TO constructpm_factoring_admin
  USING (EXISTS (SELECT 1 FROM factored_invoices fi WHERE fi.job_id = jobs.id));
