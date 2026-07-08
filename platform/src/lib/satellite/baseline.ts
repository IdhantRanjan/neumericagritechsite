/**
 * Baselines for change detection.
 *
 * Temporal: the field's own expected NDVI at a given day-of-year, from
 * prior-season observations within ±DOY window, Gaussian-kernel weighted.
 * Exposes n, μ, σ so callers see baseline strength, never just a number.
 *
 * Spatial: the ring region around the field (same scenes, reduced
 * resolution) — separates "this field dropped" from "the whole area
 * dropped" (region-wide drought vs localized hail/flood).
 */
import type { GeoJSONPolygon } from "@/db/schema";
import type { sceneObservations } from "@/db/schema";
import { PARAMS } from "./methodology";
import { gridForBbox, rasterizeRing, ringBbox, ringToUtm } from "./geo";
import { readBandOnGrid, readSclOnGrid } from "./cog";
import type { SceneRef } from "./stac";

type Observation = typeof sceneObservations.$inferSelect;

export interface TemporalBaseline {
  n: number;
  mean: number | null;
  sigma: number | null;
  yearsUsed: number[];
  window: { doy: number; plusMinus: number };
}

/** Expected NDVI (field mean) at `doy` from prior-year observations. */
export function temporalBaseline(
  observations: Observation[],
  doy: number,
  eventYear: number
): TemporalBaseline {
  const w = PARAMS.detection.baselineDoyWindow;
  const usable = observations.filter(
    (o) =>
      o.year < eventYear &&
      o.year >= eventYear - PARAMS.detection.baselineYears &&
      Math.abs(o.doy - doy) <= w &&
      o.clearFrac >= PARAMS.masking.minClearFrac &&
      typeof o.stats.ndvi_mean === "number"
  );
  if (usable.length === 0) return { n: 0, mean: null, sigma: null, yearsUsed: [], window: { doy, plusMinus: w } };

  // Gaussian kernel over DOY distance (σ = half the window)
  const kSigma = w / 2;
  let wsum = 0,
    mean = 0;
  for (const o of usable) {
    const kw = Math.exp(-((o.doy - doy) ** 2) / (2 * kSigma ** 2));
    wsum += kw;
    mean += kw * o.stats.ndvi_mean;
  }
  mean /= wsum;
  let varsum = 0;
  for (const o of usable) {
    const kw = Math.exp(-((o.doy - doy) ** 2) / (2 * kSigma ** 2));
    varsum += kw * (o.stats.ndvi_mean - mean) ** 2;
  }
  const sigma = Math.sqrt(varsum / wsum);
  return {
    n: usable.length,
    mean: Math.round(mean * 10000) / 10000,
    // floor σ: with few obs the sample σ underestimates true variance
    sigma: Math.round(Math.max(sigma, 0.05) * 10000) / 10000,
    yearsUsed: [...new Set(usable.map((o) => o.year))].sort(),
    window: { doy, plusMinus: w },
  };
}

export interface RegionalDelta {
  preMean: number | null;
  postMean: number | null;
  delta: number | null; // post − pre over the ring region
  clearFracPre: number;
  clearFracPost: number;
  ringM: number;
  sampleResM: number;
}

const CLEAR = new Set<number>(PARAMS.masking.clearClasses);

/** Mean NDVI over the ring region (bbox buffer minus the field) for one scene. */
async function regionNdviMean(
  boundary: GeoJSONPolygon,
  scene: SceneRef
): Promise<{ mean: number | null; clearFrac: number }> {
  const utm = ringToUtm(boundary, scene.epsg);
  const [minX, minY, maxX, maxY] = ringBbox(utm.ring);
  const ring = PARAMS.grid.regionRingM;
  const res = PARAMS.grid.regionSampleM;
  const grid = gridForBbox(
    scene.epsg,
    [minX - ring, minY - ring, maxX + ring, maxY + ring],
    res
  );
  const fieldMask = rasterizeRing(grid, utm.ring);
  const [red, nir, scl] = await Promise.all([
    readBandOnGrid(scene.assets.red, grid, scene),
    readBandOnGrid(scene.assets.nir, grid, scene),
    readSclOnGrid(scene.assets.scl, grid),
  ]);
  let sum = 0,
    n = 0,
    total = 0;
  for (let i = 0; i < red.length; i++) {
    if (fieldMask[i]) continue; // exclude the field itself
    total++;
    const R = red[i],
      N = nir[i];
    if (!Number.isFinite(R) || !Number.isFinite(N) || !CLEAR.has(scl[i]) || N + R <= 0.02) continue;
    sum += (N - R) / (N + R);
    n++;
  }
  return {
    mean: n > 20 ? Math.round((sum / n) * 10000) / 10000 : null,
    clearFrac: total > 0 ? Math.round((n / total) * 10000) / 10000 : 0,
  };
}

export async function regionalDelta(
  boundary: GeoJSONPolygon,
  preScene: SceneRef,
  postScene: SceneRef
): Promise<RegionalDelta> {
  const [pre, post] = await Promise.all([
    regionNdviMean(boundary, preScene),
    regionNdviMean(boundary, postScene),
  ]);
  return {
    preMean: pre.mean,
    postMean: post.mean,
    delta:
      pre.mean != null && post.mean != null
        ? Math.round((post.mean - pre.mean) * 10000) / 10000
        : null,
    clearFracPre: pre.clearFrac,
    clearFracPost: post.clearFrac,
    ringM: PARAMS.grid.regionRingM,
    sampleResM: PARAMS.grid.regionSampleM,
  };
}
