-- ═══════════════════════════════════════════════════════════════════════════
-- V007 — Client negative-list corrections (data)
--
-- V006 introduced factoring_clients.negative_list as a hard stop in the
-- underwriting engine: a client on this list is never funded, whatever the
-- score. The default is FALSE, so nothing is on it unless someone has flipped
-- it deliberately.
--
-- During the engine review the operator confirmed one correction: Surratt
-- Painting is NOT on the negative list. Their position sits behind PHDC's
-- measured slowdown rather than being idiosyncratic to them; the engine already
-- distinguishes those two cases, and the negative-list flag would be an
-- overreach.
--
-- This migration is DEFENSIVE. Surratt does not exist as a factoring_client
-- row on any deployed database today, so on first apply this is a no-op. Its
-- job is durability: if the Client Underwriting sheet from the workbook is
-- ever bulk-imported later and brings the "X" flag with it, V007 has already
-- committed the corrected state to the schema history.
--
-- The name match is case- and whitespace-tolerant on purpose, because the
-- workbook, the entity search and the operator console spell it three slightly
-- different ways ("Surratt Painting, Inc.", "Surratt Painting", etc). Matching
-- by prefix inside a LIKE would be too loose in general; here it is anchored on
-- the exact word "Surratt" plus " Painting", which does not collide with any
-- other name we have seen in the book.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE factoring_clients
   SET negative_list = FALSE,
       negative_list_reason = NULL,
       updated_at = NOW()
 WHERE negative_list = TRUE
   AND company_id IN (
     SELECT id FROM companies
      WHERE LOWER(BTRIM(name)) LIKE 'surratt painting%'
   );

-- Deliberately NOT clearing any other negative-list entries. BDFS, Unique
-- Properties and any future flag stay as they are; each one represents a
-- policy decision an operator made, and this migration only reverses the one
-- correction that has been explicitly asked for.
