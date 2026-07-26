-- ConstructPM Complete Schema
-- Run via: npm run migrate

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enum types ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner','admin','project_manager','field_crew','accountant','viewer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('lead','bidding','awarded','active','on_hold','substantially_complete','closed','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE contract_type AS ENUM ('lump_sum','gmp','cost_plus_fixed','cost_plus_pct','time_and_materials','unit_price');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('not_started','in_progress','completed','blocked');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE cost_type AS ENUM ('material','labor','subcontractor','equipment','overhead','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE contact_type AS ENUM ('customer','vendor','subcontractor','both');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE co_status AS ENUM ('draft','sent','approved','rejected','void');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE po_status AS ENUM ('draft','sent','acknowledged','partially_billed','fully_billed','closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE bill_status AS ENUM ('draft','pending_approval','approved','paid','disputed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('draft','sent','viewed','partially_paid','paid','overdue','void');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM ('starter','professional','gc_suite','enterprise');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('trialing','active','past_due','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── updated_at trigger function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ─── companies ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  logo_url            TEXT,
  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT,
  state_code          CHAR(2),
  zip                 VARCHAR(10),
  phone               VARCHAR(20),
  website             TEXT,
  license_number      TEXT,
  subscription_tier   subscription_tier NOT NULL DEFAULT 'starter',
  subscription_status subscription_status NOT NULL DEFAULT 'trialing',
  stripe_customer_id  TEXT,
  settings            JSONB NOT NULL DEFAULT '{
    "timezone": "America/Chicago",
    "date_format": "MM/DD/YYYY",
    "currency": "USD",
    "default_markup_pct": 15,
    "default_retainage_pct": 10,
    "fiscal_year_start_month": 1,
    "invoice_prefix": "INV-",
    "po_prefix": "PO-",
    "co_prefix": "CO-",
    "pay_app_prefix": "PA-"
  }'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);
DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  role              user_role NOT NULL DEFAULT 'viewer',
  avatar_url        TEXT,
  phone             VARCHAR(20),
  job_title         TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret        TEXT,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── refresh_tokens ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  family_id       UUID NOT NULL,
  absolute_expiry TIMESTAMPTZ NOT NULL,
  replaced_by     UUID REFERENCES refresh_tokens(id),
  is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- ─── contacts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  type             contact_type NOT NULL DEFAULT 'customer',
  email            TEXT,
  phone            VARCHAR(20),
  address_line1    TEXT,
  address_line2    TEXT,
  city             TEXT,
  state_code       CHAR(2),
  zip              VARCHAR(10),
  license_number   TEXT,
  insurance_expiry DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(company_id, name);
DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── jobs ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  job_number               TEXT NOT NULL,
  description              TEXT,
  status                   job_status NOT NULL DEFAULT 'lead',
  contract_type            contract_type NOT NULL DEFAULT 'lump_sum',
  contract_amount          NUMERIC(15,2),
  start_date               DATE,
  end_date                 DATE,
  address_line1            TEXT,
  address_line2            TEXT,
  city                     TEXT,
  state_code               CHAR(2),
  zip                      VARCHAR(10),
  customer_id              UUID REFERENCES contacts(id),
  project_manager_id       UUID REFERENCES users(id),
  retainage_pct            NUMERIC(5,2) NOT NULL DEFAULT 10,
  prevailing_wage_required BOOLEAN NOT NULL DEFAULT FALSE,
  prevailing_wage_county   TEXT,
  created_by               UUID NOT NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  UNIQUE(company_id, job_number)
);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(company_id, status);
DROP TRIGGER IF EXISTS jobs_updated_at ON jobs;
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── budgets ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Primary Budget',
  status     TEXT NOT NULL DEFAULT 'active',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budgets_job ON budgets(job_id);

-- ─── budget_groups ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_budget_groups_job ON budget_groups(job_id);

-- ─── budget_items ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  budget_id             UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  budget_group_id       UUID REFERENCES budget_groups(id),
  cost_catalog_item_id  UUID,
  name                  TEXT NOT NULL,
  description           TEXT,
  cost_type             cost_type NOT NULL DEFAULT 'material',
  cost_code             TEXT,
  unit                  TEXT,
  quantity              NUMERIC(15,4) NOT NULL DEFAULT 1,
  unit_cost             NUMERIC(15,4) NOT NULL DEFAULT 0,
  markup_pct            NUMERIC(7,4) NOT NULL DEFAULT 0,
  ext_cost              NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_price            NUMERIC(15,4) NOT NULL DEFAULT 0,
  ext_price             NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order            INT NOT NULL DEFAULT 0,
  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_budget_items_job ON budget_items(job_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_group ON budget_items(budget_group_id);

-- ─── budget_item_depletion_summary ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_item_depletion_summary (
  budget_item_id    UUID PRIMARY KEY REFERENCES budget_items(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL,
  committed_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  actual_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  invoiced_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  labor_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  last_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version           INT NOT NULL DEFAULT 1
);

-- ─── task_groups ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_task_groups_job ON task_groups(job_id);

-- ─── tasks ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  task_group_id   UUID REFERENCES task_groups(id),
  name            TEXT NOT NULL,
  description     TEXT,
  status          task_status NOT NULL DEFAULT 'not_started',
  start_date      DATE,
  end_date        DATE,
  duration_days   INT,
  completion_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  budget_item_id  UUID REFERENCES budget_items(id),
  sort_order      INT NOT NULL DEFAULT 0,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_job ON tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(company_id, status);

-- ─── task_assignees ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

-- ─── change_orders ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS change_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  number           INT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  status           co_status NOT NULL DEFAULT 'draft',
  amount           NUMERIC(15,2) NOT NULL DEFAULT 0,
  cost_impact      NUMERIC(15,2) NOT NULL DEFAULT 0,
  time_impact_days INT NOT NULL DEFAULT 0,
  customer_id      UUID REFERENCES contacts(id),
  approved_by      UUID REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  created_by       UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  UNIQUE(company_id, job_id, number)
);
CREATE INDEX IF NOT EXISTS idx_co_job ON change_orders(job_id);
DROP TRIGGER IF EXISTS co_updated_at ON change_orders;
CREATE TRIGGER co_updated_at BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── purchase_orders ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  status            po_status NOT NULL DEFAULT 'draft',
  vendor_id         UUID NOT NULL REFERENCES contacts(id),
  change_order_id   UUID REFERENCES change_orders(id),
  description       TEXT,
  issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery DATE,
  subtotal          NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total             NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_po_job ON purchase_orders(job_id);
DROP TRIGGER IF EXISTS po_updated_at ON purchase_orders;
CREATE TRIGGER po_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── po_items ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  budget_item_id    UUID REFERENCES budget_items(id),
  name              TEXT NOT NULL,
  description       TEXT,
  quantity          NUMERIC(15,4) NOT NULL DEFAULT 1,
  unit              TEXT,
  unit_cost         NUMERIC(15,4) NOT NULL DEFAULT 0,
  ext_cost          NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order        INT NOT NULL DEFAULT 0
);

-- ─── vendor_bills ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_bills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_orders(id),
  vendor_id         UUID NOT NULL REFERENCES contacts(id),
  bill_number       TEXT,
  status            bill_status NOT NULL DEFAULT 'draft',
  bill_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE,
  subtotal          NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total             NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bills_job ON vendor_bills(job_id);
DROP TRIGGER IF EXISTS bills_updated_at ON vendor_bills;
CREATE TRIGGER bills_updated_at BEFORE UPDATE ON vendor_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── vendor_bill_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_bill_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_bill_id  UUID NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  po_item_id      UUID REFERENCES po_items(id),
  budget_item_id  UUID REFERENCES budget_items(id),
  name            TEXT NOT NULL,
  quantity        NUMERIC(15,4) NOT NULL DEFAULT 1,
  unit_cost       NUMERIC(15,4) NOT NULL DEFAULT 0,
  ext_cost        NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0
);

