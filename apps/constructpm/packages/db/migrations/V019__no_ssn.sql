-- ═══════════════════════════════════════════════════════════════════════════
-- V019 — One Source no longer collects Social Security numbers
--
-- The owner's SSN was asked for on the funding application (V013). It isn't
-- needed, and a number that isn't held can't be exposed, so:
--
--   * the SSN requirement is removed from the application,
--   * every SSN already stored (encrypted) is deleted, and
--   * the database refuses SSNs from now on, for requirements and answers.
--
-- The business EIN stays: it identifies the company, not a person.
--
-- Note: nightly backups taken before this runs still hold the encrypted
-- numbers until they age out (14 days locally, or the off-site retention).
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM funding_application_items WHERE kind = 'ssn';
DELETE FROM application_requirements  WHERE kind = 'ssn';

-- The enum keeps the value (Postgres can't drop one in place); these keep it
-- unused.
DO $$ BEGIN
  ALTER TABLE application_requirements ADD CONSTRAINT application_requirements_no_ssn CHECK (kind <> 'ssn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE funding_application_items ADD CONSTRAINT funding_application_items_no_ssn CHECK (kind <> 'ssn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
