# Neumeric — Engine Methods & Guarantees

The hard technical cores, one section each: what the method is, why it's
deterministic and reproducible, what its known limitations are, and the exact
external dependency — (a) labeled data, (b) a carrier partner, or (c) legal
review — it needs before real users rely on it for money. Companion to
[ARCHITECTURE.md](ARCHITECTURE.md) and [DEPENDENCIES.md](DEPENDENCIES.md).

**Shared invariant:** every number that could touch money carries a
methodology version + parameter hash, reads only versioned inputs, and lands
in the append-only provenance chain (§6). Same inputs ⇒ identical outputs.

---

## 0. Sensor architecture & auto-routing (`platform/src/lib/sensors/routing.ts`)

Three sensors at three scales feed **one** Field Condition Record schema —
one pipeline, multiple ingestion paths. The platform picks the sensor from
the *question*, by an explicit, versioned, logged rule (`sensor-routing@1.0.0`,
hashed) — not an ML decision — because an insurer must be able to read *why*
a given sensor produced a given number.

| Tier | Resolution / cadence | Role | Cost |
|---|---|---|---|
| **Satellite** (Sentinel-2 L2A) | 10 m, ~5-day revisit, passive | Always-on monitoring & triage: drought/season-scale health, yield features, the trigger that flags "field 7 changed" | free, zero farm hardware |
| **Drone** (farmer-operated) | 1–3 cm, on-demand | Claim-evidence quantification when damage features are smaller than a satellite pixel or decay faster than the revisit (hail strips, flood pockets) | farmer's own flight; Neumeric flies nothing |
| **Phone** (farmer) | ground, on-demand | Corroboration in every packet + the ground-truth label channel for the flywheel | — |

**Routing rule.** For `continuous_monitoring` / `yield_estimate` /
`parametric_trigger` → satellite (field-scale, season-scale, inside 10 m and
the revisit). For a `claim_event`, the rule reads the damage type's
**physics** — characteristic feature scale and how fast evidence decays
(`DAMAGE_PHYSICS` in the routing module) — and escalates to drone when the
feature is sub-pixel (needs ≥2 px, i.e. <20 m) *or* decays in hours/days
(outruns the ~8-day median clear revisit in IL summer). Drought → satellite
suffices; hail/wind/flood → drone primary, with satellite as the independent
wide-area cross-check and phone as ground corroboration. Every decision is
written to `routing_decisions` (rule version + hash + rationale) and the
audit log, and shown on the claim page. This is the concrete link between the
§3c backtest finding (10 m can't resolve localized acute damage) and the
product: the same physics that blinds the satellite is what *routes* those
events to the drone tier.

**Drone pipeline** (`lib/drone/analyze.ts`, `drone-rgb-exg@0.1.0`): ingests a
georeferenced orthomosaic GeoTIFF (RGB → ExG, or RGB+NIR → NDVI), reprojects
the field boundary into the raster CRS, samples on an analysis grid capped at
0.5 m effective (cm detail is averaged down, never upsampled), and segments
affected area vs the capture's *own* robust healthy statistics (median − 3·MAD
AND below an absolute vegetation floor). Emits an FCR through the shared
schema with real affected-area geometry. **Honesty status: the pipeline is
deterministic and auditable but UNVALIDATED** — no real damage-labeled drone
captures exist yet (that is exactly what Track B collects), so its FCR
confidence is reported as **0 ("uncalibrated")**, never invented, and its
within-capture segmentation says "this part of the field looks far worse than
the rest of the same image" — it locates and sizes the anomaly; cause comes
from the narrative, phone corroboration, and the satellite cross-check.

## 1. Satellite damage engine (`platform/src/lib/satellite/`)

**Methodology `s2-l2a-cd@1.0.0`** — parameters in `methodology.ts`, pinned by
`PARAMS_HASH` (sha256 of canonical JSON); any change requires a version bump.

**Data.** Sentinel-2 L2A surface reflectance from the open AWS archive via
Element84 Earth Search STAC — free, no key, public immutable COGs. Windowed
COG reads fetch only the bytes over the field (a few hundred KB per band, not
the 700 MB tile). One scene per calendar day (lowest cloud wins,
deterministic tiebreak); scenes are pinned by a **scene reference hash**
(sha256 of item id + asset URLs + acquisition time) recorded on every
observation. Analysis runs on a 10 m grid snapped to the absolute Sentinel-2
UTM grid, so every scene of a field aligns pixel-for-pixel across dates.

