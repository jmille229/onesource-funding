-- ═══════════════════════════════════════════════════════════════════════════
-- V010 — An operator-entered request no longer requires an invoice number
--
-- BUG FIX. V006 added funding_request_anchor_ck to guarantee every request
-- points at something real:
--
--   CHECK (invoice_id IS NOT NULL
--          OR (source = 'operator' AND invoice_number IS NOT NULL
--              AND btrim(invoice_number) <> ''))
--
-- V008 then made the invoice number optional across the product — the operator
-- console invites "leave blank when the invoice hasn't been numbered yet", and
-- every row already carries an app-generated UUID as its stable identifier. The
-- two changes contradict each other: keying in a request with a blank invoice
-- number sets invoice_id = NULL and invoice_number = NULL, which the old
-- constraint rejects. The insert failed with a check violation and the operator
-- saw a generic error on "Enter and score".
--
-- The anchor the constraint really wants is "this request is attributable": an
-- in-app request must reference a ConstructPM invoice; an operator request is
-- anchored by being operator-entered — its amount, agency, customer name and
-- UUID are the substance, exactly as a blank-invoice-number advance is in the
-- book. So: operator requests need only source = 'operator'.
--
-- Idempotent: DROP IF EXISTS then re-add.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE funding_requests
  DROP CONSTRAINT IF EXISTS funding_request_anchor_ck;

ALTER TABLE funding_requests
  ADD CONSTRAINT funding_request_anchor_ck CHECK (
    invoice_id IS NOT NULL
    OR source = 'operator'
  );
