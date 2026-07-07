# Neumeric — Phased Build Roadmap

**Rule of thumb throughout:** anything marked 🤝 requires an external human conversation (partner, lawyer, data license) and is tracked in [DEPENDENCIES.md](DEPENDENCIES.md); everything else is pure software and can keep moving regardless.

---

## Phase 0 — Scaffold (this repo, now)

Ships in this codebase (`platform/`):

- Next.js app on the Neumeric design system (cream/ink/forest, Playfair + Inter + Plex Mono), mobile-first.
- Full Drizzle data model for all Phase-1 entities (Operation → Field → CropSeason → ImageryCapture → FieldConditionRecord → Claim/Deadline/ProgramMatch) with audit-provenance fields in place from the first migration.
- **Deadline tracker** driven by a real rules data file (2026 Illinois corn/soy RMA + FSA dates), materialized per operation, with status tracking.
- **Claim-evidence builder** end to end with a deterministic demo analyzer standing in for the CV model: damage event → imagery upload → FCR generation with provenance → structured evidence packet (print-ready).
- **Program-money finder** rules engine with a starter USDA/FSA program set, transparent matched/missing-criteria reasoning.
- All sample data explicitly badged as demo data. No auth yet (single demo operation).

## Phase 1 — Real v0 for the wedge (≈ 4–8 weeks)

Goal: **one real Illinois farmer files one real, stronger claim (or finds real program money) using Neumeric.**

Software:
1. Auth + multi-operation tenancy (Clerk or Auth.js; magic-link — farmers won't manage passwords).
2. Guided phone-capture flow (enforced GPS/timestamp, capture checklist per damage type) — this is the v0 "sensor," ahead of drone support.
3. Real NDVI/ExG analyzers on Sentinel-2 (free) + uploaded drone/phone imagery, with the human-review gate on every packet.
4. Evidence packet v1 hardened with an adjuster/agent in the loop: format, language, and attachments an AIP adjuster actually accepts. 🤝 (friendly crop-insurance agent — findable through current IL validation work)
5. Deadline rules expanded to the validation counties (Kane/Kendall/DeKalb/LaSalle) with reminder emails/SMS.
6. Postgres + PostGIS deployment, object storage, backups.

External:
- 🤝 2–3 design-partner farmers from the current Illinois outreach.
- 🤝 Legal read on packet language (documentation assistance vs. loss adjustment/public-adjuster territory — state-by-state nuance).

**Explicitly not in Phase 1:** bespoke CV models, drone ops of our own, lender white-label, anything Pillar 2/3.

## Phase 2 — Deepen the wedge + open the lender channel (months 3–6)

- Acreage/production reporting assistant that outputs pre-filled report data the farmer walks into the FSA office with (direct e-filing via USDA APIs where they exist 🤝 — API access agreements).
- Program finder expanded beyond starter set; annual rules-refresh workflow.
- Fine-tuned damage-type models (hail, flood, green snap) as labeled FCRs accumulate; measure against human review.
- 🤝 First ag-lender pilot (Compeer-style): read-only borrower dashboards, white-label theming — the partner surface in the architecture.
- 🤝 Imagery upgrade decision: Planet-class tasking license if Sentinel resolution proves limiting for claims.

## Phase 3 — Pillar 2, parametric triggers (months 6–12, gated on a carrier)

- Trigger definition + evaluation engine with the append-only calculation trace (architecture already reserves the tables).
- Carrier-facing API: trigger evaluations, evidence bundles, dispute log.
- 🤝 **Hard gate: a licensed carrier/reinsurer partner underwrites the product.** Neumeric builds none of the pricing/underwriting. No partner signed → this phase stays a spec + demo.
- 🤝 Trigger methodology co-signed contractually (metric, threshold, cadence, imagery source class, failure modes).

## Phase 4 — Pillar 3, marketing copilot (parallel-capable after Phase 2)

- Position dashboard: production (CV-informed where FCRs exist), sold/stored/contracted, breakeven, insurance floor, local basis vs. historical range (public/licensed data 🤝 for basis feeds).
- Scenario engine — parameter sweeps over farmer-chosen actions; never a price forecast, never a directive.
- Behavioral layer: farmer-authored marketing plan + alerts on farmer-set targets.
- 🤝 **CTA-exemption legal review before launch** (see DEPENDENCIES.md) — the feature set above is designed to fit the non-personalized exemption, but a lawyer signs off, not us.
- Deliberate later option: register as a CTA to unlock tailored advice as a moat — a Phase 5+ decision with counsel.

## What "demoable v0" means for the pitch (weeks, not months)

Phase 0 (this scaffold) + the Phase 1 capture flow and one real analyzer is a live demo: *"farmer photographs a hailed-out field Tuesday; Wednesday they hand their adjuster a geotagged, timestamped, NDVI-backed damage packet and a list of two FSA programs they qualify for."* Everything else is expansion.
