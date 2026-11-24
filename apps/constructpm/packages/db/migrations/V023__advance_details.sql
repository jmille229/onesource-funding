-- ═══════════════════════════════════════════════════════════════════════════
-- V023 — The Advance Book's own columns on each advance
-- ═══════════════════════════════════════════════════════════════════════════
-- One Source's workbook records, for every advance: Borrower, Name, Creditor,
-- Sales person, Project, Adv Date, Invoice #, Total Invoice, Total Advanced.
-- Borrower (company), Creditor (debtor), the dates and amounts were already
-- here. These are the other three, set in the console when an invoice is
-- funded, editable afterwards, and filled from the workbook on import (which
-- until now folded Sales person and Project into the notes and dropped Name).
--
--   contact_name  the borrower's person on this deal ("Name")
--   sales_person  who at One Source brought it in
--   project       what the invoice is for: an address, a contract
--
-- Operator-only: the client app reads advances through explicit column lists
-- (factoring.router.ts), and none of them includes these.

ALTER TABLE factored_invoices
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS sales_person TEXT,
  ADD COLUMN IF NOT EXISTS project      TEXT;

ALTER TABLE factored_invoices DROP CONSTRAINT IF EXISTS factored_details_ck;
ALTER TABLE factored_invoices ADD CONSTRAINT factored_details_ck CHECK (
  (contact_name IS NULL OR length(contact_name) BETWEEN 1 AND 200) AND
  (sales_person IS NULL OR length(sales_person) BETWEEN 1 AND 100) AND
  (project      IS NULL OR length(project)      BETWEEN 1 AND 300)
);
