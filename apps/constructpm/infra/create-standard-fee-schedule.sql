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
--   tiers = step function on days outstanding (day column = END of range):
--     day 0    →  0.0%   (paid back same day, no fee)
--     1–10     →  1.0%
--     11–20    →  2.0%
--     21–30    →  2.5%   (deliberate half-step at the 30-day mark)
--     31–40    →  3.5%
--     41–50    →  4.5%   (+1% per 10 days from here on out)
--     … up through 241–250 → 24.5%
--     251+     → 25.5%   (open-ended tail)
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
SELECT ns.id, t.from_day, t.to_day, t.fee_pct
  FROM new_schedule ns
  CROSS JOIN (VALUES
    (  0,    0,  0.0),   -- day 0: paid back same day, no fee
    (  1,   10,  1.0),
    ( 11,   20,  2.0),
    ( 21,   30,  2.5),
    ( 31,   40,  3.5),
    ( 41,   50,  4.5),
    ( 51,   60,  5.5),
    ( 61,   70,  6.5),
    ( 71,   80,  7.5),
    ( 81,   90,  8.5),
    ( 91,  100,  9.5),
    (101,  110, 10.5),
    (111,  120, 11.5),
    (121,  130, 12.5),
    (131,  140, 13.5),
    (141,  150, 14.5),
    (151,  160, 15.5),
    (161,  170, 16.5),
    (171,  180, 17.5),
    (181,  190, 18.5),
    (191,  200, 19.5),
    (201,  210, 20.5),
    (211,  220, 21.5),
    (221,  230, 22.5),
    (231,  240, 23.5),
    (241,  250, 24.5),
    (251, NULL, 25.5)    -- open-ended
  ) AS t(from_day, to_day, fee_pct);

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