**Cloud handling.** Per-pixel masking from the SCL band (clear classes 4/5/6/7;
water tracked separately because flooding *is* signal). Observations under
65% clear over the field are stored but excluded from baselines and
detection — a cloudy scene can never silently bias a claim number.

**Indices.** NDVI (primary), EVI, NDRE, ExG per pixel; field aggregates
(mean/median/p10/p90/σ, % below threshold) stored per scene per field in
`scene_observations`, append-only per methodology version.

**Detection — change vs two baselines, two damage modes.**
- *Temporal baseline:* the field's own same-day-of-year NDVI expectation from
  up to 3 prior seasons, Gaussian-kernel weighted over ±15 days, with n and σ
  always exposed (σ floored at 0.05 — small samples never fake precision).
- *Spatial baseline:* the 1.5 km ring around the field (same scenes, 40 m
  sampling, field excluded) — separates "this field got hit" from "the whole
  area moved," i.e. localized hail vs regional drought.
- *Post-event scene* = the **worst** clear observation in the 30-day window
  (claims document condition at its worst); a **persistence** check against
  the next clear pass reports whether the deficit held or the crop recovered.
- *Pixel tests:* **acute** (NDVI drop pre→post beyond both an absolute floor
  and the regional change — hail/flood/wind) and **deficit** (NDVI below the
  multi-year expectation minus max(2σ, 0.15) — drought/disease that
  suppresses growth without reversing it). Affected area = union, output as
  real geometry (30 m cells, deterministic merge).
- *Significance:* field z ≤ −1.5 with ≥5% affected, or a localized gap vs the
  region with ≥15% affected. Extent labeled `localized` / `region-wide`.

**Confidence is heuristic v1 and says so:**
`min(0.95, clear × (0.4 + 0.6·baselineStrength) × (0.5 + 0.5·effectSize))` —
capped below 1 on principle. It is **not calibrated**; calibration requires
the §2 label flywheel (needs (a) labeled data). When the method can't produce
a defensible answer (no clear pre/post scene, <30 comparable pixels, zone
mismatch, upstream hash mismatch) it returns `ok: false` with the reason —
never a guessed number.

**Verified real-world run** (committed at
`docs/examples/proof-2023-drought-home80.txt`, reproduced end-to-end through
the UI): a real DeKalb County IL boundary, 43 real scenes across 2020–2023,
detecting the June 2023 flash drought at z = −3.2 vs the field's own
baseline, 93% of pixels below expectation, correctly labeled region-wide,
persistence confirmed in the 2023-07-07 pass. Scene reference hashes matched
byte-for-byte across two independent runs.

**Known limitations.** 10 m optical: no sub-canopy damage (early lodging,
stalk bruising), thin haze/smoke inside "clear" SCL pixels can depress NDVI
(June 2023 had wildfire smoke over IL — flagged, not hidden), 2–5-day revisit
gaps under persistent cloud, no growth staging, region ring may include
non-crop cover (documented; CDL crop masking is the upgrade path). Fields
straddling a UTM zone boundary lose per-pixel comparison. Planet/drone
imagery slot in behind the same `readScenePixels` interface when licensed
((b)-adjacent: imagery licensing, DEPENDENCIES §3).

## 2. ML data flywheel (`ground_truth_labels`, `training-export.ts`, `cv/registry.ts`)

Confirmed outcomes — adjuster settlement %, farmer damage estimate, harvested
yield — are recorded against the claim, field, and the exact FCR whose
prediction they grade, and committed to the provenance chain.
`scripts/export-training.ts` materializes label + FCR metrics + season
time-series features into training-ready JSONL, keyed by methodology version.

The **model registry** is the pluggable interface: models declare
`production: true|false`, and the demo stub is hard-barred from real
operations in code, not by UI convention. **Training threshold:** a learned
regressor earns a registry slot at roughly **150+ labeled events per damage
type** with holdout error beating the index method; below that, training
would be fitting noise and presenting it as product. Until then the
explainable change-detection path is primary. No baseline model is shipped —
a placeholder regressor trained on public proxy data was considered and
skipped; nothing in the registry pretends to a skill it doesn't have.

