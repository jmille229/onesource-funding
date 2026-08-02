-- ============================================================
-- V003: Subcontractor management
--   - subcontracts (the commitment: a GC↔sub agreement on a job)
--   - sub pay applications reuse vendor_bills (linked via subcontract_id),
--     inheriting the existing approval/payment/AP flow, plus retainage held
--   - contact certifications (MBE/WBE/DBE/SDVOSB) for participation reporting
-- Runs as the admin/migration role; RLS is applied to the new table below.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE subcontract_status AS ENUM ('draft','active','complete','closed','void');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── contact certifications (for participation reporting) ─────────────────────
-- Values: 'MBE','WBE','DBE','SDVOSB','SBE','HUBZone' (free-form set).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS certifications TEXT[] NOT NULL DEFAULT '{}';

-- ─── subcontracts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subcontracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  subcontractor_id    UUID NOT NULL REFERENCES contacts(id),
  subcontract_number  TEXT,
  title               TEXT NOT NULL,
  cost_code           TEXT,
  scope               TEXT,
  contract_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  retainage_pct       NUMERIC(5,2)  NOT NULL DEFAULT 10,
  status              subcontract_status NOT NULL DEFAULT 'draft',
  start_date          DATE,
  end_date            DATE,
  executed_date       DATE,
  notes               TEXT,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE(company_id, job_id, subcontract_number)
);
CREATE INDEX IF NOT EXISTS idx_subcontracts_company ON subcontracts(company_id);
CREATE INDEX IF NOT EXISTS idx_subcontracts_job ON subcontracts(job_id);
CREATE INDEX IF NOT EXISTS idx_subcontracts_sub ON subcontracts(subcontractor_id);
DROP TRIGGER IF EXISTS subcontracts_updated_at ON subcontracts;
CREATE TRIGGER subcontracts_updated_at BEFORE UPDATE ON subcontracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── sub pay applications reuse vendor_bills ──────────────────────────────────
-- A vendor_bill with subcontract_id set IS a pay application against that sub.
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS subcontract_id   UUID REFERENCES subcontracts(id);
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS retainage_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_bills_subcontract ON vendor_bills(subcontract_id);

-- ─── RLS for the new table (same pattern as V002) ─────────────────────────────
ALTER TABLE subcontracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontracts FORCE  ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON subcontracts TO constructpm_app;
DROP POLICY IF EXISTS subcontracts_isolation ON subcontracts;
CREATE POLICY subcontracts_isolation ON subcontracts FOR ALL TO constructpm_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
