-- ═══════════════════════════════════════════════════════════════════════════
-- Factoring
--
-- Unlike every other module, factoring data is two-sided: the contractor reads
-- their own advances, while OneSource writes them across every tenant. That
-- second requirement is exactly what the RLS model exists to prevent, so the
-- access design here is deliberate:
--
--   constructpm_app             tenant role. SELECT only, scoped to its own
--                               company. It has no INSERT/UPDATE/DELETE grant
--                               on any factoring table, so a bug in a router
--                               cannot let a contractor edit their own advance.
--
--   constructpm_factoring_admin operator role. Full access to factoring tables
--                               across tenants — and NOTHING else. It is not
--                               BYPASSRLS and holds no grants on jobs, budgets,
--                               daily logs or subcontracts, so even a fully
--                               compromised operator account cannot read a
--                               client's project data.
--
-- Tables holding cross-tenant information (debtors, fee schedules, platform
-- users, the audit log) carry no company_id and are simply never granted to the
-- tenant role. Anything a contractor legitimately needs from them — the debtor's
-- name, the terms they were funded on — is denormalised onto factored_invoices,
-- so isolation holds by construction rather than by policy.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE factoring_client_status AS ENUM ('prospect','active','suspended','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- pending      submitted for funding, money not yet out
  -- advanced     funded and outstanding — this is what "outstanding" means
  -- collected    the debtor paid; reserve not yet released
  -- closed       reserve released and fees settled
  -- charged_back recourse triggered; the client owes the advance back
  CREATE TYPE factored_invoice_status AS ENUM
    ('pending','advanced','collected','closed','charged_back');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE factoring_event_type AS ENUM
    ('advance','payment_received','reserve_release','fee_adjustment','chargeback','note');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- step        the tier containing the day count sets the whole fee rate
  --             (day 35 under 0-30:2%, 31-45:3%  ->  3% of face)
  -- cumulative  every tier entered adds its rate
  --             (day 35 under the same schedule  ->  2% + 3% = 5% of face)
  CREATE TYPE fee_tier_mode AS ENUM ('step','cumulative');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Debtors (platform-level) ────────────────────────────────────────────────
-- Deliberately NOT tenant-scoped: the same general contractor may owe several
-- OneSource clients, and concentration risk is only visible in aggregate.
-- Never granted to constructpm_app.
CREATE TABLE IF NOT EXISTS factoring_debtors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name     TEXT NOT NULL,
  dba            TEXT,
  address_line1  TEXT,
  city           TEXT,
  state_code     CHAR(2),
  zip            VARCHAR(10),
  credit_limit   NUMERIC(15,2),
  risk_grade     TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_factoring_debtors_name ON factoring_debtors(lower(legal_name));

-- ─── Fee schedules (platform-level) ──────────────────────────────────────────
-- Named templates plus bespoke schedules, so "standard tiers for most clients,
-- special deals for some" is data rather than code.
CREATE TABLE IF NOT EXISTS fee_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT,
  is_template      BOOLEAN NOT NULL DEFAULT TRUE,   -- false = bespoke to one client
  tier_mode        fee_tier_mode NOT NULL DEFAULT 'step',
  advance_rate_pct NUMERIC(7,4) NOT NULL,           -- e.g. 80.0000
  recourse_days    INT NOT NULL DEFAULT 90,
  -- A schedule that has funded an invoice must never change underneath it.
  -- Retire it and create a successor instead; funded invoices additionally carry
  -- their own snapshot of the terms (see factored_invoices).
  retired_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fee_schedules_advance_rate_ck CHECK (advance_rate_pct > 0 AND advance_rate_pct <= 100),
  CONSTRAINT fee_schedules_recourse_ck     CHECK (recourse_days > 0)
);

CREATE TABLE IF NOT EXISTS fee_schedule_tiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_schedule_id UUID NOT NULL REFERENCES fee_schedules(id) ON DELETE CASCADE,
  from_day        INT NOT NULL,
  to_day          INT,                               -- NULL = open ended
  fee_pct         NUMERIC(7,4) NOT NULL,
  CONSTRAINT fee_tier_range_ck CHECK (to_day IS NULL OR to_day >= from_day),
  CONSTRAINT fee_tier_from_ck  CHECK (from_day >= 0),
  CONSTRAINT fee_tier_pct_ck   CHECK (fee_pct >= 0)
);
CREATE INDEX IF NOT EXISTS idx_fee_tiers_schedule ON fee_schedule_tiers(fee_schedule_id, from_day);

