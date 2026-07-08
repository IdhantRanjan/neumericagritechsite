# Neumeric — Adversarial Audit of the CV/ML Results

**Date:** 2026-07-08 · **Auditor:** independent re-execution of every claim, attempting to break them.
**Scope:** the backtest-v2 verdict in [ENGINES.md](ENGINES.md) §3c, the sensor routing, the drone
pipeline, and every user-facing number. Verdict format: **PASS / FAIL** with evidence and the
exact command to reproduce.

**Summary: 4 PASS, 1 FAIL→FIXED.** The reported near-null result survives adversarial
re-examination — including a 100,000-draw label-permutation control that confirms the raw
engine's stress/control contrast is indistinguishable from chance (exactly as reported) while
the weather-corroborated contrast is real. The audit caught one genuine launch-blocking bug:
the drone pipeline rejected every real georeferenced orthomosaic (a geotiff.js API misuse),
now fixed and re-verified on real data.

---

## A1 — Exact reproduction of every reported number: **PASS**

Full from-scratch re-run of the frozen engine (`s2-l2a-cd@1.0.0`) over all 37 rotation-clean
patches: fresh SQLite catalog, fresh scene fetches from the public Sentinel-2 archive, fresh
weather pulls.

- **Per-unit: 0 differences across all 37 units** on every field (`ok`, `significant`,
  `fieldZ`, `severityPct`, `affectedFrac`, `confidence`, `extent`, `persistence`).
- Summary identical: stress_strong 2/4, stress_moderate 1/2, control 13/31 fired;
  specificity 0.58; z means −2.315 / −2.157 / −1.264; calibration bins identical
  (0.7–0.85 → 0.14, 0.85–1.0 → 0.25).
- Same `PARAMS_HASH` (`e1c2fd220891a287…`) in both runs.

Evidence: `platform/scripts/ml/backtest-v2-report.orig.json` vs
`backtest-v2-report.repro.json`. Reproduce:
`npx tsx scripts/ml/backtest-v2.ts scripts/ml/events-v2.json <out>`.

## A2 — Label-permutation negative control: **PASS** (confirms the near-null)

Design note stated honestly: the engine never reads labels (they cannot leak into the
pipeline), so permutation tests whether the *observed stress-vs-control contrasts* exceed
random label assignment. 100,000 permutations, seed 20260708, strata sizes preserved
(6 stress / 31 control). Output: `platform/scripts/ml/out/permutation-null.json`.

| Contrast | Observed | Null mean ± sd | One-sided p |
|---|---|---|---|
| Raw fire-rate diff (stress − control) | +0.081 | 0.000 ± 0.224 | **0.53** |
| Weather-corroborated fire-rate diff | +0.333 | 0.000 ± 0.102 | **0.023** |
| Field-z mean diff | −0.999 | 0.000 ± 1.040 | **0.17** |

