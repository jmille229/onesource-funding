-- ═══════════════════════════════════════════════════════════════════════════
-- V020 — Account security: password reset, email verification, two-step
-- sign-in
--
-- All of this happens before (or outside) a tenant session, so — like the
-- existing auth_* functions — it runs through SECURITY DEFINER functions with
-- narrow inputs. The tables they touch have no grants to the app role.
--
--   Password reset    one-time link, 1 hour, emailed; using it sets the
--                     password, ends every session, and proves the inbox.
--   Email verification one-time link; new self-serve signups start unverified.
--   Two-step sign-in  TOTP (authenticator app) + ten one-time recovery codes.
--                     Optional per person; a company can require it. Required
--                     for every operator of the console.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── One table of one-time links, by purpose ────────────────────────────────
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'invite';
DO $$ BEGIN
  ALTER TABLE user_invites ADD CONSTRAINT user_invites_purpose_ck CHECK (purpose IN ('invite', 'reset', 'verify'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An email-verification link must never set a password.
CREATE OR REPLACE FUNCTION auth_invite_info(p_token_hash text)
RETURNS TABLE(email text, first_name text, company_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.email, u.first_name, c.name
    FROM user_invites i
    JOIN users u ON u.id = i.user_id
    JOIN companies c ON c.id = u.company_id
   WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.expires_at > NOW()
     AND i.purpose IN ('invite', 'reset')
     AND u.is_active AND u.deleted_at IS NULL
   LIMIT 1;
$$;

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
     AND purpose IN ('invite', 'reset')
   RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  -- Setting a password from an emailed link proves the inbox, and ends any
  -- session that was open on the old password.
  UPDATE users SET password_hash = p_password_hash,
                   email_verified_at = COALESCE(email_verified_at, NOW()),
                   updated_at = NOW()
   WHERE users.id = v_user AND is_active AND deleted_at IS NULL;
  UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = v_user AND NOT is_revoked;
  UPDATE user_invites SET expires_at = LEAST(expires_at, NOW())
   WHERE user_id = v_user AND used_at IS NULL AND purpose IN ('invite', 'reset');
  RETURN QUERY
    SELECT u.id, u.company_id, u.email, u.first_name, u.last_name, u.role
      FROM users u WHERE u.id = v_user AND u.is_active AND u.deleted_at IS NULL;
END;
$$;

-- ─── Email verification state ────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
-- Everyone who already has an account was onboarded by One Source or has been
-- using the app; only new self-serve signups start unverified.
UPDATE users SET email_verified_at = COALESCE(last_login_at, created_at) WHERE email_verified_at IS NULL;

-- The second step of sign-in knows the user by id (from its signed challenge),
-- not by email. Same shape and rules as auth_find_user_by_email.
CREATE OR REPLACE FUNCTION auth_find_user_by_id(p_user_id uuid)
RETURNS TABLE(id uuid, company_id uuid, email text, first_name text, last_name text, role user_role, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.id, u.company_id, u.email, u.first_name, u.last_name, u.role, u.password_hash
    FROM users u
   WHERE u.id = p_user_id AND u.is_active AND u.deleted_at IS NULL
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth_find_user_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_id(uuid) TO constructpm_app;

-- ─── Password reset ──────────────────────────────────────────────────────────
-- Returns who to email, or nothing (unknown or inactive address, or a link
-- was sent in the last minute). The API answers the same either way.
CREATE OR REPLACE FUNCTION auth_request_password_reset(p_email text, p_token_hash text)
RETURNS TABLE(email text, first_name text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_user uuid;
BEGIN
  SELECT u.id INTO v_user FROM users u
   WHERE lower(u.email) = lower(p_email) AND u.is_active AND u.deleted_at IS NULL LIMIT 1;
  IF v_user IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM user_invites WHERE user_id = v_user AND purpose = 'reset'
              AND created_at > NOW() - interval '1 minute') THEN
    RETURN;
  END IF;
  UPDATE user_invites SET expires_at = LEAST(expires_at, NOW())
   WHERE user_id = v_user AND used_at IS NULL AND purpose = 'reset';
  INSERT INTO user_invites (user_id, token_hash, expires_at, purpose)
  VALUES (v_user, p_token_hash, NOW() + interval '1 hour', 'reset');
  RETURN QUERY SELECT u.email, u.first_name FROM users u WHERE u.id = v_user;
END;
$$;
REVOKE ALL ON FUNCTION auth_request_password_reset(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_request_password_reset(text, text) TO constructpm_app;

-- ─── Email verification links ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth_create_email_verification(p_user_id uuid, p_token_hash text)
RETURNS TABLE(email text, first_name text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND is_active AND deleted_at IS NULL
                  AND email_verified_at IS NULL) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM user_invites WHERE user_id = p_user_id AND purpose = 'verify'
              AND created_at > NOW() - interval '1 minute') THEN
    RETURN;
  END IF;
  UPDATE user_invites SET expires_at = LEAST(expires_at, NOW())
   WHERE user_id = p_user_id AND used_at IS NULL AND purpose = 'verify';
  INSERT INTO user_invites (user_id, token_hash, expires_at, purpose)
  VALUES (p_user_id, p_token_hash, NOW() + interval '7 days', 'verify');
  RETURN QUERY SELECT u.email, u.first_name FROM users u WHERE u.id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION auth_create_email_verification(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_create_email_verification(uuid, text) TO constructpm_app;

CREATE OR REPLACE FUNCTION auth_verify_email(p_token_hash text)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_user uuid;
BEGIN
  UPDATE user_invites SET used_at = NOW()
   WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > NOW() AND purpose = 'verify'
   RETURNING user_invites.user_id INTO v_user;
  IF v_user IS NULL THEN RETURN; END IF;
  UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = v_user;
  RETURN QUERY SELECT u.id, u.email FROM users u WHERE u.id = v_user;
END;
$$;
REVOKE ALL ON FUNCTION auth_verify_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_verify_email(text) TO constructpm_app;

-- ─── Two-step sign-in (tenant users) ─────────────────────────────────────────
-- users.mfa_enabled / users.mfa_secret exist since V001 and were never used.
-- The secret is encrypted by the API (APPLICATION_DATA_KEY) before it gets
-- here. mfa_last_step stops a code being replayed within its 30 seconds.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_user ON user_mfa_recovery_codes(user_id);
ALTER TABLE user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa_recovery_codes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON user_mfa_recovery_codes FROM constructpm_app;
REVOKE ALL ON user_mfa_recovery_codes FROM PUBLIC;

-- Everything sign-in needs to decide whether to ask for a code.
CREATE OR REPLACE FUNCTION auth_mfa_state(p_user_id uuid)
RETURNS TABLE(mfa_enabled boolean, mfa_secret text, pending_secret boolean, required boolean,
              email_verified boolean, recovery_left int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.mfa_enabled,
         CASE WHEN u.mfa_enabled THEN u.mfa_secret END,
         (NOT u.mfa_enabled AND u.mfa_secret IS NOT NULL),
         COALESCE((c.settings->>'require_mfa')::boolean, FALSE),
         u.email_verified_at IS NOT NULL,
         (SELECT COUNT(*)::int FROM user_mfa_recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL)
    FROM users u JOIN companies c ON c.id = u.company_id
   WHERE u.id = p_user_id AND u.is_active AND u.deleted_at IS NULL;
$$;

-- Start enrolling: keep the new secret aside until a code proves it works.
CREATE OR REPLACE FUNCTION auth_mfa_begin(p_user_id uuid, p_secret_encrypted text)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  UPDATE users SET mfa_secret = p_secret_encrypted, updated_at = NOW()
   WHERE id = p_user_id AND NOT mfa_enabled AND is_active AND deleted_at IS NULL;
$$;

-- The pending secret, for checking the first code.
CREATE OR REPLACE FUNCTION auth_mfa_pending_secret(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT mfa_secret FROM users WHERE id = p_user_id AND NOT mfa_enabled AND is_active AND deleted_at IS NULL;
$$;

-- Turn it on with fresh recovery codes.
CREATE OR REPLACE FUNCTION auth_mfa_enable(p_user_id uuid, p_step bigint, p_recovery_hashes text[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET mfa_enabled = TRUE, mfa_last_step = p_step, updated_at = NOW()
   WHERE id = p_user_id AND NOT mfa_enabled AND mfa_secret IS NOT NULL;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  DELETE FROM user_mfa_recovery_codes WHERE user_id = p_user_id;
  INSERT INTO user_mfa_recovery_codes (user_id, code_hash) SELECT p_user_id, unnest(p_recovery_hashes);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION auth_mfa_disable(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_last_step = 0, updated_at = NOW() WHERE id = p_user_id;
  DELETE FROM user_mfa_recovery_codes WHERE user_id = p_user_id;
END;
$$;

-- A code is good once: record its time step, refusing one at or before the last.
CREATE OR REPLACE FUNCTION auth_mfa_use_step(p_user_id uuid, p_step bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET mfa_last_step = p_step WHERE id = p_user_id AND mfa_enabled AND mfa_last_step < p_step;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION auth_mfa_use_recovery(p_user_id uuid, p_code_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE user_mfa_recovery_codes SET used_at = NOW()
   WHERE id = (SELECT id FROM user_mfa_recovery_codes
                WHERE user_id = p_user_id AND code_hash = p_code_hash AND used_at IS NULL LIMIT 1);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION auth_mfa_new_recovery(p_user_id uuid, p_recovery_hashes text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM user_mfa_recovery_codes WHERE user_id = p_user_id;
  INSERT INTO user_mfa_recovery_codes (user_id, code_hash) SELECT p_user_id, unnest(p_recovery_hashes);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'auth_mfa_state(uuid)', 'auth_mfa_begin(uuid, text)', 'auth_mfa_pending_secret(uuid)',
    'auth_mfa_enable(uuid, bigint, text[])', 'auth_mfa_disable(uuid)', 'auth_mfa_use_step(uuid, bigint)',
    'auth_mfa_use_recovery(uuid, text)', 'auth_mfa_new_recovery(uuid, text[])'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO constructpm_app', f);
  END LOOP;
END $$;

-- ─── Two-step sign-in (operators) ────────────────────────────────────────────
ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfa_secret    TEXT,
  ADD COLUMN IF NOT EXISTS mfa_last_step BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS platform_mfa_recovery_codes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  code_hash        TEXT NOT NULL,
  used_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_mfa_recovery_user ON platform_mfa_recovery_codes(platform_user_id);
-- Platform-level table: the tenant role must never see it (V002's default
-- privileges would otherwise grant it).
REVOKE ALL ON platform_mfa_recovery_codes FROM constructpm_app;
REVOKE ALL ON platform_mfa_recovery_codes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_mfa_recovery_codes TO constructpm_factoring_admin;
GRANT SELECT (mfa_enabled, mfa_secret, mfa_last_step), UPDATE (mfa_enabled, mfa_secret, mfa_last_step)
  ON platform_users TO constructpm_factoring_admin;