## 3. Satellite yield estimator (`satellite/yield.ts`)

Relative-to-self method: seasonal NDVI integral (trapezoid over clear passes
in the crop growth window, normalized by covered span) divided by the same
integral over ≥2 of the field's own prior seasons, scaling the farmer's own
reference yield. **Why not absolute NDVI→bushels:** that requires regional
calibration coefficients we'd have to invent — the §2 flywheel's
harvested-yield labels are exactly the data that will fit them ((a)).
The uncertainty band is real: inter-year baseline variance + coverage
penalty, floored at ±8%. Insufficient data returns a reason, not a number.
Feeds the marketing dashboard as a labeled estimate beside manual entry.

### 3b. Trained yield model (`satellite/yield-model.ts`, `scripts/ml/`)

The absolute model now exists, trained on **real labels**: USDA NASS county
corn yields (Illinois, 2019-2023) joined to Sentinel-2 NDVI season features
computed over **CDL-verified corn patches** (year-specific crop check via
CropScape — IL corn/soy rotation makes historical frequency insufficient).
141 patches, 80 county-year units, 78 label-matched samples.

**The honest headline:** NDVI features alone FAILED leave-one-year-out
validation (R² −0.41 — worse than predicting the mean, because the year
effect dominates IL county yields). That run is preserved in the training
report. Adding mechanism-chosen season weather covariates (ERA5 June-Aug
precipitation, mean daily max temp, days >32 °C) fixed the year axis:

| CV axis (Ridge, deployed) | RMSE | MAE | R² |
|---|---|---|---|
| Leave-one-year-out | 13.63 bu/ac | 11.48 | 0.205 |
| Leave-one-county-out | 11.18 bu/ac | 9.13 | 0.465 |

Deployment rules enforced in code: the in-product error is the **worst CV
axis** (13.6 RMSE), widened **1.5×** for field-vs-county disaggregation
(stated as a multiplier, not a measured field validation); corn only;
estimate available only once the season's June-August weather record is
complete (a partial-season weather sum would be a biased feature — the
self-relative estimator is the in-season indicator). Training is
reproducible: deterministic patch sampling (seeded PRNG), scene IDs
recorded per patch, `scripts/ml/train-yield.py` re-derives the model from
`features.jsonl` + the public NASS bulk file. Next accuracy step ((a)):
more years of history (Landsat/HLS) and eventually the flywheel's
field-level harvested-yield labels.

### 3c. Damage-detection backtest (`scripts/ml/backtest-damage.ts`)

Discrimination test on the production engine: same-county CDL-verified corn
patches, 2023-06-20 (documented IL flash drought) vs 2021-06-20 (intended
control). Results in `scripts/ml/backtest-report.json`.

**Result, reported as-is: the test did not pass.** 0/8 stress-year patches
crossed the significance gate (severity magnitudes moved the right way —
33–43% on the hit counties — but none were ruled significant); 2/8 fired in
the "control" year. Two design flaws in the test itself are the leading
explanations, documented in the report: (1) rotation contamination — patches
were corn in the event year but often soybeans in baseline years, so the
"field's own history" baseline is a different crop; (2) 2021 was not a clean
control in far-north IL (the two 2021 fires sit inside the real June-2021
northern-IL dry spell). The single-field proof on a real boundary with four
scanned seasons (docs/examples/) detected the same event at severity 62%,
confidence 0.95. Deliberate decision: detection thresholds were NOT tuned to
make the backtest pass — that would overfit the test and require a
methodology version bump. Next steps are in the report (rotation-consistent
patches, cleaner control year); the definitive measurement remains
field-level adjuster-graded labels from the §2 flywheel.

### 3d. CDL crop verification (`satellite/cdl.ts`)

