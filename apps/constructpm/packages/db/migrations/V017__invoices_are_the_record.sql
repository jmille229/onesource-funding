-- ═══════════════════════════════════════════════════════════════════════════
-- V017 — Invoices are the product; funding is a layer on them
--
-- A client's invoice list is the one place they track what they've billed,
-- whether or not One Source funded it. So every advance on the funding ledger
-- now points at an invoice in the client's book:
--
--   * An advance made against an invoice already in ConstructPM (a funding
--     request, or the same invoice number and amount) links to it.
--   * Anything else — the historical book imported from the Advance Book,
--     invoices emailed in and funded by hand — gets an invoice created for it,
--     marked as coming from One Source.
--
-- The ledger stays authoritative for the money. A trigger keeps the invoice in
-- step with it: One Source's collections appear as payments, corrections to an
-- advance's amount or invoice number carry over to an invoice it created.
--
-- Funded invoices are locked for the client: the advance was made on that
-- amount, that agency and that invoice number, so those can't change (or the
-- invoice be voided) from the client side. Notes, documents and the job or
-- contract it's filed under stay editable.
--
-- Also: an invoice no longer has to belong to a job. Government contractors
-- bill against a contract or purchase order, not a construction project, so
-- the job is optional and a contract/PO reference sits on the invoice itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Job optional; contract or PO on the invoice ────────────────────────────
ALTER TABLE invoices ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS contract_reference TEXT;

