-- ═══════════════════════════════════════════════════════════════════════════
-- V021 — Malware-scan results, and the business time zone
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Scan results, one per stored object ─────────────────────────────────────
-- Uploads are scanned with ClamAV (when the server has it) right after upload
-- and again before any download that hasn't been scanned. The object is
-- identified by a hash of its storage key, so this table says nothing about
-- whose file it is; it holds no tenant data and needs no row security.
CREATE TABLE IF NOT EXISTS file_scans (
  key_hash    TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('clean', 'infected')),
  signature   TEXT,
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
REVOKE ALL ON file_scans FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON file_scans TO constructpm_app, constructpm_factoring_admin;

-- ─── "Today" is Eastern time ─────────────────────────────────────────────────
-- CURRENT_DATE and timestamp-to-date casts follow the session time zone. The
-- server runs in UTC, so after 7 or 8 pm Eastern "today" was already
-- tomorrow — for fee days, recourse countdowns and default dates. One Source
-- and its clients work on Eastern time.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/New_York');
END $$;
