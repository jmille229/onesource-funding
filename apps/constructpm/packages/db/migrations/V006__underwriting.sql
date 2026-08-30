-- ═══════════════════════════════════════════════════════════════════════════
-- V006 — Underwriting decision engine
--
-- Everything here is derived from the historical advance book (339 advances,
-- 17 clients, 16 creditors, Jul 2025 – Aug 2026). The numbers that shaped it:
--
--   • One client (BDFS) reached $317,251 concurrent exposure in 14 weeks and
--     left $184,698 unpaid. Lifetime fees across the whole book are $158,559.
--     A single unchecked client cost more than every fee ever earned.
--   • The two advances written with no invoice number ("-") are both unpaid.
--     $89,987, a 100% loss rate on that signal.
--   • Their creditor (NKCDC) is the only debtor in the book scoring zero on all
--     four verification attributes OneSource already tracks by hand — no portal,
--     no invoice confirmation, no ACH redirection, no staff contact — and is
--     0-for-2 on repayment.
--
-- So the engine is built around three ideas, in order of proven value:
--   1. Hard stops for signals that have never once produced a good outcome.
--   2. A graduated exposure limit that starts small and earns up with settled
--      history, so no client can ramp faster than their record justifies.
--   3. A transparent score assembled from factors an operator can read and
--      argue with, recorded in full on every decision.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Debtor verification attributes ────────────────────────────────────────
-- These four columns are a direct port of OneSource's existing "Creditor
-- Underwriting" spreadsheet. They are the strongest single predictor in the
-- book: the one creditor scoring zero on all four lost 100% of what it was
-- advanced. They answer one question — can we independently confirm this
-- invoice is real and get paid directly?

DO $$ BEGIN
  CREATE TYPE invoice_confirmation_mode AS ENUM ('none', 'confirmed', 'purchase_order');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE factoring_debtors
  ADD COLUMN IF NOT EXISTS portal_visibility    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_confirmation invoice_confirmation_mode NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ach_change           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS staff_communication  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_notes   TEXT;

COMMENT ON COLUMN factoring_debtors.portal_visibility IS
  'We can see invoice/payment status in the agency''s own portal.';
COMMENT ON COLUMN factoring_debtors.invoice_confirmation IS
  'none = cannot confirm an invoice exists; confirmed = AP will verify; purchase_order = we can tie it to a PO.';
COMMENT ON COLUMN factoring_debtors.ach_change IS
  'The agency will redirect remittance to us. Without this the client receives the money and must forward it — which is how conversion happens.';

-- ─── Client underwriting attributes ────────────────────────────────────────
-- Port of the existing "Client Underwriting" sheet, plus the two questions the
-- CEO wants asked during factoring onboarding: does the client use
-- subcontractors, and do they bill progress payments. Both are real exposure —
-- unpaid subs generate claims against the same receivable, and progress work
-- carries withholding risk when the job is not completed to spec.

DO $$ BEGIN
  CREATE TYPE screening_status AS ENUM ('unknown', 'clean', 'present');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE factoring_clients
  ADD COLUMN IF NOT EXISTS tax_lien_personal     screening_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS tax_lien_business     screening_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS judgement             screening_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS lawsuit               screening_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS existing_ucc          screening_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS ucc_is_prior_factor   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS personal_guarantee    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS uses_subs             BOOLEAN,
  ADD COLUMN IF NOT EXISTS does_progress_billing BOOLEAN,
  ADD COLUMN IF NOT EXISTS negative_list         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS negative_list_reason  TEXT;

COMMENT ON COLUMN factoring_clients.ucc_is_prior_factor IS
  'An existing UCC-1 filed by another factor. The one client who took funds and did not repay carried exactly this.';
COMMENT ON COLUMN factoring_clients.uses_subs IS
  'NULL = never asked. Asked during factoring onboarding: unpaid subs create competing claims on the receivable we advance against.';
COMMENT ON COLUMN factoring_clients.does_progress_billing IS
  'NULL = never asked. Progress-billed work can be withheld for incomplete or non-conforming performance.';
COMMENT ON COLUMN factoring_clients.credit_limit IS
  'Manual override. When set it wins over the graduated limit the engine computes; NULL means the engine governs.';

-- ─── Policy ────────────────────────────────────────────────────────────────
-- Every tunable number lives in one row so thresholds can be changed without a
-- deploy, and so a decision can name the policy version that produced it. Rows
-- are append-only: superseding a policy inserts a new version rather than
-- editing the old one, because a decision must always be re-explainable against
-- the rules that were actually in force.

