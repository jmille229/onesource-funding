-- ═══════════════════════════════════════════════════════════════════════════
-- V022 — Sending the app's email through the company's Google mailbox
-- ═══════════════════════════════════════════════════════════════════════════
-- Some hosts (DigitalOcean among them) block outgoing mail ports, so SMTP
-- can't reach Google. The Gmail API is HTTPS, which isn't blocked. An operator
-- connects one Google mailbox from the console with permission to send only
-- (gmail.send: no reading); the refresh token Google returns is stored here,
-- encrypted with APPLICATION_DATA_KEY by the API before it arrives.
--
-- One row at most. Neither database role can read the table directly: the
-- app role gets the token through mail_google_get() (it sends password resets
-- and invites), the operator role connects and disconnects through the
-- functions below, and only status — never the token — goes back to the console.

CREATE TABLE IF NOT EXISTS mail_connections (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider       TEXT NOT NULL DEFAULT 'google' CHECK (provider = 'google'),
  email          TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,          -- "v1:<iv>:<tag>:<ciphertext>", see lib/secrets.ts
  scopes         TEXT NOT NULL,
  connected_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  -- Millisecond precision: the API hands this back to identify the connection,
  -- and JavaScript dates stop at milliseconds.
  connected_at   TIMESTAMPTZ NOT NULL DEFAULT date_trunc('milliseconds', NOW()),
  -- 'broken' once Google refuses the token (password changed, access removed):
  -- the console says so and offers Reconnect.
  status         TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'broken')),
  last_error     TEXT,
  last_error_at  TIMESTAMPTZ,
  last_sent_at   TIMESTAMPTZ
);
ALTER TABLE mail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_connections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mail_connections FROM PUBLIC;
REVOKE ALL ON mail_connections FROM constructpm_app;
REVOKE ALL ON mail_connections FROM constructpm_factoring_admin;

-- The sender: what the API needs to send a message.
CREATE OR REPLACE FUNCTION mail_google_get()
RETURNS TABLE(email text, refresh_token text, status text, connected_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT m.email, m.refresh_token, m.status, m.connected_at FROM mail_connections m;
$$;

-- What happened on a send. Matched on connected_at so a failure from a token
-- that has since been replaced can't mark the new connection broken.
CREATE OR REPLACE FUNCTION mail_google_result(p_connected_at timestamptz, p_ok boolean,
                                              p_error text DEFAULT NULL, p_broken boolean DEFAULT FALSE)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  UPDATE mail_connections
     SET last_sent_at  = CASE WHEN p_ok THEN NOW() ELSE last_sent_at END,
         last_error    = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END,
         last_error_at = CASE WHEN p_ok THEN last_error_at ELSE NOW() END,
         status        = CASE WHEN p_ok THEN 'ok' WHEN p_broken THEN 'broken' ELSE status END
   WHERE connected_at = p_connected_at;
$$;

-- For the console: everything but the token.
CREATE OR REPLACE FUNCTION mail_google_status()
RETURNS TABLE(email text, status text, last_error text, last_error_at timestamptz,
              last_sent_at timestamptz, connected_at timestamptz, connected_by text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT m.email, m.status, m.last_error, m.last_error_at, m.last_sent_at, m.connected_at, p.email
    FROM mail_connections m LEFT JOIN platform_users p ON p.id = m.connected_by;
$$;

-- Connect (or reconnect): replaces any earlier connection.
CREATE OR REPLACE FUNCTION mail_google_save(p_email text, p_refresh_token text, p_scopes text, p_by uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  INSERT INTO mail_connections (id, email, refresh_token, scopes, connected_by, connected_at, status)
  VALUES (1, lower(p_email), p_refresh_token, p_scopes, p_by, date_trunc('milliseconds', clock_timestamp()), 'ok')
  ON CONFLICT (id) DO UPDATE
     SET email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token, scopes = EXCLUDED.scopes,
         connected_by = EXCLUDED.connected_by, connected_at = EXCLUDED.connected_at, status = 'ok',
         last_error = NULL, last_error_at = NULL, last_sent_at = NULL;
$$;

-- Disconnect: returns the old (encrypted) token so the API can revoke it at Google.
CREATE OR REPLACE FUNCTION mail_google_clear()
RETURNS TABLE(email text, refresh_token text)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  DELETE FROM mail_connections RETURNING mail_connections.email, mail_connections.refresh_token;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['mail_google_get()', 'mail_google_result(timestamptz, boolean, text, boolean)',
                           'mail_google_status()', 'mail_google_save(text, text, text, uuid)', 'mail_google_clear()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION mail_google_get(), mail_google_result(timestamptz, boolean, text, boolean)
  TO constructpm_app, constructpm_factoring_admin;
GRANT EXECUTE ON FUNCTION mail_google_status(), mail_google_save(text, text, text, uuid), mail_google_clear()
  TO constructpm_factoring_admin;
