-- ═══════════════════════════════════════════════════════════════════════════
-- V014 — Adding clients by hand in the operator console
--
-- A client One Source signs outside the online application (a referral, a
-- phone call, the existing book) is set up from the console: a company, a
-- funding client on chosen terms and, when there's an email, an owner login
-- with a set-password link.
--
-- The operator role reads companies (id, name) and never touches users
-- directly. These SECURITY DEFINER functions are the only way it creates a
-- company or a login, or lists and re-invites a client's logins, and each one
-- only works for companies that are funding clients — so the console can't be
-- used to create or reset logins for software customers who aren't.
-- ═══════════════════════════════════════════════════════════════════════════

-- Does this email already sign in somewhere? Approval or setup would then use
-- that company rather than create a second one, and the console says so first.
CREATE OR REPLACE FUNCTION admin_login_for_email(p_email text)
RETURNS TABLE(user_id uuid, company_id uuid, company_name text, user_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.id, c.id, c.name::text, (u.first_name || ' ' || u.last_name)::text
    FROM users u
    JOIN companies c ON c.id = u.company_id
   WHERE LOWER(u.email) = LOWER(btrim(p_email)) AND u.deleted_at IS NULL
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION admin_login_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_login_for_email(text) TO constructpm_factoring_admin;

-- A new company for a client, in the funding-only portal (Funding, branded One
-- Source) until they choose to turn on the project and invoice tools.
CREATE OR REPLACE FUNCTION admin_create_client_company(p_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_name    text := btrim(p_name);
  v_slug    text;
  v_company uuid;
BEGIN
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'a business name is required' USING ERRCODE = 'check_violation';
  END IF;
  v_slug := trim(both '-' from lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g')));
  v_slug := COALESCE(left(NULLIF(v_slug, ''), 48), 'client') || '-' || substr(md5(random()::text), 1, 6);
  INSERT INTO companies (name, slug) VALUES (v_name, v_slug) RETURNING id INTO v_company;
  UPDATE companies SET settings = settings || '{"portal_mode":"funding"}'::jsonb WHERE id = v_company;
  RETURN v_company;
END;
$$;
REVOKE ALL ON FUNCTION admin_create_client_company(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_create_client_company(text) TO constructpm_factoring_admin;

-- A login for someone at a funding client. No password yet: they set one from
-- the invite link. The first login at a company is its owner.
CREATE OR REPLACE FUNCTION admin_add_client_login(
  p_company_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_email text := LOWER(btrim(p_email));
  v_role  user_role;
  v_user  uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM factoring_clients WHERE company_id = p_company_id) THEN
    RAISE EXCEPTION 'that company is not a funding client' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'enter a valid email address' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE LOWER(email) = v_email) THEN
    RAISE EXCEPTION 'a login with that email already exists' USING ERRCODE = 'unique_violation';
  END IF;
  v_role := CASE WHEN EXISTS (SELECT 1 FROM users WHERE company_id = p_company_id
                                AND role = 'owner' AND deleted_at IS NULL)
                 THEN 'admin'::user_role ELSE 'owner'::user_role END;
  INSERT INTO users (company_id, email, password_hash, first_name, last_name, role, phone)
  VALUES (p_company_id, v_email, '!invite-pending', btrim(p_first_name), btrim(p_last_name),
          v_role, left(NULLIF(btrim(p_phone), ''), 20))
  RETURNING id INTO v_user;
  RETURN v_user;
END;
$$;
REVOKE ALL ON FUNCTION admin_add_client_login(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_add_client_login(uuid, text, text, text, text) TO constructpm_factoring_admin;

-- Who can sign in for a funding client, and whether they've set a password.
CREATE OR REPLACE FUNCTION admin_client_logins(p_company_id uuid)
RETURNS TABLE(user_id uuid, email text, first_name text, last_name text, role user_role,
              phone text, pending boolean, last_login_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.phone::text,
         u.password_hash = '!invite-pending', u.last_login_at
    FROM users u
   WHERE u.company_id = p_company_id AND u.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM factoring_clients fc WHERE fc.company_id = p_company_id)
   ORDER BY (u.role = 'owner') DESC, u.created_at;
$$;
REVOKE ALL ON FUNCTION admin_client_logins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_client_logins(uuid) TO constructpm_factoring_admin;

-- A set-password link for one of a funding client's logins (also a reset).
-- Only for a user at that company, and only if the company is a funding client.
CREATE OR REPLACE FUNCTION admin_client_invite(
  p_company_id uuid, p_user_id uuid, p_token_hash text, p_ttl_days int
) RETURNS TABLE(email text, first_name text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM factoring_clients fc WHERE fc.company_id = p_company_id) THEN
    RAISE EXCEPTION 'that company is not a funding client' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user_id AND u.company_id = p_company_id
                    AND u.deleted_at IS NULL AND u.is_active) THEN
    RAISE EXCEPTION 'that login is not at this client' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM create_user_invite(p_user_id, p_token_hash, p_ttl_days);
  RETURN QUERY SELECT u.email, u.first_name FROM users u WHERE u.id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION admin_client_invite(uuid, uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_client_invite(uuid, uuid, text, int) TO constructpm_factoring_admin;
