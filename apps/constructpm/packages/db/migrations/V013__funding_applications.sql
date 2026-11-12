-- ═══════════════════════════════════════════════════════════════════════════
-- V013 — Funding applications (apply.os-funding.com)
--
-- A second front door for prospects who come for funding, not for the
-- software. They apply and upload onboarding documents without an account;
-- One Source reviews the application in the operator console; approval
-- creates their company, a login for them, and an active funding client.
--
--   funding_applications          one per applicant, reached by a resume token
--   funding_application_items     documents and sensitive numbers (EIN, SSN)
--   application_requirements      what an application must include — edited
--                                 by One Source, so new requirements are data
--   user_invites                  "set your password" links sent on approval
--
-- Isolation. An applicant has no tenant, so the tenant policies (company_id =
-- current_company_id()) don't apply. Instead the API resolves the resume token
-- to an application id through a SECURITY DEFINER function and scopes the
-- session to it with app.application_id — the same pattern as app.company_id.
-- With no application in scope the app role sees no applications at all.
--
-- Sensitive numbers are encrypted by the API before they reach the database
-- (AES-256-GCM, key in APPLICATION_DATA_KEY), and the app role cannot even
-- SELECT the ciphertext column; only the operator role reads it, to decrypt on
-- an audited "reveal".
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE application_status AS ENUM
    ('draft', 'submitted', 'in_review', 'docs_requested', 'approved', 'declined', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- document  a file the applicant uploads
  -- ein / ssn a number, validated and stored encrypted
  CREATE TYPE application_item_kind AS ENUM ('document', 'ein', 'ssn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION current_application_id() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.application_id', true), '')::uuid; $$;

-- ─── Requirements (operator-managed) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS application_requirements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  label                 TEXT NOT NULL,
  description           TEXT,
  kind                  application_item_kind NOT NULL DEFAULT 'document',
  required              BOOLEAN NOT NULL DEFAULT TRUE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order            INT NOT NULL DEFAULT 100,
  -- Optional blank form the applicant downloads, fills in and uploads back.
  template_storage_key  TEXT,
  template_name         TEXT,
  template_content_type TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS application_requirements_updated_at ON application_requirements;
CREATE TRIGGER application_requirements_updated_at BEFORE UPDATE ON application_requirements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO application_requirements (key, label, description, kind, sort_order) VALUES
  ('articles_of_incorporation', 'Articles of Incorporation',
   'The filed Articles of Incorporation (or Certificate of Organization, for an LLC) for your business.',
   'document', 10),
  ('w9', 'Completed W-9',
   'A signed IRS Form W-9 for your business. We use it to set up your escrow account.',
   'document', 20),
  ('ein', 'Business EIN',
   'Your business''s 9-digit Employer Identification Number.',
   'ein', 30),
  ('signer_drivers_license', 'Driver''s license of the authorized signer',
   'A clear photo or scan of the front of the license of the person signing for the business.',
   'document', 40),
  ('owner_ssn', 'Owner''s Social Security number',
   'Used to verify identity and run standard background checks. Stored encrypted and seen only by One Source.',
   'ssn', 50),
  ('payment_directive', 'Payment Directive / ACH Change form',
   'Tells the agency to send payment for funded invoices to One Source. Complete and sign the form, then upload it.',
   'document', 60),
  ('corporate_resolution', 'Notarized Corporate Resolution',
   'Authorizes your business to work with One Source. It must be signed and notarized before you upload it.',
   'document', 70)
ON CONFLICT (key) DO NOTHING;

