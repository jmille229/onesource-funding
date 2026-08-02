-- ============================================================
-- V002: Row-Level Security, tenant isolation, and the app role.
--
-- Run this migration as a role with CREATEROLE + BYPASSRLS (the trusted
-- migration/admin role — e.g. the DB owner altered with BYPASSRLS, or a
-- superuser). The SECURITY DEFINER auth functions below inherit that role's
-- RLS-bypass, which is what lets the unauthenticated login/refresh flow look
-- users up across tenants.
--
-- The application connects as `constructpm_app` (created here), which is NOT
-- a superuser and does NOT have BYPASSRLS — so every query it runs is forced
-- through the policies below. This is the actual tenant boundary.
-- ============================================================

-- ─── Current tenant from the per-transaction session config ──────────────────
-- NULL when unset → every USING clause is false → access denied (fail closed).
CREATE OR REPLACE FUNCTION current_company_id() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid; $$;

-- ─── Application role (subject to RLS) ───────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'constructpm_app') THEN
    CREATE ROLE constructpm_app LOGIN PASSWORD 'CHANGE_THIS_IN_PRODUCTION';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO constructpm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO constructpm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO constructpm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO constructpm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO constructpm_app;

-- ─── Enable + FORCE RLS on every tenant-scoped table ─────────────────────────
-- FORCE also subjects the table owner to RLS (defense-in-depth against an
-- accidental owner-role connection). The migration role bypasses via BYPASSRLS.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','users','contacts','jobs','budgets','budget_groups','budget_items',
    'budget_item_depletion_summary','task_groups','tasks','task_assignees','change_orders',
    'purchase_orders','po_items','vendor_bills','vendor_bill_items','invoices','invoice_items',
    'daily_logs','time_entries','file_attachments','refresh_tokens'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- ─── Isolation policies ──────────────────────────────────────────────────────
-- companies keys on id; everything else keys on its own company_id column.
DROP POLICY IF EXISTS companies_isolation ON companies;
CREATE POLICY companies_isolation ON companies FOR ALL TO constructpm_app
  USING (id = current_company_id()) WITH CHECK (id = current_company_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','contacts','jobs','budgets','budget_groups','budget_items',
    'budget_item_depletion_summary','task_groups','tasks','change_orders',
    'purchase_orders','po_items','vendor_bills','vendor_bill_items','invoices',
    'invoice_items','daily_logs','time_entries','file_attachments','refresh_tokens'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO constructpm_app '
      'USING (company_id = current_company_id()) '
      'WITH CHECK (company_id = current_company_id());', t||'_isolation', t);
  END LOOP;
END $$;

-- task_assignees has no company_id → isolate through its parent task.
DROP POLICY IF EXISTS task_assignees_isolation ON task_assignees;
CREATE POLICY task_assignees_isolation ON task_assignees FOR ALL TO constructpm_app
  USING (EXISTS (SELECT 1 FROM tasks tk WHERE tk.id = task_assignees.task_id AND tk.company_id = current_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks tk WHERE tk.id = task_assignees.task_id AND tk.company_id = current_company_id()));

-- ─── Cross-tenant auth lookups (SECURITY DEFINER) ────────────────────────────
-- Login and refresh run before any tenant context exists, so they must read
-- across tenants. These functions are owned by the (BYPASSRLS) migration role
-- and are the ONLY cross-tenant read path granted to the app role.
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
RETURNS TABLE(id uuid, company_id uuid, email text, first_name text, last_name text, role user_role, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.company_id, u.email, u.first_name, u.last_name, u.role, u.password_hash
  FROM users u
  WHERE lower(u.email) = lower(p_email) AND u.is_active = true AND u.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_find_refresh_token(p_hash text)
RETURNS TABLE(id uuid, company_id uuid, user_id uuid, family_id uuid, is_revoked boolean, replaced_by uuid, absolute_expiry timestamptz, role user_role)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rt.id, rt.company_id, rt.user_id, rt.family_id, rt.is_revoked, rt.replaced_by, rt.absolute_expiry, u.role
  FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
  WHERE rt.token_hash = p_hash
  LIMIT 1;
$$;

-- Registration bootstraps a brand-new tenant (company + owner user) before any
-- tenant context exists, so it must also run outside RLS. A duplicate email
-- raises unique_violation (23505), which the API maps to HTTP 409.
CREATE OR REPLACE FUNCTION auth_register(
  p_company_name text, p_slug text, p_email text,
  p_password_hash text, p_first_name text, p_last_name text
) RETURNS TABLE(company_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_cid uuid; v_uid uuid;
BEGIN
  INSERT INTO companies (name, slug) VALUES (p_company_name, p_slug) RETURNING id INTO v_cid;
  INSERT INTO users (company_id, email, password_hash, first_name, last_name, role)
    VALUES (v_cid, p_email, p_password_hash, p_first_name, p_last_name, 'owner') RETURNING id INTO v_uid;
  RETURN QUERY SELECT v_cid, v_uid;
END;
$$;

REVOKE ALL ON FUNCTION auth_find_user_by_email(text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_refresh_token(text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_register(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text)  TO constructpm_app;
GRANT EXECUTE ON FUNCTION auth_find_refresh_token(text)  TO constructpm_app;
GRANT EXECUTE ON FUNCTION auth_register(text,text,text,text,text,text) TO constructpm_app;
