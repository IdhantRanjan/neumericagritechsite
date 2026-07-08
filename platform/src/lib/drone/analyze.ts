/**
 * Drone orthomosaic analysis — the high-resolution claim-evidence tier.
 *
 * Input: a georeferenced orthomosaic GeoTIFF (what DroneDeploy / Pix4D /
 * WebODM export from a farmer's flight), RGB or RGB+NIR. Ungeoreferenced
 * photos are NOT accepted here — they go through the phone-corroboration
 * path, because without georeferencing no acreage claim is honest.
 *
 * Method (drone-rgb-exg@0.1.0, deterministic, params-hashed):
 *  1. Reproject the field boundary into the raster CRS; sample the ortho
 *     over the field on an analysis grid capped at ~0.5 m/px equivalent
 *     (native cm-level detail is averaged, not upsampled).
 *  2. Vegetation index: ExG = 2g−r−b on channel-normalized values (RGB);
 *     NDVI when a 4th (NIR) band is declared present.
 *  3. Affected segmentation vs the field's OWN healthy statistics in the
 *     same capture: robust median/MAD; affected = index < median − k·MAD
 *     (k=3) AND below an absolute vegetation floor. Severity per affected
 *     pixel = relative deficit vs median.
 *  4. Output: affected fraction/acres, severity, affected-area geometry,
 *     full trace. Emitted as a Field Condition Record through the same
 *     schema as satellite results.
 *
 * HONESTY STATUS: this pipeline is deterministic and auditable but
 * UNVALIDATED — no real damage-labeled drone captures exist yet (that is
 * exactly what the Track-B flywheel collects). Until then:
 *  - confidence is reported as 0 ("not yet calibrated"), never invented;
 *  - within-capture segmentation says "this part of the field looks much
 *    worse than the rest of the same image" — it cannot by itself say WHY.
 *    The claim narrative + phone corroboration carry causation.
 */
import { createHash } from "node:crypto";
import proj4 from "proj4";
import { fromArrayBuffer } from "geotiff";
import type { GeoJSONPolygon } from "@/db/schema";
import { maskToMultiPolygon } from "@/lib/satellite/geo";

export const DRONE_METHODOLOGY_VERSION = "drone-rgb-exg@0.1.0";

const PARAMS = {
  maxGridDim: 700, // analysis grid cap per axis
  targetResM: 0.5, // don't analyze finer than this (average down)
  madK: 3, // affected = index < median − K·MAD
  exgVegFloor: 0.05, // absolute ExG floor (bare soil / residue sits below)
  ndviVegFloor: 0.3,
  minFieldPixels: 400,
} as const;

export const DRONE_PARAMS_HASH = createHash("sha256")
  .update(JSON.stringify({ DRONE_METHODOLOGY_VERSION, PARAMS }))
  .digest("hex");

export interface DroneAssessment {
  ok: boolean;
  reason?: string;
  methodologyVersion: string;
  paramsHash: string;
  index: "exg" | "ndvi";
  resolutionM: number; // effective analysis resolution
  fieldPixels: number;
  affectedFrac: number;
  affectedAcres: number;
  severityPct: number; // mean relative deficit over affected pixels
  affectedArea: ReturnType<typeof maskToMultiPolygon>;
  stats: Record<string, number>;
  validationStatus: "unvalidated_pipeline"; // flips only when real labeled captures exist
  narrative: string;
}

function fail(reason: string): DroneAssessment {
  return {
    ok: false,
    reason,
    methodologyVersion: DRONE_METHODOLOGY_VERSION,
    paramsHash: DRONE_PARAMS_HASH,
    index: "exg",
    resolutionM: 0,
    fieldPixels: 0,
    affectedFrac: 0,
    affectedAcres: 0,
    severityPct: 0,
    affectedArea: null,
    stats: {},
    validationStatus: "unvalidated_pipeline",
    narrative: reason,
  };
}

/** EPSG from GeoTIFF geo keys; null when the raster isn't georeferenced. */
function epsgOf(img: { geoKeys?: Record<string, number> }): number | null {
  const k = img.geoKeys ?? {};
  return k.ProjectedCSTypeGeoKey ?? k.GeographicTypeGeoKey ?? null;
}