-- ─── Who created the invoice ────────────────────────────────────────────────
-- 'client'     entered by the contractor
-- 'one_source' created from an advance on the funding ledger
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'client';
DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_source_ck CHECK (source IN ('client', 'one_source'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An invoice created from an advance has no tenant user behind it (the client
-- may not even have a login yet).
ALTER TABLE invoices ALTER COLUMN created_by DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_created_by_ck
    CHECK (source = 'one_source' OR created_by IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_factored_invoices_invoice ON factored_invoices(invoice_id);

-- ─── Invoice number, for matching ───────────────────────────────────────────
-- "INV-0042", "inv 42" and "INV42" are the same invoice.
CREATE OR REPLACE FUNCTION invoice_number_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(upper(regexp_replace(COALESCE(p, ''), '[^A-Za-z0-9]', '', 'g')),
                               '(^|[A-Z])0+(?=[0-9])', '\1', 'g'), '')
$$;

-- ─── Keep an advance's invoice in step with the ledger ──────────────────────
-- SECURITY DEFINER: advances are written by the operator role, which has no
-- write access to tenant invoices and shouldn't. This is the one narrow path,
-- and it only ever touches the invoice the advance belongs to, in that
-- advance's own company.
CREATE OR REPLACE FUNCTION factoring_sync_invoice(p_factored_invoice_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  fi            factored_invoices%ROWTYPE;
  v_inv         uuid;
  v_source      text;
  v_status      text;
  v_deleted     timestamptz;
  v_contact     uuid;
  v_day         date;
  v_number      text;
  v_total       numeric;
  v_client_paid numeric;
  v_applied     numeric := 0;
  v_room        numeric;
  v_paid        numeric;
  ev            record;
BEGIN
  SELECT * INTO fi FROM factored_invoices WHERE id = p_factored_invoice_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_day    := COALESCE(fi.advanced_on, fi.created_at::date);
  v_number := COALESCE(NULLIF(btrim(fi.invoice_number), ''), 'ADV-' || to_char(v_day, 'YYYYMMDD'));

  IF fi.invoice_id IS NOT NULL THEN
    SELECT id, source, status::text, deleted_at INTO v_inv, v_source, v_status, v_deleted
      FROM invoices WHERE id = fi.invoice_id AND company_id = fi.company_id;
    -- Removed or voided on the client side before funded invoices were
    -- locked: leave it as the client left it.
    IF v_inv IS NOT NULL AND (v_deleted IS NOT NULL OR v_status = 'void') THEN
      RETURN v_inv;
    END IF;
  END IF;

  -- Not linked yet: the client may already have this invoice in their book.
  -- Same invoice number and the same amount (within 1%, or a dollar), not
  -- already linked to another live advance. Exactly one, or none.
  IF v_inv IS NULL AND invoice_number_key(fi.invoice_number) IS NOT NULL THEN
    SELECT CASE WHEN COUNT(*) = 1 THEN (array_agg(i.id))[1] END INTO v_inv
      FROM invoices i
     WHERE i.company_id = fi.company_id
       AND i.deleted_at IS NULL AND i.status <> 'void'
       AND invoice_number_key(i.invoice_number) = invoice_number_key(fi.invoice_number)
       AND abs(i.total - fi.face_amount) <= GREATEST(1, 0.01 * fi.face_amount)
       AND NOT EXISTS (SELECT 1 FROM factored_invoices o
                        WHERE o.invoice_id = i.id AND o.id <> fi.id AND o.status <> 'charged_back');
    IF v_inv IS NOT NULL THEN
      SELECT source INTO v_source FROM invoices WHERE id = v_inv;
      UPDATE factored_invoices SET invoice_id = v_inv WHERE id = fi.id;
    END IF;
  END IF;

  -- The agency, as a customer in the client's contacts.
  IF v_inv IS NULL OR v_source = 'one_source' THEN
    SELECT id INTO v_contact FROM contacts
     WHERE company_id = fi.company_id AND deleted_at IS NULL
       AND lower(btrim(name)) = lower(btrim(fi.debtor_name))
     ORDER BY created_at LIMIT 1;
    IF v_contact IS NULL THEN
      INSERT INTO contacts (company_id, name, type, notes)
      VALUES (fi.company_id, btrim(fi.debtor_name), 'customer', 'Added from your One Source funding history')
      RETURNING id INTO v_contact;
    END IF;
  END IF;

  IF v_inv IS NULL THEN
    -- Funded means the agency approved it; it was billed no later than that.
    INSERT INTO invoices
      (company_id, job_id, customer_id, invoice_number, status, issue_date, due_date,
       subtotal, tax_rate, tax_amount, total, paid_amount, balance_due,
       submitted_on, approved_on, source, created_by)
    VALUES
      (fi.company_id, fi.job_id, v_contact, v_number, 'approved', v_day,
       COALESCE(fi.invoice_due_on, v_day + 30),
       fi.face_amount, 0, 0, fi.face_amount, 0, fi.face_amount,
       v_day, v_day, 'one_source', NULL)
    RETURNING id INTO v_inv;
    v_source := 'one_source';
    UPDATE factored_invoices SET invoice_id = v_inv WHERE id = fi.id;
  ELSIF v_source = 'one_source' THEN
    -- An invoice made from the ledger follows the ledger's corrections.
    UPDATE invoices
       SET invoice_number = v_number,
           customer_id    = v_contact,
           job_id         = COALESCE(fi.job_id, job_id),
           issue_date     = v_day,
           due_date       = COALESCE(fi.invoice_due_on, v_day + 30),
           submitted_on   = v_day,
           approved_on    = v_day,
           subtotal       = fi.face_amount,
           total          = fi.face_amount
     WHERE id = v_inv;
  END IF;

  -- One Source's collections, as payments on the invoice. Rebuilt from the
  -- ledger each time, so a corrected or re-imported payment never doubles.
  -- The client's own payments stay; One Source's are applied after them and
  -- never push the balance below zero.
  SELECT total INTO v_total FROM invoices WHERE id = v_inv FOR UPDATE;
  SELECT COALESCE(SUM(amount), 0) INTO v_client_paid
    FROM invoice_payments WHERE invoice_id = v_inv AND source = 'client';
  DELETE FROM invoice_payments WHERE invoice_id = v_inv AND source = 'one_source';
  FOR ev IN
    SELECT fe.amount, fe.occurred_on
      FROM factoring_events fe
      JOIN factored_invoices f ON f.id = fe.factored_invoice_id
     WHERE f.invoice_id = v_inv AND fe.event_type = 'payment_received' AND fe.amount > 0
     ORDER BY fe.occurred_on, fe.created_at
  LOOP
    v_room := v_total - v_client_paid - v_applied;
    EXIT WHEN v_room <= 0.005;
    INSERT INTO invoice_payments (company_id, invoice_id, amount, paid_on, reference, source)
    VALUES (fi.company_id, v_inv, LEAST(ev.amount, v_room), ev.occurred_on, 'Collected by One Source', 'one_source');
    v_applied := v_applied + LEAST(ev.amount, v_room);
  END LOOP;

  v_paid := v_client_paid + v_applied;
  UPDATE invoices
     SET paid_amount = v_paid,
         balance_due = GREATEST(total - v_paid, 0),
         -- Funded means the agency approved it. Unpaid (or a payment that
         -- came off the ledger) is approved and awaiting payment.
         status = CASE
           WHEN v_paid >= total - 0.005 THEN 'paid'::invoice_status
           WHEN v_paid > 0 THEN 'partially_paid'::invoice_status
           ELSE 'approved'::invoice_status
         END,
         submitted_on = COALESCE(submitted_on, v_day),
         approved_on  = COALESCE(approved_on, v_day),
         updated_at = NOW()
   WHERE id = v_inv;

  RETURN v_inv;
END;
$$;
REVOKE ALL ON FUNCTION factoring_sync_invoice(uuid) FROM PUBLIC;

-- ─── Triggers: any change on the ledger reaches the invoice ─────────────────
CREATE OR REPLACE FUNCTION factored_invoices_sync_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM factoring_sync_invoice(NEW.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION factored_invoices_sync_trg() FROM PUBLIC;

DROP TRIGGER IF EXISTS factored_invoices_sync_ins ON factored_invoices;
CREATE TRIGGER factored_invoices_sync_ins
  AFTER INSERT ON factored_invoices
  FOR EACH ROW EXECUTE FUNCTION factored_invoices_sync_trg();

-- Only the fields an invoice reflects. Linking (invoice_id) isn't listed, so
-- the sync's own link-up doesn't re-trigger it.
DROP TRIGGER IF EXISTS factored_invoices_sync_upd ON factored_invoices;
CREATE TRIGGER factored_invoices_sync_upd
  AFTER UPDATE OF face_amount, invoice_number, debtor_id, debtor_name, advanced_on, invoice_due_on, job_id
  ON factored_invoices
  FOR EACH ROW EXECUTE FUNCTION factored_invoices_sync_trg();

-- Payments only: a client's direct-payment report is applied to the invoice
-- by the route that records it, so those events must not be counted here.
CREATE OR REPLACE FUNCTION factoring_events_sync_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.event_type = 'payment_received' THEN
    PERFORM factoring_sync_invoice(NEW.factored_invoice_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.event_type = 'payment_received'
     AND (TG_OP = 'DELETE' OR OLD.factored_invoice_id <> NEW.factored_invoice_id
          OR NEW.event_type <> 'payment_received') THEN
    PERFORM factoring_sync_invoice(OLD.factored_invoice_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION factoring_events_sync_trg() FROM PUBLIC;

-- Replaces V012's insert-only trigger, which this covers.
DROP TRIGGER IF EXISTS factoring_events_apply_collection ON factoring_events;
DROP FUNCTION IF EXISTS apply_collection_to_invoice();
DROP TRIGGER IF EXISTS factoring_events_sync ON factoring_events;
CREATE TRIGGER factoring_events_sync
  AFTER INSERT OR UPDATE OR DELETE ON factoring_events
  FOR EACH ROW EXECUTE FUNCTION factoring_events_sync_trg();

-- ─── Funded invoices are locked for the client ──────────────────────────────
-- Applies to the tenant role only: One Source's own sync (above) runs as the
-- owner and keeps an invoice it created in step with the ledger. The API
-- refuses these edits first with a clear message; this is the backstop.
CREATE OR REPLACE FUNCTION invoices_lock_funded() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'constructpm_app' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM factored_invoices WHERE invoice_id = OLD.id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE'
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.customer_id    IS DISTINCT FROM OLD.customer_id
     OR NEW.total          IS DISTINCT FROM OLD.total
     OR NEW.subtotal       IS DISTINCT FROM OLD.subtotal
     OR NEW.tax_amount     IS DISTINCT FROM OLD.tax_amount
     OR NEW.issue_date     IS DISTINCT FROM OLD.issue_date
     OR (NEW.status IS DISTINCT FROM OLD.status
         AND NEW.status::text IN ('void', 'draft', 'sent', 'viewed', 'overdue', 'returned')) THEN
    RAISE EXCEPTION 'invoice % is funded by One Source and can''t be changed', OLD.invoice_number
      USING ERRCODE = 'check_violation', HINT = 'funded_invoice_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_lock_funded ON invoices;
CREATE TRIGGER invoices_lock_funded
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_lock_funded();

-- Line items carry the amount too.
CREATE OR REPLACE FUNCTION invoice_items_lock_funded() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'constructpm_app'
     AND EXISTS (SELECT 1 FROM factored_invoices WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)) THEN
    RAISE EXCEPTION 'this invoice is funded by One Source and its lines can''t be changed'
      USING ERRCODE = 'check_violation', HINT = 'funded_invoice_locked';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS invoice_items_lock_funded ON invoice_items;
CREATE TRIGGER invoice_items_lock_funded
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_lock_funded();

-- ─── Link the whole history ─────────────────────────────────────────────────
-- Every advance on the book, oldest first, gets its invoice: matched to one
-- the client already logged, or created. Advances already linked are
-- reconciled the same way, so their payments come from the ledger too.
SELECT factoring_sync_invoice(id) FROM factored_invoices ORDER BY advanced_on NULLS LAST, created_at;
