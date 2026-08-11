-- ═══════════════════════════════════════════════════════════════════════════
-- Funding and onboarding requests
--
-- These are the first factoring tables a *tenant* may write to, and that is
-- deliberate: a client asking for funding is not the same act as an advance
-- existing. The funded book (factored_invoices) stays SELECT-only for tenants —
-- a request is a separate object that OneSource converts into an advance.
--
-- Tenant write access is kept as narrow as the requirement allows:
--   INSERT  scoped by WITH CHECK to the caller's own company;
--   UPDATE  granted on the `status` COLUMN ONLY, and only while a request is
--           still 'submitted' — enough to withdraw, not enough to alter the
--           amount, the invoice, or a decision OneSource has already made.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE funding_request_status AS ENUM
    ('submitted','under_review','approved','declined','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE onboarding_request_status AS ENUM
    ('submitted','contacted','approved','declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Funding requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funding_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  -- Captured at request time. The invoice stays editable (product decision), so
  -- the figures here record what was actually asked for, not what the invoice
  -- happens to say later.
  requested_amount    NUMERIC(15,2) NOT NULL,
  customer_name       TEXT,
  invoice_number      TEXT,

  status              funding_request_status NOT NULL DEFAULT 'submitted',
  note                TEXT,
  decline_reason      TEXT,

  -- Set when OneSource converts the request into an advance.
  factored_invoice_id UUID REFERENCES factored_invoices(id) ON DELETE SET NULL,

  requested_by        UUID REFERENCES users(id),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT funding_request_amount_ck CHECK (requested_amount > 0)
);

-- One live request per invoice. Without this a client can double-submit by
-- double-clicking, and OneSource ends up underwriting the same invoice twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_requests_open_invoice
  ON funding_requests(invoice_id)
  WHERE status IN ('submitted','under_review','approved');

CREATE INDEX IF NOT EXISTS idx_funding_requests_company ON funding_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_funding_requests_pending ON funding_requests(requested_at)
  WHERE status IN ('submitted','under_review');

-- ─── Onboarding requests ─────────────────────────────────────────────────────
-- Submitted by companies that aren't factoring clients yet.
CREATE TABLE IF NOT EXISTS factoring_onboarding_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_name   TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  contact_phone  TEXT,
  monthly_volume NUMERIC(15,2),
  note           TEXT,
  -- The invoice that prompted them to ask, when there was one. Gives the
  -- conversation a concrete starting point.
  invoice_id     UUID REFERENCES invoices(id) ON DELETE SET NULL,
  status         onboarding_request_status NOT NULL DEFAULT 'submitted',
  requested_by   UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open enquiry per company; re-asking while one is pending is noise.
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_open_company
  ON factoring_onboarding_requests(company_id)
  WHERE status IN ('submitted','contacted');

-- ─── updated_at ──────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['funding_requests','factoring_onboarding_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON %I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t, t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS and grants
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['funding_requests','factoring_onboarding_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_tenant_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO constructpm_app '
      'USING (company_id = current_company_id());', t || '_tenant_read', t);

    -- WITH CHECK stops a client filing a request against another company.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_tenant_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO constructpm_app '
      'WITH CHECK (company_id = current_company_id());', t || '_tenant_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO constructpm_factoring_admin '
      'USING (true) WITH CHECK (true);', t || '_admin_all', t);

    -- Reset first: V002's ALTER DEFAULT PRIVILEGES hands the tenant role full
    -- DML on every new table, so the grants below are only meaningful after a
    -- revoke. (This is the same trap V004 hit.)
    EXECUTE format('REVOKE ALL ON %I FROM constructpm_app;', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO constructpm_app;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO constructpm_factoring_admin;', t);
  END LOOP;
END $$;

-- Withdrawal, and nothing else. A column-level grant means the database itself
-- refuses an attempt to edit the amount, the invoice or a recorded decision —
-- the API is not the only thing standing in the way.
GRANT UPDATE (status) ON funding_requests TO constructpm_app;

DROP POLICY IF EXISTS funding_requests_tenant_withdraw ON funding_requests;
CREATE POLICY funding_requests_tenant_withdraw ON funding_requests
  FOR UPDATE TO constructpm_app
  -- Only a still-pending request of one's own may be touched...
  USING (company_id = current_company_id() AND status = 'submitted')
  -- ...and it may only end up withdrawn, never self-approved.
  WITH CHECK (company_id = current_company_id() AND status = 'withdrawn');

-- The operator console lists requests alongside the company they came from.
GRANT SELECT (id, company_id, job_id, invoice_number, total, balance_due, issue_date, due_date, status)
  ON invoices TO constructpm_factoring_admin;

-- Underwriting needs the invoice copy the client attached — and nothing else in
-- their document store. The grant is column-limited and the policy restricts it
-- to attachments on funding requests, so job photos, signed contracts and every
-- other uploaded file stay out of reach. A blanket grant here would have quietly
-- handed the operator role every document in every client account.
GRANT SELECT (id, company_id, entity_type, entity_id, original_name, storage_key,
              content_type, size_bytes, created_at)
  ON file_attachments TO constructpm_factoring_admin;

DROP POLICY IF EXISTS file_attachments_factoring_admin_read ON file_attachments;
CREATE POLICY file_attachments_factoring_admin_read ON file_attachments
  FOR SELECT TO constructpm_factoring_admin
  USING (entity_type = 'funding_request');