-- ─── invoices ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id         UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES contacts(id),
  invoice_number TEXT NOT NULL,
  status         invoice_status NOT NULL DEFAULT 'draft',
  issue_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE NOT NULL,
  subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate       NUMERIC(7,4) NOT NULL DEFAULT 0,
  tax_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance_due    NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes          TEXT,
  sent_at        TIMESTAMPTZ,
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(company_id, status);
DROP TRIGGER IF EXISTS invoices_updated_at ON invoices;
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── invoice_items ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id     UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  budget_item_id UUID REFERENCES budget_items(id),
  description    TEXT NOT NULL,
  quantity       NUMERIC(15,4) NOT NULL DEFAULT 1,
  unit_price     NUMERIC(15,4) NOT NULL DEFAULT 0,
  amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order     INT NOT NULL DEFAULT 0
);

-- ─── daily_logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  log_date         DATE NOT NULL,
  weather          TEXT,
  temperature_high NUMERIC(5,1),
  temperature_low  NUMERIC(5,1),
  summary          TEXT NOT NULL,
  delays           TEXT,
  visitors         TEXT,
  created_by       UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, job_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_logs_job ON daily_logs(job_id, log_date DESC);
DROP TRIGGER IF EXISTS daily_logs_updated_at ON daily_logs;
CREATE TRIGGER daily_logs_updated_at BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── time_entries ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id),
  daily_log_id         UUID REFERENCES daily_logs(id),
  budget_item_id       UUID REFERENCES budget_items(id),
  work_date            DATE NOT NULL,
  hours                NUMERIC(5,2) NOT NULL DEFAULT 0,
  overtime_hours       NUMERIC(5,2) NOT NULL DEFAULT 0,
  description          TEXT,
  cost_code            TEXT,
  trade_classification TEXT,
  pay_rate             NUMERIC(8,2) NOT NULL DEFAULT 0,
  approved             BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by          UUID REFERENCES users(id),
  approved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_job ON time_entries(job_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id, work_date DESC);