-- ─── Applications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funding_applications (
  id                   UUID PRIMARY KEY,
  status               application_status NOT NULL DEFAULT 'draft',

  contact_first_name   TEXT NOT NULL,
  contact_last_name    TEXT NOT NULL,
  contact_email        TEXT NOT NULL,
  contact_phone        TEXT,

  legal_name           TEXT NOT NULL,
  dba                  TEXT,
  entity_type          TEXT,
  state_of_formation   CHAR(2),
  years_in_business    NUMERIC(4,1),
  address_line1        TEXT,
  city                 TEXT,
  state_code           CHAR(2),
  zip                  VARCHAR(10),

  agencies             TEXT,
  monthly_volume       NUMERIC(15,2),
  typical_invoice      NUMERIC(15,2),
  typical_days_to_pay  INT,
  has_existing_lender  BOOLEAN,
  existing_lender      TEXT,

  owner_name           TEXT,
  owner_title          TEXT,
  owner_ownership_pct  NUMERIC(5,2),
  signer_name          TEXT,
  signer_title         TEXT,
  how_heard            TEXT,

  -- Typed-name signature on the application and authorization to run checks.
  signature_name       TEXT,
  signed_at            TIMESTAMPTZ,
  signed_ip            INET,
  consent_version      TEXT,

  -- Resume link: only the SHA-256 of the token is stored.
  token_hash           TEXT UNIQUE,
  token_expires_at     TIMESTAMPTZ,

  submitted_at         TIMESTAMPTZ,
  reviewed_at          TIMESTAMPTZ,
  decline_reason       TEXT,
  ops_note             TEXT,
  request_message      TEXT,
  requested_items      TEXT[],

  company_id           UUID REFERENCES companies(id) ON DELETE SET NULL,
  approved_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,

  created_ip           INET,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT funding_app_email_ck CHECK (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT funding_app_signed_ck CHECK (
    status IN ('draft', 'withdrawn') OR (signature_name IS NOT NULL AND signed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_funding_apps_status ON funding_applications(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_apps_email ON funding_applications(LOWER(contact_email));
DROP TRIGGER IF EXISTS funding_applications_updated_at ON funding_applications;
CREATE TRIGGER funding_applications_updated_at BEFORE UPDATE ON funding_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What an applicant may do to their own application: edit it while it's a
-- draft or One Source has asked for more documents, and move it to
-- 'submitted'. Review, approval and decline belong to the operator role.
CREATE OR REPLACE FUNCTION funding_application_applicant_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'constructpm_app' THEN
    IF OLD.status NOT IN ('draft', 'docs_requested') THEN
      RAISE EXCEPTION 'application is locked while One Source reviews it'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'submitted' THEN
      RAISE EXCEPTION 'an applicant can only submit an application'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS funding_applications_applicant_guard ON funding_applications;
CREATE TRIGGER funding_applications_applicant_guard BEFORE UPDATE ON funding_applications
  FOR EACH ROW EXECUTE FUNCTION funding_application_applicant_guard();

-- ─── Items: documents and sensitive numbers ──────────────────────────────────
CREATE TABLE IF NOT EXISTS funding_application_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID NOT NULL REFERENCES funding_applications(id) ON DELETE CASCADE,
  requirement_key  TEXT NOT NULL,
  kind             application_item_kind NOT NULL,
  -- document
  storage_key      TEXT,
  original_name    TEXT,
  content_type     TEXT,
  size_bytes       BIGINT,
  -- ein / ssn: ciphertext from the API, and the last four digits for display
  value_encrypted  TEXT,
  value_last4      TEXT,
  -- 'operator' = marked received outside the app (e.g. signed in PandaDoc)
  source           TEXT NOT NULL DEFAULT 'applicant' CHECK (source IN ('applicant', 'operator')),
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT funding_app_item_shape_ck CHECK (
    source = 'operator'
    OR (kind = 'document' AND storage_key IS NOT NULL AND value_encrypted IS NULL)
    OR (kind IN ('ein', 'ssn') AND value_encrypted IS NOT NULL AND storage_key IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_funding_app_items_app ON funding_application_items(application_id, requirement_key);
-- One EIN / one SSN value per requirement: re-entering replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_app_items_one_secret
  ON funding_application_items(application_id, requirement_key)
  WHERE kind IN ('ein', 'ssn') AND source = 'applicant';

-- ─── Row-level security ──────────────────────────────────────────────────────
ALTER TABLE funding_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE funding_application_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_application_items FORCE ROW LEVEL SECURITY;

-- V002's default privileges grant full DML on new tables; start from nothing.
REVOKE ALL ON funding_applications, funding_application_items, application_requirements FROM constructpm_app;

-- Applicant (app role, scoped to one application id).
DROP POLICY IF EXISTS funding_apps_applicant_select ON funding_applications;
CREATE POLICY funding_apps_applicant_select ON funding_applications
  FOR SELECT TO constructpm_app USING (id = current_application_id());
DROP POLICY IF EXISTS funding_apps_applicant_insert ON funding_applications;
CREATE POLICY funding_apps_applicant_insert ON funding_applications
  FOR INSERT TO constructpm_app
  WITH CHECK (id = current_application_id() AND status = 'draft'
              AND company_id IS NULL AND approved_user_id IS NULL);
DROP POLICY IF EXISTS funding_apps_applicant_update ON funding_applications;
CREATE POLICY funding_apps_applicant_update ON funding_applications
  FOR UPDATE TO constructpm_app
  USING (id = current_application_id()) WITH CHECK (id = current_application_id());

GRANT SELECT, INSERT ON funding_applications TO constructpm_app;
-- Column grants keep review fields, the company link and the token out of reach.
GRANT UPDATE (
  contact_first_name, contact_last_name, contact_email, contact_phone,
  legal_name, dba, entity_type, state_of_formation, years_in_business,
  address_line1, city, state_code, zip,
  agencies, monthly_volume, typical_invoice, typical_days_to_pay,
  has_existing_lender, existing_lender,
  owner_name, owner_title, owner_ownership_pct, signer_name, signer_title, how_heard,
  signature_name, signed_at, signed_ip, consent_version,
  status, submitted_at, token_expires_at
) ON funding_applications TO constructpm_app;

DROP POLICY IF EXISTS funding_app_items_applicant_select ON funding_application_items;
CREATE POLICY funding_app_items_applicant_select ON funding_application_items
  FOR SELECT TO constructpm_app USING (application_id = current_application_id());
DROP POLICY IF EXISTS funding_app_items_applicant_insert ON funding_application_items;
CREATE POLICY funding_app_items_applicant_insert ON funding_application_items
  FOR INSERT TO constructpm_app
  WITH CHECK (application_id = current_application_id() AND source = 'applicant'
              AND EXISTS (SELECT 1 FROM funding_applications a
                           WHERE a.id = application_id AND a.status IN ('draft', 'docs_requested')));
DROP POLICY IF EXISTS funding_app_items_applicant_delete ON funding_application_items;
CREATE POLICY funding_app_items_applicant_delete ON funding_application_items
  FOR DELETE TO constructpm_app
  USING (application_id = current_application_id() AND source = 'applicant'
         AND EXISTS (SELECT 1 FROM funding_applications a
                      WHERE a.id = application_id AND a.status IN ('draft', 'docs_requested')));

-- Everything except the ciphertext is readable by the applicant's session.
GRANT SELECT (id, application_id, requirement_key, kind, storage_key, original_name,
              content_type, size_bytes, value_last4, source, note, created_at)
  ON funding_application_items TO constructpm_app;
GRANT INSERT, DELETE ON funding_application_items TO constructpm_app;

GRANT SELECT ON application_requirements TO constructpm_app;

-- Operator: full access.
DROP POLICY IF EXISTS funding_apps_admin_all ON funding_applications;
CREATE POLICY funding_apps_admin_all ON funding_applications
  FOR ALL TO constructpm_factoring_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS funding_app_items_admin_all ON funding_application_items;
CREATE POLICY funding_app_items_admin_all ON funding_application_items
  FOR ALL TO constructpm_factoring_admin USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE
  ON funding_applications, funding_application_items, application_requirements
  TO constructpm_factoring_admin;

-- ─── Resume token → application ──────────────────────────────────────────────
-- The applicant's only way in. Returns nothing for an unknown or expired
-- token, or once the application is decided.
CREATE OR REPLACE FUNCTION application_id_for_token(p_token_hash text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT id FROM funding_applications
   WHERE token_hash = p_token_hash
     AND token_expires_at > NOW()
     AND status IN ('draft', 'submitted', 'in_review', 'docs_requested')
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION application_id_for_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION application_id_for_token(text) TO constructpm_app;

-- ─── Invites (set-your-password links) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_invites_user ON user_invites(user_id);
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites FORCE ROW LEVEL SECURITY;
-- No direct access for either role: only the functions below touch it.
REVOKE ALL ON user_invites FROM constructpm_app;

-- Operator side: a new invite for a user (an earlier unused one stops working).
CREATE OR REPLACE FUNCTION create_user_invite(p_user_id uuid, p_token_hash text, p_ttl_days int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE user_invites SET expires_at = LEAST(expires_at, NOW())
   WHERE user_id = p_user_id AND used_at IS NULL;
  INSERT INTO user_invites (user_id, token_hash, expires_at)
  VALUES (p_user_id, p_token_hash, NOW() + make_interval(days => GREATEST(1, LEAST(p_ttl_days, 30))));
END;
$$;
REVOKE ALL ON FUNCTION create_user_invite(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_user_invite(uuid, text, int) TO constructpm_factoring_admin;

-- Pre-login: who is this invite for? (Shown on the set-password page.)
CREATE OR REPLACE FUNCTION auth_invite_info(p_token_hash text)
RETURNS TABLE(email text, first_name text, company_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.email, u.first_name, c.name
    FROM user_invites i
    JOIN users u ON u.id = i.user_id
    JOIN companies c ON c.id = u.company_id
   WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.expires_at > NOW()
     AND u.is_active AND u.deleted_at IS NULL
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth_invite_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_invite_info(text) TO constructpm_app;

-- Pre-login: use the invite once, setting the password (an argon2 hash made by
-- the API). Returns the user so the API can open a session.
CREATE OR REPLACE FUNCTION auth_accept_invite(p_token_hash text, p_password_hash text)
RETURNS TABLE(id uuid, company_id uuid, email text, first_name text, last_name text, role user_role)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_user uuid;
BEGIN
  IF p_password_hash IS NULL OR p_password_hash NOT LIKE '$argon2%' THEN
    RAISE EXCEPTION 'password hash must be argon2';
  END IF;
  UPDATE user_invites SET used_at = NOW()
   WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > NOW()
   RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  UPDATE users SET password_hash = p_password_hash, updated_at = NOW()
   WHERE users.id = v_user AND is_active AND deleted_at IS NULL;
  RETURN QUERY
    SELECT u.id, u.company_id, u.email, u.first_name, u.last_name, u.role
      FROM users u WHERE u.id = v_user AND u.is_active AND u.deleted_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION auth_accept_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_accept_invite(text, text) TO constructpm_app;

-- ─── Approval: application → company, login, active funding client ──────────
-- Operator-only. If the applicant's email already has a ConstructPM login, that
-- company becomes the funding client and no new login is made. Otherwise a new
-- company (in funding-only mode) and an owner user with no usable password are
-- created; the API then issues an invite. Documents are linked to the company
-- (entity 'onboarding') so the client can see what they provided; the stored
-- objects are shared, and tenants cannot delete onboarding files.
CREATE OR REPLACE FUNCTION application_provision_client(
  p_application_id uuid, p_fee_schedule_id uuid, p_credit_limit numeric
) RETURNS TABLE(company_id uuid, user_id uuid, created_user boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  a         funding_applications%ROWTYPE;
  v_company uuid;
  v_user    uuid;
  v_created boolean := false;
  v_slug    text;
BEGIN
  SELECT * INTO a FROM funding_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF a.status NOT IN ('submitted', 'in_review', 'docs_requested') THEN
    RAISE EXCEPTION 'only a submitted application can be approved (it is %)', a.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.id, u.company_id INTO v_user, v_company
    FROM users u
   WHERE LOWER(u.email) = LOWER(a.contact_email) AND u.deleted_at IS NULL
   LIMIT 1;

  IF v_user IS NULL THEN
    v_slug := trim(both '-' from lower(regexp_replace(a.legal_name, '[^a-zA-Z0-9]+', '-', 'g')));
    v_slug := left(NULLIF(v_slug, ''), 48);
    v_slug := COALESCE(v_slug, 'client') || '-' || substr(md5(random()::text), 1, 6);
    INSERT INTO companies (name, slug, address_line1, city, state_code, zip, phone)
    VALUES (a.legal_name, v_slug, a.address_line1, a.city, a.state_code, a.zip,
            left(a.contact_phone, 20))
    RETURNING id INTO v_company;
    -- Funding-only: the app shows the client their funding, not job tools,
    -- until they choose to turn those on.
    UPDATE companies SET settings = settings || '{"portal_mode":"funding"}'::jsonb
     WHERE id = v_company;
    INSERT INTO users (company_id, email, password_hash, first_name, last_name, role, phone)
    VALUES (v_company, LOWER(a.contact_email), '!invite-pending', a.contact_first_name,
            a.contact_last_name, 'owner', left(a.contact_phone, 20))
    RETURNING id INTO v_user;
    v_created := true;
  END IF;

  INSERT INTO factoring_clients (company_id, status, default_fee_schedule_id, credit_limit, onboarded_on)
  VALUES (v_company, 'active', p_fee_schedule_id, p_credit_limit, CURRENT_DATE)
  ON CONFLICT (company_id) DO UPDATE SET
    status = 'active',
    default_fee_schedule_id = COALESCE(EXCLUDED.default_fee_schedule_id, factoring_clients.default_fee_schedule_id),
    credit_limit = COALESCE(EXCLUDED.credit_limit, factoring_clients.credit_limit),
    onboarded_on = COALESCE(factoring_clients.onboarded_on, EXCLUDED.onboarded_on),
    updated_at = NOW();

  INSERT INTO file_attachments
    (company_id, entity_type, entity_id, original_name, storage_key, content_type,
     size_bytes, scan_status, uploaded_by)
  SELECT v_company, 'onboarding', a.id, i.original_name, i.storage_key, i.content_type,
         i.size_bytes, 'clean', v_user
    FROM funding_application_items i
   WHERE i.application_id = a.id AND i.kind = 'document' AND i.storage_key IS NOT NULL;

  UPDATE funding_applications
     SET status = 'approved', reviewed_at = NOW(), company_id = v_company,
         approved_user_id = v_user, token_hash = NULL, token_expires_at = NULL
   WHERE id = a.id;

  RETURN QUERY SELECT v_company, v_user, v_created;
END;
$$;
REVOKE ALL ON FUNCTION application_provision_client(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION application_provision_client(uuid, uuid, numeric) TO constructpm_factoring_admin;

-- An applicant's email can already belong to a ConstructPM login. Approval then
-- turns funding on for that existing company rather than creating a new one —
-- correct when it really is them, wrong if someone typed another business's
-- address. The console shows this before the operator approves.
CREATE OR REPLACE FUNCTION application_existing_login(p_application_id uuid)
RETURNS TABLE(company_id uuid, company_name text, user_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name::text, (u.first_name || ' ' || u.last_name)::text
    FROM funding_applications a
    JOIN users u ON LOWER(u.email) = LOWER(a.contact_email) AND u.deleted_at IS NULL
    JOIN companies c ON c.id = u.company_id
   WHERE a.id = p_application_id
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION application_existing_login(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION application_existing_login(uuid) TO constructpm_factoring_admin;