Interpretation — and this is the point of the control:
- The **raw engine's apparent skill sits squarely inside the null (p=0.53)** — statistically
  indistinguishable from chance. This *corroborates* the reported verdict ("the raw NDVI gate
  does not discriminate at patch scale"); had we claimed raw skill, this would be the red flag.
- The **weather-corroborated contrast is outside the null (p=0.023)** — the only real signal,
  matching the reported 0/31-false-positive finding. Honest caveat, stated: window
  precipitation and USDM drought labels are physically correlated by construction, so part of
  this significance is "weather predicts drought counties." The lever's product value is its
  *specificity* (never firing on quiet seasons) jointly with the CV fire — as reported.
- **The z-separation is NOT significant (p=0.17) at n=6.** ENGINES.md's description of the
  z-distributions ("heavy overlap") is accurate, but the backtest runner's aside that the
  continuous contrast is "higher-power" should not be read as "significant" — it is not, and
  this audit flags it. No claim in the product rests on z-separation.

## A3 — Leakage audit: **PASS**

- **Pre-registration order verified in git:** design doc committed 02:57
  (`c066ec1`, design file only — no events, no results); event set built 08:04
  (`events-v2.json` `builtAt`); results after that. Nothing in the design changed post-hoc.
- **All cutoffs a priori in the pre-registered design:** USDM strata (D2+ ≥25% /
  D1+=100%×3wk / D1+<25%), fixed July-5 control date, peak-severity-week event dates,
  rotation-clean CDL rule (corn in event year at 3 points AND corn at center in all 3
  baseline years), and the **60% rainfall-deficit corroboration cutoff** — all present in
  `git show c066ec1:platform/scripts/ml/design-backtest-v2.md`.
- **Engine frozen:** `git diff c066ec1..HEAD -- src/lib/satellite/{methodology,damage}.ts`
  is empty — byte-identical to pre-registration. No threshold, parameter, or baseline was
  touched by any test patch.
- Residual honest caveat (not leakage): county-level labels are weak; this bounds what
  "sensitivity/specificity" mean, as stated in ENGINES §3c.

## A4 — Determinism checks: **FAIL → FIXED → PASS**

- **Routing rule:** deterministic and stable — repeated invocations produce identical
  decisions and rule hash (`sensor-routing@1.0.0`, hash `c341bef0…`): hail/flood/disease →
  drone (+satellite/phone corroboration), drought/monitoring/yield/trigger → satellite.
  Every decision is persisted with rationale in `routing_decisions`.
- **Drone pipeline — the audit's genuine catch:** running `analyzeOrtho` on a *real*
  georeferenced GeoTIFF (Sentinel-2 TCI, EPSG:32616) was **rejected as "no
  georeferencing."** Root cause: geotiff.js exposes geo keys via the `getGeoKeys()` method;
  the code read a nonexistent `.geoKeys` property, so **every real orthomosaic upload would
  have failed**. (The earlier synthetic-GeoTIFF unit test could not catch this because the
  JS writer cannot emit geo keys — the gap the audit brief anticipated.) **Fixed** in
  `src/lib/drone/analyze.ts`; re-verified on the real file: EPSG 32616 read, 3,195 field
  pixels analyzed, and two runs on identical bytes produce **byte-identical output**
  (sha256 `4522dcf18e6d5c86…`). Reproduce: `npx tsx scripts/audit-drone-determinism.ts`
  (downloads one public TCI scene).
- Sensible-result check: on the healthy June-17 pre-drought scene the within-capture
  segmentation finds 0% anomalous — no false damage on a healthy field.

## A5 — Honesty sweep: **PASS** (no fabricated numbers found)

Checked every place a number or confidence reaches a user:

- **Satellite confidence** capped at 0.95, displayed as "heuristic, not calibrated" on the
  claim page and packet — consistent with the measured anti-calibration (top bin ≈25%).
- **Drone FCRs** carry `confidence: 0` and `validationStatus: "unvalidated_pipeline"`;
  the narrative says so in plain language.
- **Sim prior** (`sim-prior@0.1.0`): `production: false`, described everywhere as
  "simulation-trained prior, NOT validated on real fields"; its reported metrics
  (85.3% pixel accuracy, precision 0.98 / recall 0.96 binary) are explicitly **held-out
  SIMULATED-scene** numbers, never presented as real-field accuracy; it drives no claim,
  trigger, or displayed damage number.
- **Fusion engine** defaults to abstention; the claim page renders the abstain state as
  such ("cannot honestly answer") rather than a number.
- **Demo surfaces**: guided tour badged "Sample farm"; demo packet stamped "Sample packet —
  fictional data, demo analysis. Not for submission."; demo workspace banner present; the
  demo analyzer is registry-barred from real operations.
- **Docs vs data:** every figure in ENGINES.md §3c matches `backtest-v2-report.json`
  exactly (verified programmatically in A1).
- Landing page claims checked against the measured verdict: the proof section shows the
  *drought* detection (which satellite genuinely resolves) and the tiered-sensor copy
  explicitly says hail-scale damage needs the drone tier — no inflated claim found.

---

## Conditions attached to the PASS

1. n=6 stress patches → every sensitivity number carries a wide CI; treat 33% corroborated
   sensitivity as a point estimate on a small sample, never as a marketing number.
2. The weather-corroboration significance partially encodes label correlation (A2 caveat);
   its defensible product claim is the specificity behavior, not a sensitivity claim.
3. The drone pipeline is deterministic and now proven on real georeferenced input, but
   remains **unvalidated against ground truth** until Track B captures exist — its FCRs must
   keep `confidence: 0` until then.
