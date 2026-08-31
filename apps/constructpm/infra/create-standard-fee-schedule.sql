-- ═══════════════════════════════════════════════════════════════════════════
-- create-standard-fee-schedule.sql
--
-- Seeds the shop's default fee schedule, wired to the tier table OneSource
-- actually uses. Every advance snapshots the rate at fund time, so this is
-- the "starting point" for every client that doesn't have a bespoke schedule
-- assigned — editing or retiring this schedule later never rewrites what has
-- already funded.
--
-- Shape:
--   advance_rate = 80%
--   recourse_days = 90
--   tiers = step function on days outstanding:
--     0–9   →  0.0%
--     10–19 →  1.0%
--     20–29 →  2.0%
--     30–39 →  2.5%     (deliberate half-step to soften the 30-day cliff)
--     40–49 →  3.5%
--     50–59 →  4.5%     (+1% per 10 days from here on out)
--     … up through 250–259 → 24.5%
--     260+  → 25.5%    (open-ended tail)
--
-- Idempotent — a schedule named 'Standard' is skipped if it already exists,
-- so re-runs are safe.
--
-- Run on the VPS from apps/constructpm:
--
--   docker compose --env-file .env.production -f docker-compose.prod.yml \
--     exec -T postgres psql -U constructpm -d constructpm -v ON_ERROR_STOP=1 \
--     < infra/create-standard-fee-schedule.sql
--
-- After this succeeds, run infra/onboard-factoring-clients.sql to attach the
-- historical portfolio's clients to it.
-- ═══════════════════════════════════════════════════════════════════════════

WITH new_schedule AS (
  INSERT INTO fee_schedules (name, description, is_template, tier_mode, advance_rate_pct, recourse_days)
  SELECT 'Standard',
         'Default schedule. 80% advance; step tiers on days outstanding: 0% for the first 10 days, +1% every 10 days thereafter with a half-step at day 30.',
         TRUE, 'step', 80.0000, 90
   WHERE NOT EXISTS (SELECT 1 FROM fee_schedules WHERE name = 'Standard' AND retired_at IS NULL)
  RETURNING id
)
INSERT INTO fee_schedule_tiers (fee_schedule_id, from_day, to_day, fee_pct)
SELECT ns.id,
       t.from_day,
       -- The last tier is open-ended so anything past 260 days pays the top rate.
       CASE WHEN t.from_day = 260 THEN NULL ELSE t.from_day + 9 END,
       t.fee_pct
  FROM new_schedule ns
  CROSS JOIN (VALUES
    (  0, 0.0),
    ( 10, 1.0),
    ( 20, 2.0),
    ( 30, 2.5),
    ( 40, 3.5),
    ( 50, 4.5),
    ( 60, 5.5),
    ( 70, 6.5),
    ( 80, 7.5),
    ( 90, 8.5),
    (100, 9.5),
    (110,10.5),
    (120,11.5),
    (130,12.5),
    (140,13.5),
    (150,14.5),
    (160,15.5),
    (170,16.5),
    (180,17.5),
    (190,18.5),
    (200,19.5),
    (210,20.5),
    (220,21.5),
    (230,22.5),
    (240,23.5),
    (250,24.5),
    (260,25.5)
  ) AS t(from_day, fee_pct);

-- Verification. Prints the schedule and every tier so the operator can
-- eyeball the numbers before onboarding clients against it.
SELECT fs.name,
       fs.advance_rate_pct AS advance_pct,
       fs.recourse_days,
       t.from_day, t.to_day, t.fee_pct
  FROM fee_schedules fs
  JOIN fee_schedule_tiers t ON t.fee_schedule_id = fs.id
 WHERE fs.retired_at IS NULL
 ORDER BY fs.created_at, t.from_day;
