# Neumeric — System Architecture

**Status:** v1 draft · July 2026 · covers all three pillars, built in Pillar-1-first order.
**Companion docs:** [ROADMAP.md](ROADMAP.md) (phasing) · [DEPENDENCIES.md](DEPENDENCIES.md) (legal/partnership blockers).

The one-sentence architecture: **a single verified data object — the Field Condition Record — produced by one shared CV pipeline, consumed by three financial products.** Everything below exists to produce, protect, or monetize that object.

---

## 1. Core design principles

1. **The Field Condition Record (FCR) is the company.** The insurance advocate, the parametric trigger, and the marketing copilot are all views over the same verified record of "what is true about this field, when, with what evidence." Its schema is designed once, carefully, and treated as near-immutable (append-only versioning, never destructive migration).
2. **Auditability is a day-one feature, not a bolt-on.** Every FCR carries full provenance: source imagery hashes, capture geolocation/timestamp, model name + version, confidence, and the identity of whoever/whatever submitted it. A claim packet or parametric payout must be reconstructible from stored evidence years later, in front of an insurer, arbitrator, or regulator.
3. **Buy the sensor, own the interpretation.** No hardware. Imagery comes from farmer phones, farmer/contractor drones, and commercial satellite APIs (Sentinel-2 free tier first; Planet-class tasking later). Neumeric's asset is the interpretation layer and the accumulated labeled record base, not pixels.
4. **Rules are data, not code.** RMA/FSA deadlines and program eligibility vary by state, county, crop, and year and change annually. They live in versioned data files (later: a rules service with an admin UI), never hardcoded in application logic.
5. **Stay on the right side of the regulatory lines by construction.** The system's own architecture enforces the constraints in DEPENDENCIES.md: no underwriting math anywhere in the codebase (Pillar 2 emits *trigger evaluations*, a carrier consumes them), and Pillar 3's scenario engine takes no code path that emits a tailored trade directive.

## 2. Application layers

```
┌──────────────────────────────────────────────────────────────┐
│  Farmer web app (Next.js, mobile-first PWA)                  │
│  Dashboard · Fields · Deadlines · Claims · Programs ·        │
│  (later) Triggers · Marketing position                       │
├──────────────────────────────────────────────────────────────┤
│  Partner surface (Phase 2+): lender/agent read-only views,   │
│  white-label theming, carrier trigger API                    │
├──────────────────────────────────────────────────────────────┤
│  Application services (Next.js server actions → extract to   │
│  services only when load/team size demands it)               │
│   · Deadline & compliance rules engine                       │
│   · Program eligibility matcher                              │
│   · Claim/evidence packet assembler (PDF + structured JSON)  │
│   · Scenario engine (Pillar 3, non-tailored by construction) │
│   · Notifications (email/SMS via Resend/Twilio)              │
├──────────────────────────────────────────────────────────────┤
│  CV pipeline (async workers)                                 │
│   ingest → validate/geo-register → analyze → emit FCR        │
├──────────────────────────────────────────────────────────────┤
│  Data: Postgres + PostGIS (prod) / SQLite (dev) ·            │
│  object storage for imagery (S3/R2, content-addressed) ·     │
│  append-only audit log                                       │
└──────────────────────────────────────────────────────────────┘
```

### Why this stack

- **Next.js (App Router) + TypeScript, mobile-first.** One codebase for a two-person team; server components keep the phone-in-a-truck-cab experience fast on rural LTE; PWA install beats maintaining a native app at this stage. The landing site stays static HTML — the platform lives in `platform/` and shares only the brand tokens.
- **Postgres + PostGIS in production, SQLite in dev/scaffold.** Field boundaries, point-in-polygon for imagery ↔ field matching, and county-level rules lookups are native PostGIS work. The scaffold runs on SQLite (zero setup) with geometry stored as GeoJSON; the schema is written to port cleanly.
- **Drizzle ORM.** The schema file *is* the data-model documentation; SQL-transparent, trivial SQLite→Postgres migration.
- **Object storage, content-addressed.** Imagery files are stored under their SHA-256. The hash in the FCR is the tamper-evidence primitive — anyone can verify the packet's imagery is the imagery that was analyzed.
- **Queue for CV work** (start: simple DB-backed job table; later: SQS/Cloud Tasks). CV analysis is seconds-to-minutes; never inline in a request.

## 3. Data model

Entities (→ implemented in `platform/src/db/schema.ts`, which is the source of truth):

| Entity | Key fields | Notes |
|---|---|---|
| **Operation** | name, state, counties, entity type | The farm business. Owns everything. Multi-user later. |
| **User** | auth identity, role | Farmer first; later agent/lender roles with scoped read access. |
| **Field** | name, boundary (GeoJSON), acres, county, FSA farm/tract/field numbers | FSA numbers are how everything joins to USDA paperwork. |
| **CropSeason** | field, crop, year, planting date, practice (irr/non-irr), intended vs. reported acres | One row per field-crop-year; the unit acreage reporting cares about. |
| **ImageryCapture** | source (phone/drone/satellite), captured_at, geolocation, file hashes, EXIF/flight metadata, uploader | Raw evidence. Immutable once ingested. |
| **FieldConditionRecord** | ↓ see below | The core asset. |
| **PolicyRef** | field/crop scope, type (RP/YP/etc.), coverage level, AIP + agent contact, key dates | A *reference* to the farmer's existing policy — Neumeric never issues policies. |
| **Claim** | policy ref, damage event (type, date), status, linked FCRs, generated packet versions | Pillar 1's central workflow object. |
| **DeadlineInstance** | rule id, operation/crop scope, due date, status (upcoming/done/missed), reminders sent | Materialized from the rules layer per operation. |
| **ProgramMatch** | program id, operation, match strength, matched/unmatched criteria, est. value range, status | Output of the eligibility engine; farmer marks pursued/dismissed. |
| **TriggerDefinition** (P2) | insured field, FCR metric, threshold, cadence, imagery source class, carrier contract ref | The contractual trigger, versioned and signed off by the carrier. |
| **TriggerEvaluation** (P2) | trigger def version, input FCR ids, computed value, fired?, full calculation trace | Append-only. This is the dispute-resolution log. |
| **MarketingPosition** (P3) | crop year, produced/stored/sold/contracted bushels, cost of production, insurance floor inputs | Farmer's own data reflected back; no external recommendations attached. |
| **AuditEvent** | actor, action, entity, before/after hash, timestamp | Append-only log across all entities that touch money. |