DROP TRIGGER IF EXISTS time_entries_updated_at ON time_entries;
CREATE TRIGGER time_entries_updated_at BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── file_attachments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id        UUID REFERENCES jobs(id),
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  original_name TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  scan_status   TEXT NOT NULL DEFAULT 'clean',
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON file_attachments(entity_type, entity_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Note: In dev, RLS is enforced via SET LOCAL app.company_id in each request.
-- The session user (constructpm) has BYPASSRLS in dev for migrations/seeding.

-- Grant permissions
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;
GRANT app_user TO constructpm;

COMMENT ON SCHEMA public IS 'ConstructPM — multi-tenant construction platform';

-- ─── Row Level Security Policies ──────────────────────────────────────────────
-- These enforce tenant isolation at the DATABASE level as a second layer of
-- defense. The application layer also scopes all queries by company_id.

-- Create a restricted app role that has RLS applied
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;
GRANT app_user TO constructpm;

-- Enable RLS on every multi-tenant table
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees     ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bills       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bill_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_attachments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens     ENABLE ROW LEVEL SECURITY;

-- Helper function to get current company from session config
CREATE OR REPLACE FUNCTION current_company_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::UUID;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- RLS policies — each table can only see its own company's rows
CREATE POLICY users_company_isolation              ON users              USING (company_id = current_company_id());
CREATE POLICY contacts_company_isolation           ON contacts            USING (company_id = current_company_id());
CREATE POLICY jobs_company_isolation               ON jobs                USING (company_id = current_company_id());
CREATE POLICY budgets_company_isolation            ON budgets             USING (company_id = current_company_id());
CREATE POLICY budget_groups_company_isolation      ON budget_groups       USING (company_id = current_company_id());
CREATE POLICY budget_items_company_isolation       ON budget_items        USING (company_id = current_company_id());
CREATE POLICY task_groups_company_isolation        ON task_groups         USING (company_id = current_company_id());
CREATE POLICY tasks_company_isolation              ON tasks               USING (company_id = current_company_id());
CREATE POLICY change_orders_company_isolation      ON change_orders       USING (company_id = current_company_id());
CREATE POLICY purchase_orders_company_isolation    ON purchase_orders     USING (company_id = current_company_id());
CREATE POLICY vendor_bills_company_isolation       ON vendor_bills        USING (company_id = current_company_id());
CREATE POLICY invoices_company_isolation           ON invoices            USING (company_id = current_company_id());
CREATE POLICY daily_logs_company_isolation         ON daily_logs          USING (company_id = current_company_id());
CREATE POLICY time_entries_company_isolation       ON time_entries        USING (company_id = current_company_id());
CREATE POLICY file_attachments_company_isolation   ON file_attachments    USING (company_id = current_company_id());
CREATE POLICY refresh_tokens_company_isolation     ON refresh_tokens      USING (company_id = current_company_id());

-- Join tables — isolated via parent job's company
CREATE POLICY task_assignees_isolation ON task_assignees
  USING (task_id IN (SELECT id FROM tasks WHERE company_id = current_company_id()));
CREATE POLICY po_items_isolation ON po_items
  USING (po_id IN (SELECT id FROM purchase_orders WHERE company_id = current_company_id()));
CREATE POLICY vendor_bill_items_isolation ON vendor_bill_items
  USING (bill_id IN (SELECT id FROM vendor_bills WHERE company_id = current_company_id()));
CREATE POLICY invoice_items_isolation ON invoice_items
  USING (invoice_id IN (SELECT id FROM invoices WHERE company_id = current_company_id()));

COMMENT ON SCHEMA public IS 'ConstructPM — multi-tenant construction platform';