USDA Cropland Data Layer composition for any field boundary (CropScape
clip, EPSG:5070, point-in-polygon at 30 m). Recorded on satellite FCRs as
*additive* evidence ("USDA's own layer says this boundary was 94% corn in
2023") and used to verify training patches. It deliberately does NOT mask
the index statistics — that would change outputs under an unchanged
methodology version, which the provenance discipline forbids. Per-pixel CDL
masking is specced as methodology v1.1 (requires a version bump and
re-observation).

## 4. Monte Carlo marketing engine (`marketing-mc.ts`)

Per selling schedule, 4,000 simulated price worlds: futures follow
**zero-drift** GBM (the engine's stated stance is "we do not know where price
goes" — volatility widens the cone, never tilts it), local basis follows an
Ornstein–Uhlenbeck process mean-reverting to the farm's own stated range
(the farmer's range *is* the calibration — no pretended market model).
Insurance guarantee folds in as an embedded put on harvest-month futures
(simplified RP payoff, stated in the UI). All schedules see the *same*
worlds, so row differences are the schedule, not sampling noise. Output is
P10/P50/P90 net revenue with and without the floor, odds below breakeven,
odds the cash need is met by its date.

**Deterministic:** seeded PRNG (mulberry32) derived from the position's own
numbers — same inputs, identical distributions anywhere. **Non-directive by
construction ((c)):** no ranking, no "optimal" flag, no recommendation
sentence exists in the code path; rows render in fixed order. CTA-exemption
legal review (DEPENDENCIES §7) is still required before real-user launch,
and futures-vol defaults (24%) plus the simplified floor payoff are
disclosed assumptions, not claims.

## 5. Parametric trigger engine (`parametric.ts`)

A trigger definition pins metric, comparator, threshold, consecutive-pass
count, clear-fraction minimum, imagery source class, AND the §1 pipeline
version — hashed into `methodologyHash`. Evaluation reads only stored
append-only observations in the window; cloudy passes neither extend nor
break a breach run (stated rule). The full trace — every observation, its
value, usability, breach status, the firing run — is stored with the
evaluation and committed to the provenance chain. Same definition + same
observations ⇒ byte-identical trace.

**Basis-risk artifact:** every evaluation also computes the weather-index
counterpart (window rainfall vs the location's own 10-year normal,
Open-Meteo ERA5 — free tier; commercial weather-data licensing is flagged)
and classifies the gap. Verified real case (June–July 2023, DeKalb IL):
**CV trigger fired (4 consecutive passes below NDVI 0.40) while rainfall sat
at 76% of normal — above the 60% deficit line, so a rainfall-index product
would not have paid.** That gap, produced from real data under a locked
methodology, is the product.

**Hard gate ((b)):** definitions are created inactive with
`carrierContractRef: null`. Activating a trigger — attaching real money to
it — requires a licensed carrier/reinsurer partner and a co-signed
methodology (DEPENDENCIES §5–6). There is no underwriting or pricing math in
the codebase, deliberately.

## 6. Provenance chain + durable storage (`provenance.ts`, `storage.ts`)

Every capture, condition record, trigger evaluation, and label appends a
chain entry: `entryHash = sha256(seq | prevHash | payloadSha256 | entity |
action | at)`, HMAC-signed with a server key. Altering any historical record
breaks every later hash; `verifyChain()` re-walks the whole chain and the
evidence packet displays the verification result and head hash.

Evidence bytes live in content-addressed durable object storage (Vercel
Blob in production, keyed by sha256 — the hash in the record IS the storage
key, so integrity checking is fetch + re-hash, no trust required; the
3-function interface swaps to R2/S3 trivially). Satellite scenes are stored
as **references** (public immutable archive + scene reference hash) rather
than copies — stated distinction, not a hidden one.

**Honest limitations, and the next step ((c)-adjacent):** HMAC signing means
a server-key holder could rebuild the chain, and timestamps are
server-asserted. Independent verifiability requires asymmetric signatures +
external timestamp anchoring (RFC 3161 / OpenTimestamps) — designed for,
not yet wired. Until then the chain defends against DB tampering and
after-the-fact edits, and the packet says exactly that rather than claiming
more.

---

## Operational notes

- **Serverless duration:** field scans are batched (~20 scenes/click) and
  scan pages set `maxDuration = 300`. For a brand-new field, scan from the
  field page first, then run claim analysis (which then only re-reads the
  two event scenes + region). Full-season backfills: `npx tsx
  scripts/prove-damage.ts` / CLI scans.
- **Env:** `PROVENANCE_KEY` (chain signing), `BLOB_READ_WRITE_TOKEN`
  (evidence storage) — both set on Vercel prod/preview.
- **Reproduction:** `cd platform && npx tsx scripts/prove-damage.ts
  2023-06-20` re-derives the committed drought detection from live public
  data.
