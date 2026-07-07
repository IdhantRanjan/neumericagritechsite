# Neumeric platform — Pillar 1 scaffold

The farmer-facing product app (insurance advocate wedge). The static landing
site lives one directory up; this app shares its design tokens but is a
separate Next.js codebase. Architecture, roadmap, and legal dependencies:
see [`../docs/`](../docs/).

## Run it

```bash
npm install
npm run dev   # http://localhost:3000
```

First run creates and seeds `.data/neumeric.db` (SQLite) with a fictional
sample operation — every screen is badged as demo data.

## What's here

| Area | Where |
|---|---|
| Data model (all pillars) | `src/db/schema.ts` — the canonical entity design |
| Demo seed | `src/db/seed.ts` |
| CV pipeline contract + demo analyzer | `src/lib/cv/` |
| Deadline rules (IL 2026, data-driven) | `src/data/rules/deadlines.il.2026.json` + `src/lib/rules/deadlines.ts` |
| Program-money finder | `src/data/rules/programs.json` + `src/lib/rules/programs.ts` |
| Screens | `src/app/` — overview, fields, deadlines, claims (evidence builder → printable packet), programs |
| Server actions (with audit events) | `src/app/actions.ts` |

## Deliberate scaffold shortcuts (see docs/ROADMAP.md Phase 1)

- No auth — single demo operation. Phase 1 adds magic-link auth + tenancy.
- SQLite locally; schema written to port to Postgres + PostGIS.
- `demo-analyzer` stands in for the real NDVI/ExG analyzers; its output is
  always labeled sample analysis and must never be shown as real.
- Uploaded photos skip EXIF/GPS validation; the Phase 1 guided capture flow
  enforces geotags and timestamps.
- Evidence packet is browser-print → PDF.