function projDef(epsg: number): string {
  if (epsg === 4326) return "EPSG:4326";
  if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 26901 && epsg <= 26923) return `+proj=utm +zone=${epsg - 26900} +datum=NAD83 +units=m +no_defs`;
  throw new Error(`Unsupported ortho CRS EPSG:${epsg} — export the orthomosaic in WGS84 or UTM.`);
}

export async function analyzeOrtho(
  bytes: ArrayBuffer,
  boundary: GeoJSONPolygon,
  opts: { hasNir?: boolean } = {}
): Promise<DroneAssessment> {
  const tiff = await fromArrayBuffer(bytes);
  const img = await tiff.getImage();
  const epsg = epsgOf(img as never);
  if (!epsg)
    return fail(
      "The uploaded file has no georeferencing. Export the orthomosaic (GeoTIFF) from your drone-mapping app — plain photos belong in the phone-photo path."
    );
  let def: string;
  try {
    def = projDef(epsg);
  } catch (e) {
    return fail(String(e instanceof Error ? e.message : e));
  }

  const [ox, oy] = img.getOrigin();
  const [rx, ryRaw] = img.getResolution();
  const ry = ryRaw; // negative north-up
  const W = img.getWidth();
  const H = img.getHeight();
  const bands = img.getSamplesPerPixel();
  if (bands < 3) return fail(`Orthomosaic has ${bands} band(s); need RGB (3) or RGB+NIR (4).`);
  const useNdvi = Boolean(opts.hasNir && bands >= 4);

  // boundary ring in raster CRS
  const ring = boundary.coordinates[0].map(
    (p) => proj4("EPSG:4326", def, [p[0], p[1]]) as [number, number]
  );
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  // raster-pixel bbox of the field
  const col0 = Math.max(0, Math.floor((Math.min(...xs) - ox) / rx));
  const col1 = Math.min(W, Math.ceil((Math.max(...xs) - ox) / rx));
  const row0 = Math.max(0, Math.floor((Math.max(...ys) - oy) / ry));
  const row1 = Math.min(H, Math.ceil((Math.min(...ys) - oy) / ry));
  if (col1 - col0 < 8 || row1 - row0 < 8)
    return fail("Field boundary barely overlaps the orthomosaic — check the boundary and the flight area.");

  // effective analysis resolution: native, but not finer than targetResM,
  // and capped to maxGridDim per axis
  const metersPerUnit = epsg === 4326 ? 111_320 * Math.cos(((Math.min(...ys) + Math.max(...ys)) / 2 / 111_320) * 0) : 1;
  // NOTE: for EPSG:4326 rx is in degrees; convert approximately at field latitude
  const midLatDeg = epsg === 4326 ? (boundary.coordinates[0][0][1] + boundary.coordinates[0][2][1]) / 2 : 0;
  const nativeResM = epsg === 4326 ? Math.abs(rx) * 111_320 * Math.cos((midLatDeg * Math.PI) / 180) : Math.abs(rx) * metersPerUnit;
  const stride = Math.max(
    1,
    Math.ceil(PARAMS.targetResM / nativeResM),
    Math.ceil((col1 - col0) / PARAMS.maxGridDim),
    Math.ceil((row1 - row0) / PARAMS.maxGridDim)
  );
  const gw = Math.floor((col1 - col0) / stride);
  const gh = Math.floor((row1 - row0) / stride);
  const resM = nativeResM * stride;

  const rasters = (await img.readRasters({
    window: [col0, row0, col0 + gw * stride, row0 + gh * stride],
    width: gw,
    height: gh,
    samples: useNdvi ? [0, 1, 2, 3] : [0, 1, 2],
    interleave: false,
  })) as unknown as Array<ArrayLike<number>>;

  // field mask on the analysis grid (point-in-ring at cell centers, raster CRS)
  const mask = new Uint8Array(gw * gh);
  const inRing = (x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const x = ox + (col0 + (c + 0.5) * stride) * rx;
      const y = oy + (row0 + (r + 0.5) * stride) * ry;
      if (inRing(x, y)) mask[r * gw + c] = 1;
    }
  }

  // index per masked pixel
  const [R, G, B, N] = [rasters[0], rasters[1], rasters[2], rasters[3]];
  const idxVals: number[] = [];
  const idxArr = new Float32Array(gw * gh).fill(NaN);
  for (let i = 0; i < gw * gh; i++) {
    if (!mask[i]) continue;
    const r = Number(R[i]);
    const g = Number(G[i]);
    const b = Number(B[i]);
    const sum = r + g + b;
    if (!Number.isFinite(sum) || sum <= 0) continue;
    let v: number;
    if (useNdvi) {
      const n = Number(N![i]);
      if (!Number.isFinite(n) || n + r <= 0) continue;
      v = (n - r) / (n + r);
    } else {
      v = (2 * g - r - b) / sum; // normalized ExG, range ≈ [-1, 2]
    }
    idxArr[i] = v;
    idxVals.push(v);
  }
  if (idxVals.length < PARAMS.minFieldPixels)
    return fail(`Only ${idxVals.length} usable field pixels in the capture (need ${PARAMS.minFieldPixels}).`);

  // robust field statistics
  const sorted = [...idxVals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const absDev = idxVals.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = absDev[Math.floor(absDev.length / 2)] || 1e-6;
  const floor = useNdvi ? PARAMS.ndviVegFloor : PARAMS.exgVegFloor;
  const cut = median - PARAMS.madK * mad * 1.4826; // MAD→σ scaling

  const affectedMask = new Uint8Array(gw * gh);
  let affected = 0;
  let sevSum = 0;
  for (let i = 0; i < gw * gh; i++) {
    const v = idxArr[i];
    if (!Number.isFinite(v)) continue;
    if (v < cut && v < floor) {
      affectedMask[i] = 1;
      affected++;
      sevSum += Math.min(1, Math.max(0, (median - v) / Math.max(Math.abs(median), 0.1)));
    }
  }
  const affectedFrac = affected / idxVals.length;
  const severity = affected > 0 ? sevSum / affected : 0;
  const acresPerPx = (resM * resM) / 4046.8564224;

  // grid object for maskToMultiPolygon: needs UTM-like meters; only emit
  // geometry when the raster CRS is projected (meters). 4326 orthos get
  // stats but no vector geometry (documented limitation).
  const affectedArea =
    epsg !== 4326
      ? maskToMultiPolygon(
          { epsg, originX: ox + col0 * rx, originY: oy + row0 * ry, width: gw, height: gh, res: Math.abs(rx) * stride },
          affectedMask
        )
      : null;

  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  return {
    ok: true,
    methodologyVersion: DRONE_METHODOLOGY_VERSION,
    paramsHash: DRONE_PARAMS_HASH,
    index: useNdvi ? "ndvi" : "exg",
    resolutionM: Math.round(resM * 100) / 100,
    fieldPixels: idxVals.length,
    affectedFrac: r4(affectedFrac),
    affectedAcres: Math.round(affected * acresPerPx * 100) / 100,
    severityPct: Math.round(severity * 100),
    affectedArea,
    stats: {
      index_median: r4(median),
      index_mad: r4(mad),
      affected_cut: r4(cut),
      veg_floor: floor,
      native_res_m: Math.round(nativeResM * 1000) / 1000,
      analysis_res_m: Math.round(resM * 100) / 100,
      stride,
      epsg,
    },
    validationStatus: "unvalidated_pipeline",
    narrative:
      `Drone orthomosaic analysis (${useNdvi ? "NDVI" : "ExG"} @ ${Math.round(resM * 100) / 100} m effective): ` +
      `${Math.round(affectedFrac * 100)}% of the field sits far below the same capture's own healthy statistics ` +
      `(median ${median.toFixed(3)}, robust cut ${cut.toFixed(3)}), mean relative deficit ${Math.round(severity * 100)}%. ` +
      `Within-capture comparison: it locates and sizes the anomaly; cause attribution comes from the claim narrative, ` +
      `phone corroboration, and the satellite cross-check. Pipeline is deterministic (${DRONE_METHODOLOGY_VERSION}) ` +
      `and NOT yet validated against ground truth — confidence is reported as uncalibrated.`,
  };
}
