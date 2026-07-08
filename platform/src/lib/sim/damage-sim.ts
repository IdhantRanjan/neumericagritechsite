/**
 * Physically-grounded crop-damage simulator (`damage-sim@1.0.0`).
 *
 * Generates spectrally-plausible per-pixel samples and full scene grids for
 * healthy and damaged corn/soy canopy, each with a KNOWN damage class and
 * severity. This is the training substrate for the sim-to-real prior (B2) —
 * there is no real labeled damage data, so we train on physics-grounded
 * simulation and label the resulting model unmistakably as a prior awaiting
 * real-capture calibration (docs/ENGINES.md §B2).
 *
 * Grounding (documented ranges, not arbitrary noise):
 *  - Healthy full corn canopy: NDVI ~0.80±0.06, high NIR, low red, moderate
 *    green dominance (ExG > 0). NDRE ~0.35.
 *  - Drought senescence: chlorophyll loss raises red, lowers NIR → NDVI
 *    slides to ~0.45±0.10, NDRE drops first (red-edge sensitive).
 *  - Hail/wind defoliation: canopy gaps mix soil into the pixel → NDVI
 *    ~0.35±0.10, brightness rises, ExG falls toward soil.
 *  - Flood inundation: standing water is very low NIR, low NDVI (~0.10±0.08),
 *    dark. Disease: patchy chlorosis between drought and defoliation.
 * Classes deliberately OVERLAP (real canopies do) so a classifier cannot be
 * perfect — that overlap is the point, and the honest ceiling.
 *
 * Deterministic: seeded PRNG; same seed ⇒ same samples.
 */
import { createHash } from "node:crypto";

export const SIM_VERSION = "damage-sim@1.0.0";

export type DamageClass = "healthy" | "stressed" | "damaged" | "destroyed";
export const CLASSES: DamageClass[] = ["healthy", "stressed", "damaged", "destroyed"];

// Per-class reflectance archetypes in [red, green, blue, nir, rededge],
// reflectance 0..1, with per-band standard deviations. Grounded in the
// ranges above; rededge lets us derive NDRE, nir/red give NDVI.
interface Archetype {
  mean: [number, number, number, number, number];
  std: [number, number, number, number, number];
}
const ARCHETYPES: Record<DamageClass, Archetype> = {
  // healthy corn: low red, high nir
  healthy: { mean: [0.05, 0.09, 0.04, 0.46, 0.20], std: [0.015, 0.02, 0.012, 0.05, 0.03] },
  // stressed/drought senescence: red up, nir down, red-edge collapses
  stressed: { mean: [0.11, 0.13, 0.08, 0.33, 0.20], std: [0.03, 0.03, 0.02, 0.06, 0.04] },
  // damaged/defoliation: soil mixing, brightness up
  damaged: { mean: [0.18, 0.18, 0.14, 0.27, 0.24], std: [0.04, 0.04, 0.035, 0.06, 0.05] },
  // destroyed/flood or total loss: very low nir (water) OR bright bare soil
  destroyed: { mean: [0.20, 0.17, 0.16, 0.16, 0.19], std: [0.06, 0.05, 0.05, 0.07, 0.06] },
};

export interface PixelSample {
  features: Record<string, number>; // ndvi, ndre, exg, brightness, gcc
  cls: DamageClass;
  severity: number; // 0..1
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(u: () => number) {
  let x = 0;
  while (x === 0) x = u();
  return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * u());
}

/** Spectral bands → the indices the real pipeline uses. */
export function indicesFromBands(r: number, g: number, b: number, nir: number, re: number) {
  const ndvi = (nir - r) / (nir + r + 1e-6);
  const ndre = (nir - re) / (nir + re + 1e-6);
  const sum = r + g + b + 1e-6;
  const exg = (2 * g - r - b) / sum;
  const gcc = g / sum;
  const brightness = (r + g + b) / 3;
  return {
    ndvi: Math.round(ndvi * 1e4) / 1e4,
    ndre: Math.round(ndre * 1e4) / 1e4,
    exg: Math.round(exg * 1e4) / 1e4,
    gcc: Math.round(gcc * 1e4) / 1e4,
    brightness: Math.round(brightness * 1e4) / 1e4,
  };
}

export function samplePixel(cls: DamageClass, u: () => number): PixelSample {
  const a = ARCHETYPES[cls];
  const band = a.mean.map((m, i) => Math.max(0, Math.min(1, m + a.std[i] * gauss(u)))) as [
    number, number, number, number, number
  ];
  const features = indicesFromBands(band[0], band[1], band[2], band[3], band[4]);
  // severity: monotone with class, jittered; healthy≈0
  const base = { healthy: 0.02, stressed: 0.35, damaged: 0.6, destroyed: 0.9 }[cls];
  const severity = Math.max(0, Math.min(1, base + 0.12 * gauss(u)));
  return { features, cls, severity };
}

/** A balanced labeled dataset for training the prior. */
export function generateDataset(n: number, seed = 42): PixelSample[] {
  const u = mulberry32(seed);
  const out: PixelSample[] = [];
  for (let i = 0; i < n; i++) {
    const cls = CLASSES[Math.floor(u() * CLASSES.length)];
    out.push(samplePixel(cls, u));
  }
  return out;
}

/**
 * A full scene: a grid of pixels over a field, with a spatially-coherent
 * damage patch (Gaussian blob) so the ground-truth mask is realistic, not
 * salt-and-pepper. Returns the per-pixel feature grid + the truth mask +
 * true affected fraction — the target the segmentation prior is scored on.
 */
export interface SimScene {
  width: number;
  height: number;
  features: Record<string, number>[]; // row-major
  truthClass: DamageClass[]; // per pixel
  truthMask: Uint8Array; // 1 = damaged/destroyed
  affectedFrac: number;
  dominantDamage: DamageClass;
  seed: number;
}

export function generateScene(opts: { size?: number; damage?: DamageClass; affected?: number; seed?: number } = {}): SimScene {
  const size = opts.size ?? 48;
  const damage = opts.damage ?? "damaged";
  const targetFrac = opts.affected ?? 0.4;
  const seed = opts.seed ?? 7;
  const u = mulberry32(seed);
  // blob center + radius to hit ~targetFrac of the field
  const cx = size * (0.3 + 0.4 * u());
  const cy = size * (0.3 + 0.4 * u());
  const radius = Math.sqrt((targetFrac * size * size) / Math.PI) * (0.9 + 0.2 * u());

  const features: Record<string, number>[] = [];
  const truthClass: DamageClass[] = [];
  const truthMask = new Uint8Array(size * size);
  let affected = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const d = Math.hypot(c - cx, r - cy);
      // soft edge: probability of being in the damaged blob
      const p = 1 / (1 + Math.exp((d - radius) / 1.5));
      const inBlob = u() < p;
      const cls: DamageClass = inBlob ? damage : "healthy";
      const s = samplePixel(cls, u);
      features.push(s.features);
      truthClass.push(cls);
      const dmg = cls === "damaged" || cls === "destroyed" ? 1 : 0;
      truthMask[r * size + c] = dmg;
      affected += dmg;
    }
  }
  return {
    width: size,
    height: size,
    features,
    truthClass,
    truthMask,
    affectedFrac: affected / (size * size),
    dominantDamage: damage,
    seed,
  };
}

export const SIM_PARAMS_HASH = createHash("sha256")
  .update(JSON.stringify({ SIM_VERSION, ARCHETYPES }))
  .digest("hex");
