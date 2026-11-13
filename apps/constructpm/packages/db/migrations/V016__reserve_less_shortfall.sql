-- ═══════════════════════════════════════════════════════════════════════════
-- V016 — A short payment comes out of the reserve
--
-- When the agency pays less than the invoice, the difference is the client's
-- (full recourse), and it comes out of the reserve along with the fees. Until
-- now the reserve release paid the full reserve less fees regardless, so a
-- $500 short payment meant releasing $500 more than One Source had collected.
--
-- One definition, used everywhere the number appears: the operator's release,
-- the Advances table, and the client's "net expected" on their Funding page.
-- Both functions are SECURITY INVOKER, so each role sees only what its own row
-- security allows (the tenant role: its own advances and their ledger).
-- ═══════════════════════════════════════════════════════════════════════════

-- How much less than the invoice amount the agency paid. Zero until the
-- payment is recorded; zero for older records with no amount on the payment.
CREATE OR REPLACE FUNCTION factoring_shortfall(p_factored_invoice uuid)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN fi.collected_on IS NULL THEN 0
           ELSE GREATEST(fi.face_amount - COALESCE(
                  (SELECT SUM(fe.amount) FROM factoring_events fe
                    WHERE fe.factored_invoice_id = fi.id AND fe.event_type = 'payment_received'),
                  fi.face_amount), 0)
         END
    FROM factored_invoices fi
   WHERE fi.id = p_factored_invoice;
$$;

-- What goes back to the client: the reserve, less fees, less any short payment.
-- Never negative; when fees and the shortfall exceed the reserve, the client
-- owes the difference (factoring_client_owes).
CREATE OR REPLACE FUNCTION factoring_net_reserve(p_factored_invoice uuid)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT GREATEST(fi.reserve_amount
                  - COALESCE(factoring_accrued_fee(fi.id), 0)
                  - COALESCE(factoring_shortfall(fi.id), 0), 0)
    FROM factored_invoices fi
   WHERE fi.id = p_factored_invoice;
$$;

-- The part of the fees and shortfall the reserve doesn't cover.
CREATE OR REPLACE FUNCTION factoring_client_owes(p_factored_invoice uuid)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT GREATEST(COALESCE(factoring_accrued_fee(fi.id), 0)
                  + COALESCE(factoring_shortfall(fi.id), 0)
                  - fi.reserve_amount, 0)
    FROM factored_invoices fi
   WHERE fi.id = p_factored_invoice;
$$;

REVOKE ALL ON FUNCTION factoring_shortfall(uuid), factoring_net_reserve(uuid), factoring_client_owes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION factoring_shortfall(uuid), factoring_net_reserve(uuid), factoring_client_owes(uuid)
  TO constructpm_app, constructpm_factoring_admin;
