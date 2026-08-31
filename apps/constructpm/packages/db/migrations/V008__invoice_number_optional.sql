-- ═══════════════════════════════════════════════════════════════════════════
-- V008 — Invoice number becomes optional on factored_invoices
--
-- Operators occasionally advance against invoices that arrive without a
-- number (or before the number is assigned by the agency), and requiring one
-- at row-creation time forced them to invent placeholders — the exact input
-- the underwriting engine then hard-stopped as risky. Making the field
-- nullable lets the two shapes stay distinct: blank means "not entered yet",
-- placeholders like "-" or "N/A" still fail as fake numbers.
--
-- Every invoice already carries a UUID primary key (gen_random_uuid()) that is
-- app-generated, never external input, and globally unique per record. That
-- id doubles as the invoice's stable identifier when there is no
-- customer-visible number, surfaced in the UI as an INV- short form of the
-- UUID. No new column is needed.
--
-- Schema-only. The tenant view (factored_invoices_public) already exposes
-- invoice_number as a nullable column via SELECT fi.* → INSERT ... invoice_number
-- so the read side keeps working.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE factored_invoices
  ALTER COLUMN invoice_number DROP NOT NULL;

-- funding_requests.invoice_number was already nullable (V005 defined it as
-- TEXT with no NOT NULL), so no change needed there.
