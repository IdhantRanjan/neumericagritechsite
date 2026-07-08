/**
 * Per-scene field observation: read the bands covering the field's analysis
 * grid, mask clouds per-pixel with SCL, compute vegetation indices and
 * aggregate statistics. Pixel arrays are returned to callers (damage
 * detection reuses them); aggregates get persisted as scene_observations.
 */
import type { GeoJSONPolygon } from "@/db/schema";
import { PARAMS } from "./methodology";
import { gridForBbox, rasterizeRing, ringBbox, ringToUtm, type Grid } from "./geo";
import { readBandOnGrid, readSclOnGrid } from "./cog";
import type { SceneRef } from "./stac";

export interface ScenePixels {
  grid: Grid;
  fieldMask: Uint8Array; // 1 = inside field boundary
  clearMask: Uint8Array; // 1 = SCL clear class AND valid data
  ndvi: Float32Array; // NaN where invalid
  evi?: Float32Array;
  ndre?: Float32Array;
  exg?: Float32Array;
  clearFrac: number;
  waterFrac: number;
  validPixels: number;
  totalPixels: number;
}

export interface ObservationStats {
  clearFrac: number;
  waterFrac: number;
  validPixels: number;
  totalPixels: number;
  stats: Record<string, number>;
}

const CLEAR = new Set<number>(PARAMS.masking.clearClasses);

export function fieldGrid(boundary: GeoJSONPolygon, epsg: number): Grid {
  const utm = ringToUtm(boundary, epsg);
  return gridForBbox(epsg, ringBbox(utm.ring), PARAMS.grid.resolutionM);
}

/** Read one scene over one field. mode "core" = NDVI only (baselines); "full" adds EVI/NDRE/ExG. */
export async function readScenePixels(
  boundary: GeoJSONPolygon,
  scene: SceneRef,
  mode: "core" | "full" = "core"
): Promise<ScenePixels> {
  const utm = ringToUtm(boundary, scene.epsg);
  const grid = gridForBbox(scene.epsg, ringBbox(utm.ring), PARAMS.grid.resolutionM);
  const fieldMask = rasterizeRing(grid, utm.ring);

  const wantFull = mode === "full" && scene.assets.blue && scene.assets.green && scene.assets.rededge1;
  const [red, nir, scl, blue, green, re1] = await Promise.all([
    readBandOnGrid(scene.assets.red, grid, scene),
    readBandOnGrid(scene.assets.nir, grid, scene),
    readSclOnGrid(scene.assets.scl, grid),
    wantFull ? readBandOnGrid(scene.assets.blue!, grid, scene) : null,
    wantFull ? readBandOnGrid(scene.assets.green!, grid, scene) : null,
    wantFull ? readBandOnGrid(scene.assets.rededge1!, grid, scene) : null,
  ]);

  const n = grid.width * grid.height;
  const clearMask = new Uint8Array(n);
  const ndvi = new Float32Array(n).fill(NaN);
  const evi = wantFull ? new Float32Array(n).fill(NaN) : undefined;
  const ndre = wantFull ? new Float32Array(n).fill(NaN) : undefined;
  const exg = wantFull ? new Float32Array(n).fill(NaN) : undefined;

  let total = 0,
    valid = 0,
    water = 0;
  for (let i = 0; i < n; i++) {
    if (!fieldMask[i]) continue;
    total++;
    const R = red[i],
      N = nir[i];
    const cls = scl[i];
    const hasData = Number.isFinite(R) && Number.isFinite(N) && cls !== 0;
    const clear = hasData && CLEAR.has(cls);
    if (cls === PARAMS.masking.waterClass && hasData) water++;
    if (!clear) continue;
    valid++;
    clearMask[i] = 1;
    if (N + R > 0.02) ndvi[i] = (N - R) / (N + R);
    if (wantFull && blue && green && re1) {
      const B = blue[i],
        G = green[i],
        E = re1[i];
      if (Number.isFinite(B)) {
        const denom = N + 6 * R - 7.5 * B + 1;
        if (Math.abs(denom) > 0.05) evi![i] = (2.5 * (N - R)) / denom;
      }
      if (Number.isFinite(E) && N + E > 0.02) ndre![i] = (N - E) / (N + E);
      if (Number.isFinite(B) && Number.isFinite(G)) exg![i] = 2 * G - R - B;
    }
  }

  return {
    grid,
    fieldMask,
    clearMask,
    ndvi,
    evi,
    ndre,
    exg,
    clearFrac: total > 0 ? valid / total : 0,
    waterFrac: total > 0 ? water / total : 0,
    validPixels: valid,
    totalPixels: total,
  };
}

function summarize(values: number[]): Record<string, number> {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return {};
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  return {
    mean: r4(mean),
    median: r4(q(0.5)),
    p10: r4(q(0.1)),
    p90: r4(q(0.9)),
    std: r4(std),
  };
}

export function observationStats(px: ScenePixels): ObservationStats {
  const stats: Record<string, number> = {};
  const collect = (name: string, arr?: Float32Array) => {
    if (!arr) return;
    const vals: number[] = [];
    for (let i = 0; i < arr.length; i++)
      if (px.clearMask[i] && Number.isFinite(arr[i])) vals.push(arr[i]);
    const s = summarize(vals);
    for (const [k, v] of Object.entries(s)) stats[`${name}_${k}`] = v;
    if (name === "ndvi" && vals.length > 0) {
      stats.ndvi_frac_below_040 =
        Math.round((vals.filter((x) => x < 0.4).length / vals.length) * 10000) / 10000;
    }
  };
  collect("ndvi", px.ndvi);
  collect("evi", px.evi);
  collect("ndre", px.ndre);
  collect("exg", px.exg);
  return {
    clearFrac: Math.round(px.clearFrac * 10000) / 10000,
    waterFrac: Math.round(px.waterFrac * 10000) / 10000,
    validPixels: px.validPixels,
    totalPixels: px.totalPixels,
    stats,
  };
}
