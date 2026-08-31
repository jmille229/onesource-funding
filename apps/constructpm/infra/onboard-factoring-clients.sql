-- ═══════════════════════════════════════════════════════════════════════════
-- onboard-factoring-clients.sql
--
-- One-shot seeder for the historical portfolio import.
--
-- The Advance Book import assumes every borrower already exists as a
-- factoring_client — deliberately, because setting up a client usually means
-- deciding a fee schedule, credit limit, negative-list flag and so on. That
-- guardrail is wrong for a book of business we are pulling in for the record:
-- these clients existed before the app, none of them will sign up now, and
-- forcing 18 sign-up flows to onboard existing paper would be busywork.
--
-- This script shell-creates a `companies` row plus a `factoring_clients` row
-- for each named borrower, wiring them to the first non-retired fee schedule
-- so `fundInvoice` has an economics profile to snapshot. Everyone lands as
-- status = 'active' because the import path uses that; flip individual rows
-- afterwards (e.g. UPDATE factoring_clients SET status='closed', negative_list=TRUE
-- WHERE company_id = ... for BDFS).
--
-- Idempotent — matches on lower(btrim(name)), so re-running is safe: existing
-- clients are left alone and only genuinely missing borrowers are inserted.
--
-- Run on the VPS from apps/constructpm:
--
--   docker compose --env-file .env.production -f docker-compose.prod.yml \
--     exec -T postgres psql -U constructpm -d constructpm \
--     -v ON_ERROR_STOP=1 -f /tmp/onboard-factoring-clients.sql
--
-- Or pipe the file in over stdin (no copy to the container needed):
--
--   docker compose --env-file .env.production -f docker-compose.prod.yml \
--     exec -T postgres psql -U constructpm -d constructpm -v ON_ERROR_STOP=1 \
--     < infra/onboard-factoring-clients.sql
-- ═══════════════════════════════════════════════════════════════════════════

WITH names(borrower) AS (VALUES
  -- Edit this list to match the borrower column of your Advance Book,
  -- spelled exactly the way the workbook spells them (the import matches on
  -- lower(btrim(name)), so case and edge whitespace don't matter, but
  -- punctuation and periods do — "Inc" vs "Inc." is a different lookup).
  ('RNV Electrical'),
  ('BDFS Group Inc'),
  ('DKJ Construction, Inc.'),
  ('Father and Aaron LLC'),
  ('Affinity Builders Construction'),
  ('Cerific General Contracting'),
  ('RDS Contracting Group, Inc'),
  ('Seamless Pros, LLC'),
  ('Latson Construction'),
  ('3rd Generation Design & Construction'),
  ('BluntArc Consulting Inc.'),
  ('Larry C. McCrae, Inc.'),
  ('Alexander Perry, Inc.'),
  ('Unique Properties & Builders, LLC'),
  ('JTT3 Contractors'),
  ('Surratt Painting, Inc.'),
  ('Hardimon Construction, LLC.'),
  ('ADE Electric LLC')
),

-- Pick the shop's first live fee schedule as the default. Every advance
-- snapshots its own rate at fund time, so this can be revised per client
-- afterwards without rewriting anything already booked.
fee_default AS (
  SELECT id FROM fee_schedules WHERE retired_at IS NULL ORDER BY created_at LIMIT 1
),

-- Split the input into "already onboarded" and "needs a shell company".
existing AS (
  SELECT n.borrower, c.id AS company_id
    FROM names n
    LEFT JOIN companies c ON LOWER(BTRIM(c.name)) = LOWER(BTRIM(n.borrower))
),

-- Shell company rows. Slug is a URL-safe form of the name plus a short hash
-- suffix so a re-slug of the same name never collides with an unrelated one.
-- Nothing else on companies is required — subscription defaults handle it.
new_companies AS (
  INSERT INTO companies (name, slug)
  SELECT e.borrower,
         regexp_replace(LOWER(e.borrower), '[^a-z0-9]+', '-', 'g')
           || '-' || substr(md5(e.borrower || clock_timestamp()::text), 1, 8)
    FROM existing e WHERE e.company_id IS NULL
  RETURNING id, name
),

-- Union of "already had a company" and "just created one" — one row per
-- borrower name that now has a company_id in hand.
all_pairs AS (
  SELECT company_id, borrower FROM existing WHERE company_id IS NOT NULL
  UNION ALL
  SELECT id, name FROM new_companies
)

-- factoring_clients has UNIQUE (company_id) so ON CONFLICT is the clean
-- no-op if a client row already exists for this company.
INSERT INTO factoring_clients (company_id, status, default_fee_schedule_id)
SELECT company_id, 'active', (SELECT id FROM fee_default)
  FROM all_pairs
 ON CONFLICT (company_id) DO NOTHING;

-- Verification. Prints everyone the seeder just touched (and anyone else
-- already there) so the operator can eyeball the fee schedule assignment
-- before running the Advance Book import.
SELECT c.name AS borrower,
       fc.status,
       fc.credit_limit,
       fs.name AS fee_schedule
  FROM factoring_clients fc
  JOIN companies c ON c.id = fc.company_id
  LEFT JOIN fee_schedules fs ON fs.id = fc.default_fee_schedule_id
 ORDER BY c.name;
