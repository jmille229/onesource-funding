-- ============================================================
-- V002: Row Level Security Policies
-- Defense-in-depth: enforces tenant isolation at the DB layer
-- in addition to the application-layer SET LOCAL app.company_id.
-- Even a raw DB connection or a buggy query cannot read another
-- company's data without the correct config setting.
-- ============================================================

-- ─── Helper: current tenant from session config ──────────────
-- Returns NULL if not set (blocks all access via USING clause)
CREATE OR REPLACE FUNCTION current_company_id() RETURNS uuid
  LANGUAGE sql STABLE AS
$$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid;
$$;

-- ─── Enable RLS on all tenant-scoped tables ───────────────────
ALTER TABLE companies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bills        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_attachments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens      ENABLE ROW LEVEL SECURITY;

-- ─── RLS bypasses for superuser / migration role ──────────────
-- The migration user (constructpm) uses BYPASSRLS so migrations
-- and the seed script can write data without needing the config.
-- The application connects as constructpm_app (created below),
-- which does NOT have BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'constructpm_app') THEN
    CREATE ROLE constructpm_app LOGIN PASSWORD 'CHANGE_THIS_IN_PRODUCTION';
  END IF;
END;
$$;

GRANT CONNECT ON DATABASE constructpm_dev TO constructpm_app;
GRANT USAGE ON SCHEMA public TO constructpm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO constructpm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO constructpm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO constructpm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO constructpm_app;

-- ─── companies: can only see own company ─────────────────────
CREATE POLICY companies_isolation ON companies
  FOR ALL TO constructpm_app
  USING (id = current_company_id());

-- ─── users ───────────────────────────────────────────────────
CREATE POLICY users_isolation ON users
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── jobs ────────────────────────────────────────────────────
CREATE POLICY jobs_isolation ON jobs
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── contacts ────────────────────────────────────────────────
CREATE POLICY contacts_isolation ON contacts
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── tasks ───────────────────────────────────────────────────
CREATE POLICY tasks_isolation ON tasks
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

CREATE POLICY task_groups_isolation ON task_groups
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

CREATE POLICY task_assignees_isolation ON task_assignees
  FOR ALL TO constructpm_app
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND t.company_id = current_company_id()
    )
  );

-- ─── budget ──────────────────────────────────────────────────
CREATE POLICY budget_items_isolation ON budget_items
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── change orders ───────────────────────────────────────────
CREATE POLICY change_orders_isolation ON change_orders
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── purchase orders ─────────────────────────────────────────
CREATE POLICY purchase_orders_isolation ON purchase_orders
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── vendor bills ────────────────────────────────────────────
CREATE POLICY vendor_bills_isolation ON vendor_bills
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── invoices ────────────────────────────────────────────────
CREATE POLICY invoices_isolation ON invoices
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

CREATE POLICY invoice_line_items_isolation ON invoice_line_items
  FOR ALL TO constructpm_app
  USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.company_id = current_company_id()
    )
  );

-- ─── daily logs ──────────────────────────────────────────────
CREATE POLICY daily_logs_isolation ON daily_logs
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── time entries ────────────────────────────────────────────
CREATE POLICY time_entries_isolation ON time_entries
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── file attachments ────────────────────────────────────────
CREATE POLICY file_attachments_isolation ON file_attachments
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());

-- ─── refresh tokens ──────────────────────────────────────────
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id());
