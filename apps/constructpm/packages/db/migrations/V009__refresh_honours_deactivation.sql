-- ═══════════════════════════════════════════════════════════════════════════
-- V009 — The refresh path honours deactivation; tidy a stray default grant
--
-- SECURITY FIX. Login (auth_find_user_by_email) filters on
-- `is_active = true AND deleted_at IS NULL`, but the refresh path
-- (auth_find_refresh_token) did not. Deactivating a user therefore did not log
-- them out: their httpOnly refresh cookie kept minting fresh 15-minute access
-- tokens for the remainder of the 90-day absolute session, and every one of
-- those tokens carried the role read live from the users row. An owner who
-- removed a departing employee's access had, in fact, removed nothing.
--
-- Two changes:
--   1. auth_find_refresh_token returns no row for an inactive or deleted user,
--      so /api/auth/refresh treats their cookie like a revoked one (401, cookie
--      cleared, family revoked).
--   2. Any refresh tokens already held by inactive/deleted users are revoked
--      now, so sessions that were open at the moment of deactivation close on
--      their next refresh rather than running out the clock.
--
-- The settings deactivate endpoint also revokes the user's tokens directly from
-- V009 onward (belt and braces — the function change above is what makes the
-- guarantee hold even if a future write path forgets to).
--
-- Also: schema_migrations is created by the migration runner before any
-- migration runs, so V002's ALTER DEFAULT PRIVILEGES handed the tenant role
-- full DML on it. Harmless in practice, but the tenant role has no business
-- touching the schema history. Revoked.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auth_find_refresh_token(p_hash text)
RETURNS TABLE(id uuid, company_id uuid, user_id uuid, family_id uuid, is_revoked boolean, replaced_by uuid, absolute_expiry timestamptz, role user_role)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rt.id, rt.company_id, rt.user_id, rt.family_id, rt.is_revoked, rt.replaced_by, rt.absolute_expiry, u.role
  FROM refresh_tokens rt
  JOIN users u ON u.id = rt.user_id
  WHERE rt.token_hash = p_hash
    AND u.is_active = true
    AND u.deleted_at IS NULL
  LIMIT 1;
$$;

-- Close sessions that were already open for users deactivated before this fix.
UPDATE refresh_tokens rt
   SET is_revoked = true
  FROM users u
 WHERE u.id = rt.user_id
   AND rt.is_revoked = false
   AND (u.is_active = false OR u.deleted_at IS NOT NULL);

REVOKE ALL ON schema_migrations FROM constructpm_app;
