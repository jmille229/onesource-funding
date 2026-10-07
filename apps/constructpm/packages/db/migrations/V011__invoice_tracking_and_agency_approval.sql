-- ═══════════════════════════════════════════════════════════════════════════
-- V011 — Invoices are tracked, not sent; funding needs the agency's approval
--
-- ConstructPM does not replace how a contractor bills an agency. They keep
-- submitting through the agency's portal, by email or by mail; the app is the
-- record of where each invoice stands. So an invoice now follows the agency's
-- own lifecycle:
--
--   draft ─► sent ("submitted to agency") ─► approved ─► partially_paid / paid
--                     │          ▲
--                     ▼          │ resubmitted
--                  returned ─────┘  ("returned for correction")
--
-- 'sent' keeps its name in the enum so existing rows and reports need no
-- rewrite; the UI labels it "Submitted to agency".
--
-- One Source never funds before the agency approves an invoice, and what
-- counts as proof of approval depends on the agency. That rule lives on
-- factoring_debtors (operator-controlled), and the client app reads it only
-- through agency_approval_requirement() below.
-- ═══════════════════════════════════════════════════════════════════════════

-- New statuses. ADD VALUE inside a transaction is allowed on PG12+; the values
-- just can't be used until the transaction commits, and nothing below uses them.
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'approved' AFTER 'viewed';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'returned' AFTER 'approved';

-- ─── Submission and approval tracking ────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS submitted_on      DATE,
  ADD COLUMN IF NOT EXISTS submission_method TEXT,
  ADD COLUMN IF NOT EXISTS agency_reference  TEXT,
  ADD COLUMN IF NOT EXISTS approved_on       DATE,
  ADD COLUMN IF NOT EXISTS returned_on       DATE,
  ADD COLUMN IF NOT EXISTS return_note       TEXT;

DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_submission_method_ck
    CHECK (submission_method IS NULL
           OR submission_method IN ('portal','email','mail','in_person','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Invoices marked "sent" before this migration were submitted on that date.
UPDATE invoices SET submitted_on = sent_at::date
 WHERE sent_at IS NOT NULL AND submitted_on IS NULL;

-- ─── Payments received ───────────────────────────────────────────────────────
-- One row per payment, so a partial payment keeps its own date and reference
-- instead of the next one overwriting it.
CREATE TABLE IF NOT EXISTS invoice_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount       NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  paid_on      DATE NOT NULL,
  reference    TEXT,
  recorded_by  UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

-- Same tenant isolation as every other company-owned table (see V002).
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_payments_isolation ON invoice_payments;
CREATE POLICY invoice_payments_isolation ON invoice_payments
  FOR ALL TO constructpm_app
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
-- Payments are a record: insert and read, never edit. V002's default privileges
-- grant full DML on new tables, so revoke first rather than only granting.
REVOKE ALL ON invoice_payments FROM constructpm_app;
GRANT SELECT, INSERT ON invoice_payments TO constructpm_app;

-- ─── Document labels ─────────────────────────────────────────────────────────
-- What an attachment *is*, so underwriting can see "agency approval" rather
-- than guessing from a file name, and so the funding check can ask whether the
-- right kind of proof is on file.
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS doc_type TEXT;

DO $$ BEGIN
  ALTER TABLE file_attachments ADD CONSTRAINT file_attachments_doc_type_ck
    CHECK (doc_type IS NULL OR doc_type IN (
      'invoice_as_submitted',   -- the invoice exactly as sent to the agency
      'approved_invoice',       -- the invoice showing the agency's approval
      'approval_email',         -- written approval from the agency
      'portal_screenshot',      -- agency portal showing approved / scheduled
      'certified_pay_app',      -- certified payment application
      'contract_po',            -- contract or purchase order
      'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The operator role's column grant (V005) is explicit, so the new column has
-- to be added to it. The row policy still limits it to funding-request files.
GRANT SELECT (doc_type) ON file_attachments TO constructpm_factoring_admin;

-- ─── Per-agency approval proof (operator-controlled) ─────────────────────────
-- Which kinds of proof One Source accepts that an agency has approved an
-- invoice, plus optional instructions shown to the client ("upload the ECMS
-- screen showing Approved for Payment"). Default: the approved invoice itself.
ALTER TABLE factoring_debtors
  ADD COLUMN IF NOT EXISTS approval_evidence     TEXT[] NOT NULL DEFAULT ARRAY['approved_invoice'],
  ADD COLUMN IF NOT EXISTS approval_instructions TEXT;

DO $$ BEGIN
  ALTER TABLE factoring_debtors ADD CONSTRAINT factoring_debtors_approval_evidence_ck
    CHECK (cardinality(approval_evidence) > 0
           AND approval_evidence <@ ARRAY['approved_invoice','approval_email',
                                          'portal_screenshot','certified_pay_app']);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The client app has no grant on factoring_debtors (cross-tenant, operator
-- only). This is its one window onto it: given the agency name on an invoice,
-- return what proof of approval is accepted — and nothing else about the
-- agency. Matching mirrors the underwriting engine (legal name or DBA,
-- case- and whitespace-insensitive); an unknown agency gets the default rule.
CREATE OR REPLACE FUNCTION agency_approval_requirement(p_customer_name text)
RETURNS TABLE(accepted text[], instructions text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(d.approval_evidence, ARRAY['approved_invoice']),
         d.approval_instructions
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT approval_evidence, approval_instructions
        FROM factoring_debtors
       WHERE LOWER(BTRIM(legal_name)) = LOWER(BTRIM(p_customer_name))
          OR LOWER(BTRIM(COALESCE(dba,''))) = LOWER(BTRIM(p_customer_name))
       ORDER BY legal_name
       LIMIT 1
    ) d ON TRUE;
$$;

REVOKE ALL ON FUNCTION agency_approval_requirement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agency_approval_requirement(text) TO constructpm_app;