CREATE TABLE IF NOT EXISTS underwriting_policy (
  version                  INT PRIMARY KEY,
  effective_from           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Decisioning. auto_approve_enabled is OFF by default: at current volume
  -- OneSource wants eyes on every invoice. The engine still scores and bands
  -- every request, so switching this on later changes who clicks the button,
  -- not how the decision is reached.
  auto_approve_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  auto_approve_ceiling     NUMERIC(15,2) NOT NULL DEFAULT 15000,
  clean_score              INT NOT NULL DEFAULT 75,   -- >= this is auto-approvable
  decline_score            INT NOT NULL DEFAULT 50,   -- < this is decline-recommended

  -- Graduated exposure. A new client starts at starting_limit; every advance
  -- that settles within on_time_days raises the ceiling by limit_step, every
  -- late one lowers it.
  --
  -- starting_limit is OneSource's existing policy for new clients. limit_step is
  -- not — there is no formal step today, so it was derived by replaying the book:
  -- any step below ~$100,000 avoids the whole historical loss (the starting limit
  -- does that work), while above it one settled advance buys enough headroom for
  -- the $94,710 advance that went bad. Tune it; it is a proposal, not a constant.
  starting_limit           NUMERIC(15,2) NOT NULL DEFAULT 50000,
  limit_step               NUMERIC(15,2) NOT NULL DEFAULT 25000,
  max_limit                NUMERIC(15,2) NOT NULL DEFAULT 300000,
  on_time_days             INT NOT NULL DEFAULT 75,
  impairment_days          INT NOT NULL DEFAULT 120,  -- open past this = impaired

  -- Advance rate. 80% is the whole book's median and mean; the engine may
  -- recommend a band around it but never silently departs from the default.
  default_advance_rate_pct NUMERIC(7,4) NOT NULL DEFAULT 80,
  min_advance_rate_pct     NUMERIC(7,4) NOT NULL DEFAULT 70,
  max_advance_rate_pct     NUMERIC(7,4) NOT NULL DEFAULT 85,

  -- Invoices above this get extra scrutiny: ~12% of the book, and the segment
  -- where progress billing and its withholding rules live.
  large_invoice_threshold  NUMERIC(15,2) NOT NULL DEFAULT 30000,
  -- A single invoice this many times the client's trailing median is a step-up.
  -- The unpaid $118,388 advance was ~8x the portfolio median.
  step_up_multiple         NUMERIC(7,2) NOT NULL DEFAULT 3.0,
  -- No single debtor may exceed this share of the open book.
  debtor_concentration_pct NUMERIC(7,4) NOT NULL DEFAULT 40,

  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO underwriting_policy (version, notes)
VALUES (1, 'Initial policy calibrated against the Jul 2025 – Aug 2026 advance book.')
ON CONFLICT (version) DO NOTHING;

-- ─── Decisions ─────────────────────────────────────────────────────────────
-- One row per scoring run, holding the full input snapshot and every factor
-- that moved the score. Two reasons this is a table and not a computed view:
-- an automated decision has to be auditable after the fact, and re-scoring
-- later against changed data must not rewrite history.

DO $$ BEGIN
  CREATE TYPE underwriting_action AS ENUM ('approve', 'refer', 'decline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS underwriting_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_request_id    UUID NOT NULL REFERENCES funding_requests(id) ON DELETE CASCADE,
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  policy_version        INT NOT NULL REFERENCES underwriting_policy(version),

  score                 INT NOT NULL,
  action                underwriting_action NOT NULL,
  auto_applied          BOOLEAN NOT NULL DEFAULT FALSE,

  -- Three separate lists because they mean different things to the operator.
  -- hard_stops are never funded. referrals are routinely fine but need a person:
  -- replaying the book with the exposure ceiling as a hard decline blocks $35,776
  -- of fees from clients who repaid in full, $28,834 of it from one good client.
  -- factors are the scored detail behind the number.
  hard_stops            JSONB NOT NULL DEFAULT '[]'::jsonb,
  referrals             JSONB NOT NULL DEFAULT '[]'::jsonb,
  factors               JSONB NOT NULL DEFAULT '[]'::jsonb,
  inputs                JSONB NOT NULL DEFAULT '{}'::jsonb,

  recommended_advance_rate_pct NUMERIC(7,4),
  exposure_limit        NUMERIC(15,2),
  exposure_current      NUMERIC(15,2),
  exposure_headroom     NUMERIC(15,2),

  -- Populated only when a human departs from the engine.
  overridden_by         UUID REFERENCES platform_users(id),
  override_action       underwriting_action,
  override_reason       TEXT,
  overridden_at         TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uw_score_ck    CHECK (score BETWEEN 0 AND 100),
  CONSTRAINT uw_override_ck CHECK (
    (overridden_by IS NULL AND override_action IS NULL AND overridden_at IS NULL)
    OR
    (overridden_by IS NOT NULL AND override_action IS NOT NULL AND overridden_at IS NOT NULL
     AND override_reason IS NOT NULL AND length(btrim(override_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_uw_decisions_request ON underwriting_decisions(funding_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uw_decisions_company ON underwriting_decisions(company_id, created_at DESC);

COMMENT ON CONSTRAINT uw_override_ck ON underwriting_decisions IS
  'An override is only valid with an author, an action and a stated reason. Departing from the engine without saying why is how a model stops being trustworthy.';

-- ─── Operator-entered invoices ─────────────────────────────────────────────
-- Clients still email and text invoices. Those need to reach the same engine as
-- in-app requests, so the operator can key one in and have it scored identically
-- rather than deciding by eye off-system.

ALTER TABLE funding_requests
  ADD COLUMN IF NOT EXISTS source           TEXT NOT NULL DEFAULT 'client_app',
  ADD COLUMN IF NOT EXISTS entered_by       UUID REFERENCES platform_users(id),
  ADD COLUMN IF NOT EXISTS debtor_id        UUID REFERENCES factoring_debtors(id);

COMMENT ON COLUMN funding_requests.source IS
  'client_app = raised in the client UI; operator = keyed in by OneSource from an emailed or texted invoice.';
COMMENT ON COLUMN funding_requests.debtor_id IS
  'Which agency owes. Set directly on operator-entered requests; resolved from the invoice customer for in-app ones.';

-- invoice_id is NOT NULL from V005, which assumed every request starts from an
-- in-app invoice. Operator-entered requests have no ConstructPM invoice behind
-- them, so the column has to become nullable — with a check that a request is
-- always anchored to one or the other.
ALTER TABLE funding_requests ALTER COLUMN invoice_id DROP NOT NULL;

ALTER TABLE funding_requests
  DROP CONSTRAINT IF EXISTS funding_request_anchor_ck;
ALTER TABLE funding_requests
  ADD CONSTRAINT funding_request_anchor_ck CHECK (
    invoice_id IS NOT NULL
    OR (source = 'operator' AND invoice_number IS NOT NULL AND btrim(invoice_number) <> '')
  );

-- ─── Privileges ────────────────────────────────────────────────────────────
-- V002 sets ALTER DEFAULT PRIVILEGES for constructpm_app, so new tables arrive
-- with grants already attached. Revoke first, then grant back only what the
-- tenant actually needs — otherwise the app role silently gains write access to
-- the underwriting tables.

REVOKE ALL ON underwriting_policy    FROM constructpm_app;
REVOKE ALL ON underwriting_decisions FROM constructpm_app;

-- The tenant sees its own limit and headroom (product decision: the client sees
-- the numbers so they can plan, but never the reasons behind a decision — those
-- would teach them which rule to work around).
GRANT SELECT (id, company_id, exposure_limit, exposure_current, exposure_headroom, created_at)
  ON underwriting_decisions TO constructpm_app;

-- The four numbers that decide a client's ceiling are deliberately visible to
-- them, so the app can compute and display a live limit from the tenant pool
-- without reaching across companies. Telling a contractor "every advance you
-- repay on time raises your ceiling by $15,000" is the point of a graduated
-- limit — it is the mechanism that earns the second and third transaction.
-- The scoring thresholds are NOT granted: publishing those teaches people which
-- rule to work around.
GRANT SELECT (version, starting_limit, limit_step, max_limit, on_time_days)
  ON underwriting_policy TO constructpm_app;

ALTER TABLE underwriting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE underwriting_decisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uw_decisions_tenant_read ON underwriting_decisions;
CREATE POLICY uw_decisions_tenant_read ON underwriting_decisions
  FOR SELECT TO constructpm_app
  USING (company_id = current_company_id());

DROP POLICY IF EXISTS uw_decisions_admin_all ON underwriting_decisions;
CREATE POLICY uw_decisions_admin_all ON underwriting_decisions
  FOR ALL TO constructpm_factoring_admin
  USING (TRUE) WITH CHECK (TRUE);

GRANT SELECT, INSERT, UPDATE ON underwriting_decisions TO constructpm_factoring_admin;
GRANT SELECT, INSERT          ON underwriting_policy    TO constructpm_factoring_admin;

-- The operator keys in requests on behalf of clients, so it needs to write the
-- request row itself. It already had SELECT and the approve/decline UPDATE.
GRANT INSERT ON funding_requests TO constructpm_factoring_admin;

-- Operator-entered requests need a company to attach to, chosen from the client
-- book; the console already reads companies for the client list.
GRANT SELECT (id, name) ON companies TO constructpm_factoring_admin;
