# Neumeric platform

The farmer-facing product app. The static landing site lives one directory up;
this app shares its design tokens but is a separate Next.js codebase.
Architecture, roadmap, legal dependencies, and deploy runbook: see
[`../docs/`](../docs/).

## Run it

```bash
npm install
npm run dev   # http://localhost:3000
```

First run creates and seeds `.data/neumeric.db` (SQLite) with a fictional
demo operation. Visit `/setup` to create a real farm workspace, or
`/join/demo` to explore the demo (every demo screen is badged as sample data).

## What's here

| Area | Where |
|---|---|
| Data model (all pillars) | `src/db/schema.ts` — the canonical entity design |
| DB bootstrap (dual driver) | `src/db/index.ts` — Turso in prod, SQLite in dev |
| Workspace access / tenancy | `src/lib/current-op.ts` — private-link cookie scoping |
| CV pipeline contract + demo analyzer | `src/lib/cv/` |
| Deadline rules (IL 2026, data-driven) | `src/data/rules/deadlines.il.2026.json` + `src/lib/rules/deadlines.ts` |
| Program-money finder | `src/data/rules/programs.json` + `src/lib/rules/programs.ts` |
| Marketing scenario engine (Pillar 3) | `src/lib/marketing.ts` — non-tailored decision support |
| Screens | `src/app/` — welcome, setup, overview, fields, deadlines, claims (evidence → packet), programs, marketing, settings |
| Server actions (with audit events) | `src/app/actions.ts` |

## Pillars in this build

- **Pillar 1 — insurance advocate:** deadline tracker, claim evidence builder
  (capture → hashed imagery → CV field-condition record with provenance →
  human-reviewed printable packet), program-money finder with visible reasoning.
- **Pillar 3 — marketing copilot:** position dashboard (% priced, breakeven,
  local basis vs. normal, insurance floor, booked revenue), a farmer-set target
  plan (behavioral discipline layer), and a scenario sweep showing each
  sell/hold choice across a price grid net of storage carry. **Decision support
  only — no price forecasts, no trade recommendations** (CTA exemption, see
  `../docs/DEPENDENCIES.md §7`).
- **Pillar 2 — parametric:** schema tables reserved; gated on a licensed carrier
  partner. No underwriting/pricing math in the codebase by design.

## Deploy

See [`../docs/DEPLOY.md`](../docs/DEPLOY.md). Production needs
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `UPLOAD_DIR` set on Vercel.

## Deliberate v0 shortcuts (tracked in docs/ROADMAP.md Phase 1)

- Workspace access is via unguessable private link (bearer token in an HttpOnly
  cookie), not full auth. Magic-link email auth is the Phase 1 replacement.
- `demo-analyzer` stands in for the real NDVI/ExG analyzers; its output is
  always labeled sample analysis and must never be shown as real.
- Uploaded photos skip EXIF/GPS validation and are stored in `/tmp` on
  serverless (ephemeral) — the SHA-256 + metadata persist in the DB, but the
  image bytes need durable object storage before claim evidence relies on them.
- Marketing prices are farmer-entered until licensed market-data feeds land.
- Evidence packet is browser-print → PDF.