### The Field Condition Record (design it once, permanently)

```
FieldConditionRecord {
  id, field_id, crop_season_id
  observed_at                       // when the field was in this condition
  crop, growth_stage                // e.g. corn, V6
  condition_class                   // healthy | stressed | damaged | destroyed
  damage_type?                      // hail | flood | drought | wind | disease | pest | other
  severity_pct?                     // 0–100 estimated loss/severity
  affected_area                     // GeoJSON polygon(s) + computed acres
  metrics {}                        // named quantitative outputs, e.g.
                                    //   ndvi_mean, stand_count_per_acre, canopy_cover_pct
  confidence                        // 0–1, per-record
  provenance {
    capture_ids[]                   // source ImageryCapture rows
    imagery_sha256[]                // content hashes of exact analyzed files
    model_name, model_version       // e.g. "ndvi-threshold", "0.3.1"
    pipeline_run_id, analyzed_at
    reviewed_by?                    // human-in-the-loop sign-off, Phase 1 requirement
  }
  supersedes?                       // records are never edited; corrections append
}
```

Rationale: `metrics` is an open key-value bag so new model outputs never force a migration; `condition_class`/`severity_pct`/`affected_area` are the stable fields the three pillars contract against; `supersedes` gives append-only correction semantics that survive an audit.

## 4. CV pipeline

**Stages:** `ingest → validate → geo-register → analyze → emit FCR → (Phase 1) human review`

- **Ingest:** phone photos (EXIF GPS + time required, prompted capture flow), drone orthomosaics/stills (GeoTIFF or EXIF), satellite scenes pulled by field boundary + date window from Sentinel-2 (free, 10 m — sufficient for whole-field stress/loss signals, not plant-level).
- **Validate:** reject/flag missing geodata, timestamps outside the claimed event window, imagery whose footprint doesn't intersect the field boundary. This gate is what makes the evidence insurer-legible.
- **Analyze — v0 is deliberately unfancy:**
  1. **Vegetation indices** (NDVI/NDRE where bands exist; ExG green-index for RGB phone/drone imagery) against the field's own pre-event baseline — proven in the founder's Cropsia work, explainable to an adjuster, no training data required.
  2. **Off-the-shelf/fine-tuned detection** (stand counts, lodging, hail defoliation) added per damage type as labeled data accumulates — fine-tune open ag models before training anything bespoke.
  3. **Human review step** on every FCR that enters a claim packet, until model error rates are characterized. The packet's credibility is the product; a wrong number in front of an adjuster costs more than the review time saves.
- **Model registry discipline:** every analyzer has a name + semver recorded in provenance; model changes never rewrite historical FCRs.
- The scaffold implements this pipeline's **interfaces and data flow** with a deterministic demo analyzer (`platform/src/lib/cv/`), so the real analyzers drop in behind a stable contract.

## 5. Rules layers (deadlines + programs)

- **Deadline rules** (`data/rules/deadlines.*.json`): rule = {program (RMA/FSA), crop, state/county scope, date or date-formula, description, source URL, effective year}. An expander materializes DeadlineInstances per operation from its crops/counties. Annual refresh is an editorial task (later an admin UI + RMA Actuarial Information Browser scrape).
- **Program eligibility** (`data/rules/programs.json`): each program = structured criteria (crop, county, practice, event type, dates) + payment logic description + evidence checklist. The matcher scores operations against criteria and — critically — shows *why* it matched and what's missing, because the farmer's trust in "found money" claims depends on the reasoning being visible. Estimates are always ranges, labeled as estimates.

## 6. Pillar-specific notes

- **Pillar 2 (parametric):** Neumeric's system defines triggers, evaluates them against FCRs, and exposes evaluations + full audit trail via a carrier-facing API. **The carrier prices, underwrites, and pays.** There is deliberately no premium/rate math in the codebase. TriggerEvaluation's calculation trace (inputs, formula, threshold, result) is the trust product.
- **Pillar 3 (marketing copilot):** position dashboard + scenario engine + pre-committed plan alerts. The scenario engine is **parameter-sweep, not forecast**: "if you sell X% at today's price and prices land anywhere in [range], here's your realized outcome vs. your insurance floor and breakeven." Alerts fire only on *farmer-set* price/basis targets. Copy and code both avoid the words "recommend," "should," and "predict" — see DEPENDENCIES.md on the CTA exemption.

## 7. Security & privacy baseline

Farm financial and geospatial data is sensitive commercial data: per-operation row scoping from day one, encrypted at rest, no third-party analytics on authenticated pages, farmer owns and can export/delete their data (deletion of *audit-anchored* claim evidence is tombstoned, not destroyed — flag to counsel). Data-sharing with lenders/agents is opt-in per relationship, never default.
