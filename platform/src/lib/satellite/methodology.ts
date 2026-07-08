/**
 * The locked analysis methodology. Every number this pipeline emits is
 * stamped with METHODOLOGY_VERSION and PARAMS_HASH; identical inputs under
 * the same version produce identical outputs. Changing ANY parameter
 * requires a version bump — never edit params in place.
 *
 * Method summary (full write-up: docs/ENGINES.md §1):
 *  - Sentinel-2 L2A surface reflectance via Element84 Earth Search STAC
 *    (open AWS bucket, no key). Scenes cloud-masked per-pixel with the SCL
 *    band; observations below MIN_CLEAR_FRAC clear pixels over the field
 *    are stored but excluded from baselines and detection.
 *  - Damage = statistically significant negative NDVI deviation vs BOTH the
 *    field's own same-DOY multi-year expectation (temporal baseline) AND the
 *    surrounding region's contemporaneous change (spatial baseline).
 */
import { createHash } from "node:crypto";

export const METHODOLOGY_VERSION = "s2-l2a-cd@1.0.0";

export const PARAMS = {
  stac: {
    endpoint: "https://earth-search.aws.element84.com/v1",
    collection: "sentinel-2-l2a",
    maxSceneCloudCover: 80, // % — scenes above this are not even fetched
  },
  masking: {
    // SCL classes treated as clear ground: vegetation, not-vegetated,
    // water (kept & tracked separately — flooding IS signal), unclassified
    clearClasses: [4, 5, 6, 7],
    waterClass: 6,
    minClearFrac: 0.6, // observation below this is flagged low-quality
  },
  grid: {
    resolutionM: 10, // analysis grid; snapped to the S2 UTM 10 m grid
    regionRingM: 1500, // spatial-baseline ring width around the field bbox
    regionSampleM: 40, // region read resolution (COG overview resample)
  },
  detection: {
    postEventWindowDays: 30,
    preEventWindowDays: 45,
    baselineYears: 3,
    baselineDoyWindow: 15, // ± days around event DOY for the temporal baseline
    minBaselineObs: 3,
    // a pixel is "affected" when its NDVI drop exceeds both floors:
    minAbsoluteDrop: 0.12, // beyond this absolute NDVI decline pre→post
    regionalMargin: 0.1, // and beyond the regional median change by this much
    fieldZSignificant: -1.5, // field-mean z-score vs temporal baseline
    minPreNdviForSeverity: 0.35, // severity denominator floor
  },
  indices: ["ndvi", "evi", "ndre", "exg"] as const,
} as const;

function canonical(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(",")}]`;
  const entries = Object.entries(obj as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(",")}}`;
}

export const canonicalJson = canonical;

export const PARAMS_HASH = createHash("sha256")
  .update(canonical({ version: METHODOLOGY_VERSION, params: PARAMS }))
  .digest("hex");

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
