-- ═══════════════════════════════════════════════════════════════════════════
-- V012 — Payments on funded invoices
--
-- Once One Source funds an invoice, the agency pays One Source, not the
-- contractor. Two things follow:
--
--   1. When One Source records the collection, the contractor's own invoice in
--      ConstructPM should show as paid without them entering anything. A
--      trigger on the factoring ledger does that.
--
--   2. If the contractor records a payment on a funded invoice themselves, the
--      agency has probably paid them directly — money that belongs to One
--      Source under the assignment. The app asks them to confirm, and a
--      confirmed report lands on One Source's ledger (and inbox) the same day.
--      Under full recourse that is something to know about immediately.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE factoring_event_type ADD VALUE IF NOT EXISTS 'direct_payment_reported';

-- ─── Who recorded a payment ──────────────────────────────────────────────────
-- 'client'     entered by the contractor
-- 'one_source' written when One Source collected on a funded invoice
ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'client',
  -- The contractor said the agency paid them directly on a funded invoice.
  ADD COLUMN IF NOT EXISTS paid_direct_on_funded BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_source_ck
    CHECK (source IN ('client', 'one_source'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A One Source collection has no tenant user behind it.
ALTER TABLE invoice_payments ALTER COLUMN recorded_by DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_recorded_by_ck
    CHECK (source = 'one_source' OR recorded_by IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 1. Collection marks the contractor's invoice paid ───────────────────────
-- Fires on the ledger row the operator console writes when it records a
-- collection. SECURITY DEFINER: the operator role has no write access to
-- tenant invoices, and shouldn't — this function is the one narrow path, and
-- it only ever applies a payment to the invoice the advance was made against.
CREATE OR REPLACE FUNCTION apply_collection_to_invoice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_invoice_id uuid;
  v_balance    numeric;
  v_status     text;
  v_apply      numeric;
BEGIN
  IF NEW.event_type <> 'payment_received' OR COALESCE(NEW.amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT invoice_id INTO v_invoice_id
    FROM factored_invoices WHERE id = NEW.factored_invoice_id;
  IF v_invoice_id IS NULL THEN
    RETURN NEW;   -- advanced against an invoice raised outside ConstructPM
  END IF;

  SELECT balance_due, status::text INTO v_balance, v_status
    FROM invoices
   WHERE id = v_invoice_id AND company_id = NEW.company_id AND deleted_at IS NULL
   FOR UPDATE;
  -- Already settled (e.g. the client recorded a direct payment first) or void:
  -- nothing to apply, and never push a balance negative.
  IF NOT FOUND OR v_status = 'void' OR v_balance <= 0 THEN
    RETURN NEW;
  END IF;

  v_apply := LEAST(NEW.amount, v_balance);

  INSERT INTO invoice_payments (company_id, invoice_id, amount, paid_on, reference, source)
  VALUES (NEW.company_id, v_invoice_id, v_apply, NEW.occurred_on, 'Collected by One Source', 'one_source');

  UPDATE invoices
     SET paid_amount = paid_amount + v_apply,
         balance_due = balance_due - v_apply,
         status = CASE WHEN balance_due - v_apply <= 0.005 THEN 'paid'::invoice_status
                       ELSE 'partially_paid'::invoice_status END,
         updated_at = NOW()
   WHERE id = v_invoice_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS factoring_events_apply_collection ON factoring_events;
CREATE TRIGGER factoring_events_apply_collection
  AFTER INSERT ON factoring_events
  FOR EACH ROW EXECUTE FUNCTION apply_collection_to_invoice();

-- ─── 2. Client reports a direct payment on a funded invoice ──────────────────
-- Tenants can read the factoring ledger but not write to it. This is the one
-- thing they may add: a report that the agency paid them directly. Scoped to
-- the caller's own company and to an advance that is still open.
CREATE OR REPLACE FUNCTION report_direct_payment(
  p_invoice_id uuid, p_amount numeric, p_paid_on date, p_reference text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := current_company_id();
  v_fi      uuid;
  v_event   uuid;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'no tenant context';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  SELECT id INTO v_fi
    FROM factored_invoices
   WHERE invoice_id = p_invoice_id AND company_id = v_company
     AND status IN ('pending', 'advanced')
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_fi IS NULL THEN
    RETURN NULL;   -- not funded (or already collected): nothing to report
  END IF;

  INSERT INTO factoring_events (company_id, factored_invoice_id, event_type, amount, occurred_on, memo)
  VALUES (v_company, v_fi, 'direct_payment_reported', p_amount, COALESCE(p_paid_on, CURRENT_DATE),
          'Client reports the agency paid them directly'
          || CASE WHEN NULLIF(btrim(p_reference), '') IS NOT NULL THEN ' — ref ' || btrim(p_reference) ELSE '' END)
  RETURNING id INTO v_event;
  RETURN v_event;
END;
$$;

REVOKE ALL ON FUNCTION report_direct_payment(uuid, numeric, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_direct_payment(uuid, numeric, date, text) TO constructpm_app;
REVOKE ALL ON FUNCTION apply_collection_to_invoice() FROM PUBLIC;
