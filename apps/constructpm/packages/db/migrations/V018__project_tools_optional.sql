-- ═══════════════════════════════════════════════════════════════════════════
-- V018 — Project tools are optional, and off unless a company uses them
--
-- Invoices (and funding) are the product. Jobs, budgets, tasks,
-- subcontracts, time and the project dashboard are an add-on a company
-- switches on in Settings (companies.settings.project_tools). Unset means off.
--
-- So nobody loses what they already use: a company that has real project
-- work in the app gets the switch set on here. "Real" means a job with any
-- project data behind it, or any job not made automatically by the old
-- one-screen "submit an invoice for funding" form (removed in V017's
-- release), which filed each invoice under a job named
-- "<agency> · <contract>" or "<agency> — funded invoices".
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE companies c
   SET settings = c.settings || '{"project_tools": true}'::jsonb
 WHERE NOT (c.settings ? 'project_tools')
   AND EXISTS (
     SELECT 1 FROM jobs j
      WHERE j.company_id = c.id AND j.deleted_at IS NULL
        AND (
          (j.name NOT LIKE '% — funded invoices' AND j.name NOT LIKE '% · %')
          OR EXISTS (SELECT 1 FROM budget_items b   WHERE b.job_id = j.id)
          OR EXISTS (SELECT 1 FROM tasks t          WHERE t.job_id = j.id)
          OR EXISTS (SELECT 1 FROM subcontracts s   WHERE s.job_id = j.id)
          OR EXISTS (SELECT 1 FROM time_entries te  WHERE te.job_id = j.id)
          OR EXISTS (SELECT 1 FROM daily_logs dl    WHERE dl.job_id = j.id)
          OR EXISTS (SELECT 1 FROM change_orders co WHERE co.job_id = j.id)
          OR EXISTS (SELECT 1 FROM purchase_orders po WHERE po.job_id = j.id)
        )
   );

-- Those automatic jobs carried the contract number as their job number.
-- Put it on the invoice, where it now belongs, so it still shows with the
-- project tools off.
UPDATE invoices i
   SET contract_reference = j.job_number
  FROM jobs j
 WHERE j.id = i.job_id
   AND i.contract_reference IS NULL
   AND j.name LIKE '% · %'
   AND j.job_number IS NOT NULL
   AND j.job_number !~ '^JOB-[0-9]+$';
