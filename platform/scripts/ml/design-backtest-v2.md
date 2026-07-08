# Backtest v2 — pre-registered design (written BEFORE running)

This document is committed before any v2 result exists. The engine under
test is `s2-l2a-cd@1.0.0` **unchanged** — same PARAMS, same PARAMS_HASH as
production. Nothing in this design may be altered after results are seen;
any follow-up experiment gets its own design doc (v3) and says what it
changed and why.

## Question

Can the satellite change-detection engine, at 10 m with SCL cloud masking
and rotation-clean own-history baselines, detect **county-documented
drought stress** on individual ~25-acre corn patches — and what is its
false-positive rate on documented-quiet seasons?

This tests the *drought/deficit* path (region-wide, temporal-z gate). It
does NOT test localized acute damage (hail strips, flood pockets): no
authoritative field-level labels for those exist at any scale — that is
precisely the blindness the drone tier and the Track-B label flywheel
address, and we say so rather than improvising labels.

## Units & sampling (deterministic)

- 20 Illinois counties (the extraction set — spread across ag districts).
- Years 2019–2025 (Sentinel-2 L2A era with ≥3 prior seasons available).
- One ~25-acre patch per county-year, sampled by seeded PRNG
  (`fips-year-corn-v2`), accepted only if USDA CDL says **corn in the event
  year at 3 points** (center + 2 diagonals) **and corn at the center point
  in ALL 3 baseline years** (kills the rotation contamination that
  invalidated backtest v1). Up to 30 candidates per unit; units with no
  qualifying patch are dropped and counted.

## Labels (authoritative, county-level — stated as weak/aggregate)

From US Drought Monitor weekly county statistics (cumulative % area), June 1
– Aug 15 window, and RMA cause-of-loss (corroboration only, never the
gate):

- **stress-strong**: any week with D2+ area ≥ 25%.
- **stress-moderate**: no stress-strong, but D1+ area = 100% for ≥ 3
  consecutive weeks.
- **control**: every week has D1+ area < 25% (and D2 = 0).
- **excluded**: anything between — ambiguous seasons are not scored either
  direction; their count is reported.

County-level labels document that the *county* was in drought, not that a
specific patch lost X%. A patch in a stress county that genuinely escaped
damage (irrigation, soil, luck) counts against sensitivity — this makes the
measured sensitivity a floor, stated as such.

## Event dates (deterministic)

- stress units: the ValidStart of the peak-severity week (max D2+ area;
  ties → earlier week; stress-moderate → first week of the qualifying
  D1=100% run).
- control units: July 5 of that year (fixed, pre-registered).

## Predictions & scoring

Engine fires = `significant === true` from `detectDamage` (v1.0.0).

- Sensitivity (per stratum) = fired / assessable, with 95% Wilson CIs.
- Specificity = 1 − (fired / assessable controls).
- `ok:false` units (clouds/coverage) are reported as *unassessable*, not
  failures — but the unassessable rate is itself a headline metric (it is
  the revisit/cloud blindness of the sensor).
- Reliability curve: bin fired-call confidence; empirical precision per
  bin (weak-label caveat attached).
- Lever variant (measured, engine untouched): fire AND window
  precipitation < 60% of the 10-year same-window normal (Open-Meteo ERA5)
  — the weather-corroboration gate. Reported beside the raw engine.

## What would count as what

- High sensitivity on stress-strong + low control fire rate → the deficit
  path works at patch level; state the operating point.
- Low sensitivity even on stress-strong with rotation-clean baselines →
  either a physics ceiling (10 m NDVI can't separate D2 drought stress on
  corn from normal variance at patch scale) or a gate miscalibration; we
  report which the z-score distributions indicate — and do NOT move the
  gate in this cycle either way.
- High control fire rate → the gate is too permissive for real seasons;
  cap product claims accordingly.

## Compute & reproducibility

Local SQLite (`.data/backtest2.db`), 3 workers. Every assessment stores the
full trace (scenes, hashes, baselines, z, PARAMS_HASH). Rerunning with the
same catalog state reproduces byte-identical assessments.
