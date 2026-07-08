/**
 * Satellite yield estimation (Hard Core 3) — honest version.
 *
 * Method: seasonal NDVI integral (trapezoid over clear observations in the
 * crop's growth window) for the current season, RELATIVE to the same
 * integral over the field's own prior seasons. The ratio scales the
 * farmer's own reference yield (their APH / expected bu/ac):
 *
 *   estimate = referenceYield × (thisSeasonIntegral / baselineIntegral)
 *
 * Why relative-to-self instead of an absolute NDVI→bushels model: an
 * absolute model requires regional calibration data we do not yet have
 * (that arrives via the Hard Core 2 label flywheel — harvested-yield labels
 * feed exactly this). A relative estimate needs no invented coefficients,
 * inherits the farmer's own agronomic reality, and its assumptions are
 * inspectable. The uncertainty band comes from real sources: inter-year
 * baseline variance + observation-coverage penalty. Wide band = honest band.
 */
import type { sceneObservations } from "@/db/schema";

type Observation = typeof sceneObservations.$inferSelect;

const GROWTH_WINDOW: Record<string, { startDoy: number; endDoy: number }> = {
  corn: { startDoy: 140, endDoy: 285 },
  soybeans: { startDoy: 150, endDoy: 290 },
  wheat: { startDoy: 90, endDoy: 200 },
};

export interface YieldEstimate {
  ok: boolean;
  reason?: string;
  crop: string;
  seasonYear: number;
  estimateBuAc: number | null;
  loBuAc: number | null; // estimate ± band (≈1σ)
  hiBuAc: number | null;
  conditionRatio: number | null; // this season vs own-history NDVI integral
  referenceYieldBuAc: number;
  drivers: {
    seasonIntegral: number | null;
    baselineIntegralMean: number | null;
    baselineYears: number[];
    baselineCv: number | null; // inter-year coefficient of variation
    obsCount: number;
    coverageFrac: number; // fraction of the growth window covered by clear obs
    latestObsDate: string | null;
  };
}

const MIN_CLEAR = 0.6;

/** Trapezoid integral of NDVI over DOY for one year's clear observations. */
function integral(obs: Observation[], startDoy: number, endDoy: number): { value: number | null; coverage: number; n: number } {
  const pts = obs
    .filter((o) => o.clearFrac >= MIN_CLEAR && typeof o.stats.ndvi_mean === "number" && o.doy >= startDoy && o.doy <= endDoy)
    .sort((a, b) => a.doy - b.doy);
  if (pts.length < 3) return { value: null, coverage: 0, n: pts.length };
  let area = 0;
  for (let i = 1; i < pts.length; i++) {
    area += ((pts[i].stats.ndvi_mean + pts[i - 1].stats.ndvi_mean) / 2) * (pts[i].doy - pts[i - 1].doy);
  }
  const spanCovered = pts[pts.length - 1].doy - pts[0].doy;
  const coverage = spanCovered / (endDoy - startDoy);
  // normalize by covered span so partial seasons compare fairly
  return { value: area / spanCovered, coverage, n: pts.length };
}

export function estimateYield(
  observations: Observation[],
  crop: string,
  seasonYear: number,
  referenceYieldBuAc: number
): YieldEstimate {
  const win = GROWTH_WINDOW[crop] ?? GROWTH_WINDOW.corn;
  const base = (reason: string): YieldEstimate => ({
    ok: false,
    reason,
    crop,
    seasonYear,
    estimateBuAc: null,
    loBuAc: null,
    hiBuAc: null,
    conditionRatio: null,
    referenceYieldBuAc,
    drivers: {
      seasonIntegral: null,
      baselineIntegralMean: null,
      baselineYears: [],
      baselineCv: null,
      obsCount: 0,
      coverageFrac: 0,
      latestObsDate: null,
    },
  });

  const season = observations.filter((o) => o.year === seasonYear);
  const cur = integral(season, win.startDoy, win.endDoy);
  if (cur.value == null || cur.coverage < 0.3)
    return base(
      `Not enough clear in-season observations yet (${cur.n} usable, ${Math.round(cur.coverage * 100)}% of the growth window covered). Scan more of the season or wait for later passes.`
    );

  const priorYears = [...new Set(observations.filter((o) => o.year < seasonYear).map((o) => o.year))].sort();
  const baseVals: Array<{ year: number; value: number }> = [];
  for (const y of priorYears) {
    const b = integral(observations.filter((o) => o.year === y), win.startDoy, win.endDoy);
    if (b.value != null && b.coverage >= 0.3) baseVals.push({ year: y, value: b.value });
  }
  if (baseVals.length < 2)
    return base(
      `Only ${baseVals.length} usable prior season(s) for this field — need at least 2 for a self-relative baseline. Scan prior seasons.`
    );

  const bMean = baseVals.reduce((a, b) => a + b.value, 0) / baseVals.length;
  const bStd = Math.sqrt(baseVals.reduce((a, b) => a + (b.value - bMean) ** 2, 0) / baseVals.length);
  const cv = bStd / bMean;
  const ratio = cur.value / bMean;

  // Band: inter-year variance + coverage penalty, floored — never pretend precision
  const bandFrac = Math.max(0.08, cv + (1 - cur.coverage) * 0.15);
  const est = referenceYieldBuAc * ratio;
  const latest = season.filter((o) => o.clearFrac >= MIN_CLEAR).at(-1);

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    ok: true,
    crop,
    seasonYear,
    estimateBuAc: r1(est),
    loBuAc: r1(est * (1 - bandFrac)),
    hiBuAc: r1(est * (1 + bandFrac)),
    conditionRatio: Math.round(ratio * 1000) / 1000,
    referenceYieldBuAc,
    drivers: {
      seasonIntegral: Math.round(cur.value * 1000) / 1000,
      baselineIntegralMean: Math.round(bMean * 1000) / 1000,
      baselineYears: baseVals.map((b) => b.year),
      baselineCv: Math.round(cv * 1000) / 1000,
      obsCount: cur.n,
      coverageFrac: Math.round(cur.coverage * 100) / 100,
      latestObsDate: latest?.acquiredAt.slice(0, 10) ?? null,
    },
  };
}