-- ─── Factoring client (tenant-scoped) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS factoring_clients (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  status                   factoring_client_status NOT NULL DEFAULT 'prospect',
  default_fee_schedule_id  UUID REFERENCES fee_schedules(id),
  credit_limit             NUMERIC(15,2),
  onboarded_on             DATE,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Factored invoices (tenant-scoped) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS factored_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  factoring_client_id UUID NOT NULL REFERENCES factoring_clients(id) ON DELETE CASCADE,
  debtor_id           UUID NOT NULL REFERENCES factoring_debtors(id),

  -- Denormalised so the tenant can see who owes without being granted access to
  -- the cross-tenant debtor table.
  debtor_name         TEXT NOT NULL,

  -- Optional links. A client may factor invoices raised outside ConstructPM, so
  -- neither of these can be required.
  invoice_id          UUID REFERENCES invoices(id) ON DELETE SET NULL,
  job_id              UUID REFERENCES jobs(id) ON DELETE SET NULL,

  invoice_number      TEXT NOT NULL,
  face_amount         NUMERIC(15,2) NOT NULL,

  -- Terms snapshotted at funding. fee_schedule_id records which schedule was
  -- applied, but the rates live here too: editing a schedule must never rewrite
  -- the economics of an invoice that has already been funded.
  fee_schedule_id     UUID REFERENCES fee_schedules(id),
  advance_rate_pct    NUMERIC(7,4) NOT NULL,
  recourse_days       INT NOT NULL,

  advance_amount      NUMERIC(15,2) NOT NULL,
  reserve_amount      NUMERIC(15,2) NOT NULL,

  status              factored_invoice_status NOT NULL DEFAULT 'pending',
  advanced_on         DATE,
  invoice_due_on      DATE,
  collected_on        DATE,
  closed_on           DATE,
  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT factored_face_ck    CHECK (face_amount > 0),
  CONSTRAINT factored_amounts_ck CHECK (advance_amount >= 0 AND reserve_amount >= 0),
  -- Advance + reserve is the face value by definition; a mismatch means someone
  -- keyed a number wrong, and it is far cheaper to catch here than to reconcile
  -- later. A cent of slack absorbs rounding.
  CONSTRAINT factored_split_ck   CHECK (abs((advance_amount + reserve_amount) - face_amount) <= 0.01),
  -- Anything past 'pending' must record when the money went out.
  CONSTRAINT factored_advanced_on_ck CHECK (status = 'pending' OR advanced_on IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_factored_company_status ON factored_invoices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_factored_debtor        ON factored_invoices(debtor_id);
CREATE INDEX IF NOT EXISTS idx_factored_job          ON factored_invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_factored_outstanding  ON factored_invoices(company_id, advanced_on)
  WHERE status = 'advanced';

-- ─── Event ledger (tenant-scoped) ────────────────────────────────────────────
-- Append-only. This is what makes the balances defensible, and what lets the app
-- become the book of record later without a schema rewrite.
CREATE TABLE IF NOT EXISTS factoring_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  factored_invoice_id UUID NOT NULL REFERENCES factored_invoices(id) ON DELETE CASCADE,
  event_type          factoring_event_type NOT NULL,
  amount              NUMERIC(15,2),
  occurred_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  memo                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_factoring_events_invoice
  ON factoring_events(factored_invoice_id, occurred_on);

-- ─── Operator identity (platform-level) ──────────────────────────────────────
-- Separate from `users` on purpose. Operator status is a different credential,
-- not a flag on a tenant account — so no bug in tenant-facing code can promote a
-- contractor into cross-tenant access. Tokens for these accounts carry a
-- different JWT audience and are only accepted on the admin routes.
CREATE TABLE IF NOT EXISTS platform_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- TEXT + a lower() unique index, matching how `users.email` is handled; the
  -- citext extension isn't installed and isn't worth adding for one column.
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_users_email ON platform_users(LOWER(email));

-- Every operator write is recorded. There was no audit infrastructure before
-- this, and cross-tenant writes are precisely where it is not optional.
CREATE TABLE IF NOT EXISTS factoring_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  platform_user_id UUID REFERENCES platform_users(id),
  action           TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        UUID,
  company_id       UUID,
  before           JSONB,
  after            JSONB,
  ip               INET,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_factoring_audit_time   ON factoring_audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_factoring_audit_entity ON factoring_audit_log(entity_type, entity_id);

-- ─── updated_at triggers ─────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'factoring_debtors','fee_schedules','factoring_clients','factored_invoices','platform_users'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON %I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t, t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fee accrual
--
-- SECURITY DEFINER because the tier tables are never granted to the tenant role,
-- yet a contractor must be able to see what they will net. The function reads
-- the tiers on their behalf and enforces the tenant check itself: when a company
-- context is set (i.e. the caller is a tenant), the invoice must belong to it.
-- Operator connections have no company context and are allowed through.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION factoring_accrued_fee(p_factored_invoice UUID, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv     RECORD;
  v_days  INT;
  v_pct   NUMERIC(9,4);
BEGIN
  SELECT fi.company_id, fi.face_amount, fi.advanced_on, fi.fee_schedule_id, fi.status
    INTO inv
    FROM factored_invoices fi
   WHERE fi.id = p_factored_invoice;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Tenant callers may only ask about their own invoices.
  IF current_company_id() IS NOT NULL AND inv.company_id <> current_company_id() THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  IF inv.advanced_on IS NULL OR inv.fee_schedule_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Fees stop accruing once the debtor has paid.
  v_days := GREATEST(0, (LEAST(p_as_of, COALESCE(
              (SELECT collected_on FROM factored_invoices WHERE id = p_factored_invoice),
              p_as_of)) - inv.advanced_on));

  SELECT CASE fs.tier_mode
           WHEN 'step' THEN (
             SELECT t.fee_pct FROM fee_schedule_tiers t
              WHERE t.fee_schedule_id = fs.id
                AND v_days >= t.from_day
                AND (t.to_day IS NULL OR v_days <= t.to_day)
              ORDER BY t.from_day DESC LIMIT 1
           )
           ELSE (
             SELECT COALESCE(SUM(t.fee_pct), 0) FROM fee_schedule_tiers t
              WHERE t.fee_schedule_id = fs.id
                AND v_days >= t.from_day
           )
         END
    INTO v_pct
    FROM fee_schedules fs
   WHERE fs.id = inv.fee_schedule_id;

  RETURN ROUND(inv.face_amount * COALESCE(v_pct, 0) / 100.0, 2);
END $$;

REVOKE ALL ON FUNCTION factoring_accrued_fee(UUID, DATE) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- Roles, RLS and grants
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'constructpm_factoring_admin') THEN
    -- NOLOGIN until a password is configured; the migration runner grants LOGIN
    -- when FACTORING_ADMIN_PASSWORD is present in the environment.
    CREATE ROLE constructpm_factoring_admin NOLOGIN;
  END IF;
END $$;

-- Tenant-visible tables: RLS on, forced, SELECT-only for the app role.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['factoring_clients','factored_invoices','factoring_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_tenant_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO constructpm_app '
      'USING (company_id = current_company_id());', t || '_tenant_read', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO constructpm_factoring_admin '
      'USING (true) WITH CHECK (true);', t || '_admin_all', t);

    -- SELECT only, and the REVOKE is load-bearing: V002 set ALTER DEFAULT
    -- PRIVILEGES granting full DML on every future table, so these tables arrive
    -- already writable by the tenant role. Granting SELECT alone would leave
    -- INSERT/UPDATE/DELETE in place, and the read-only guarantee would rest
    -- purely on the absence of a write policy — one mistake away from failing.
    EXECUTE format('REVOKE ALL ON %I FROM constructpm_app;', t);
    EXECUTE format('GRANT SELECT ON %I TO constructpm_app;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO constructpm_factoring_admin;', t);
  END LOOP;
END $$;

-- Cross-tenant tables: operator only. constructpm_app is granted nothing here,
-- so there is no policy to get wrong.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'factoring_debtors','fee_schedules','fee_schedule_tiers','platform_users','factoring_audit_log'
  ] LOOP
    EXECUTE format('REVOKE ALL ON %I FROM constructpm_app;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO constructpm_factoring_admin;', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE factoring_audit_log_id_seq TO constructpm_factoring_admin;

-- Both roles may compute fees; the function enforces the tenant check.
GRANT EXECUTE ON FUNCTION factoring_accrued_fee(UUID, DATE)
  TO constructpm_app, constructpm_factoring_admin;

-- The operator role needs to resolve company names and link invoices, and
-- nothing more. It has no grant on jobs, budgets, tasks, daily logs, files or
-- subcontracts, which bounds the blast radius of a compromised operator account.
GRANT SELECT (id, name, slug) ON companies TO constructpm_factoring_admin;
GRANT SELECT (id, company_id, job_id, invoice_number, total, balance_due, issue_date, due_date, status)
  ON invoices TO constructpm_factoring_admin;

-- Column grants alone are not sufficient. Both tables have FORCE RLS with
-- policies naming only constructpm_app, so without a policy for the operator
-- role every join against them returns zero rows — silently, which is the
-- dangerous part: the console would show an empty book rather than an error.
-- SELECT only, and the column grants above still bound what is readable.
DROP POLICY IF EXISTS companies_factoring_admin_read ON companies;
CREATE POLICY companies_factoring_admin_read ON companies
  FOR SELECT TO constructpm_factoring_admin USING (true);

DROP POLICY IF EXISTS invoices_factoring_admin_read ON invoices;
CREATE POLICY invoices_factoring_admin_read ON invoices
  FOR SELECT TO constructpm_factoring_admin USING (true);
