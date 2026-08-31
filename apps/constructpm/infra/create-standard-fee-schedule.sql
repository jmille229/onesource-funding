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
--     … up through 711–720 → 71.5%
--     721+     → 72.5%   (open-ended tail — matches what the pattern would
--                          produce for the 721–730 tier if we capped there)
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

-- Ensure a live 'Standard' schedule exists. A no-op if one is already there.
INSERT INTO fee_schedules (name, description, is_template, tier_mode, advance_rate_pct, recourse_days)
SELECT 'Standard',
       'Default schedule. 80% advance; step tiers on days outstanding: 0% same day, 1% first 10 days, +1% every 10 days thereafter with a half-step at day 30.',
       TRUE, 'step', 80.0000, 90
 WHERE NOT EXISTS (SELECT 1 FROM fee_schedules WHERE name = 'Standard' AND retired_at IS NULL);

-- Wipe the existing tier rows for the live Standard schedule before re-
-- inserting the canonical set. Only the tiers are wiped — funded advances
-- snapshot their own advance_rate and recourse_days at fund time, so nothing
-- already booked is disturbed even if the tiers here later change shape.
DELETE FROM fee_schedule_tiers
 WHERE fee_schedule_id IN (
   SELECT id FROM fee_schedules WHERE name = 'Standard' AND retired_at IS NULL
 );

-- Tier rows built in three parts and unioned:
--   1) the special first-30-days ramp (half-step at day 30, hand-listed)
--   2) the regular +1% per 10 days pattern from day 31 through day 720
--      (69 tiers, generated so the arithmetic can't drift out of step)
--   3) the open-ended tail for day 721 onwards
INSERT INTO fee_schedule_tiers (fee_schedule_id, from_day, to_day, fee_pct)
WITH tiers(from_day, to_day, fee_pct) AS (
  SELECT  0::int,  0::int,  0.0::numeric  -- paid back same day: no fee
  UNION ALL SELECT  1, 10,  1.0
  UNION ALL SELECT 11, 20,  2.0
  UNION ALL SELECT 21, 30,  2.5           -- deliberate half-step
  UNION ALL
    SELECT (31 + 10*n)::int,
           (40 + 10*n)::int,
           (3.5 + n)::numeric
      FROM generate_series(0, 68) AS n    -- 31-40 (3.5%) through 711-720 (71.5%)
  UNION ALL SELECT 721, NULL::int, 72.5   -- open-ended tail
)
SELECT fs.id, t.from_day, t.to_day, t.fee_pct
  FROM fee_schedules fs, tiers t
 WHERE fs.name = 'Standard' AND fs.retired_at IS NULL;

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
