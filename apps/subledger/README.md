# Subledger

Project & subcontractor management for small general contractors — the first
feature of the OneSource invoice-management suite. Commit scope to subs, track
committed-vs-billed against the owner contract, and watch insurance (COI),
W-9, and MBE/WBE/DBE participation in one place.

This is the MVP built from the planning-session prototype. It is a standalone
Vite + React + TypeScript app that deploys separately from the marketing site
(intended target: `app.os-funding.com`).

## Run locally

```bash
cd apps/subledger
npm install
npm run dev        # http://localhost:5175
```

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
npm run typecheck  # types only
```

## Current state (MVP slice 1)

- Single job (`Maple Row Duplex`, seeded) with the **commitment rail**.
- Add subcontracts via an accessible modal; data **persists in the browser**
  (`localStorage`, key `subledger:subs:v1`).
- COI / W-9 / certification tracking and the participation report.

### Deliberate honesty fixes vs. the prototype
- A blank insurance date is stored as `null` and shown as **"COI missing"** —
  never backfilled with a fake future date that would read as "insured."
- The lead money figure is labeled **"Billed, net of retainage"** (what the sub
  has earned/can collect), not "Paid out." A true cash-payments ledger is the
  next iteration — see the note in `src/App.tsx`.

## Data model

Types live in `src/types.ts`. The persistence surface is a single JSON blob
behind `useLocalStorage` (`src/lib/useLocalStorage.ts`) so it can be swapped for
a Supabase-backed store later without touching UI callers.

## Planned next iterations

1. Payments ledger (bills against a subcontract + actual payments) so "Due"
   and cash-out are exact.
2. Multiple projects; shared firm directory across jobs.
3. Document upload (invoices / COIs / contracts) — the GC "upload a document"
   flow from the product vision.
4. Supabase (Postgres + Auth + Storage + RLS) for multi-tenant, real accounts,
   wired to the marketing-site **Login** button.
