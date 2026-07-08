/**
 * Sim-to-real damage PRIOR (B2) — loader + inference for the model trained by
 * scripts/ml/train-sim-prior.ts on physically-grounded simulated spectra.
 *
 * HARD CONSTRAINT: this is a SIMULATION-TRAINED PRIOR, not validated on real
 * fields. It is registered `production: false` and must NEVER drive a real
 * claim/trigger/displayed damage number until real captures calibrate it
 * (docs/CAPTURE-PROTOCOL.md, docs/ENGINES.md §B2). Its role today is to (a)
 * prove the pluggable interface end-to-end and (b) be the thing the Track B
 * captures fine-tune. `finetuneHook()` documents exactly how real labels
 * update it.
 */
import fs from "node:fs";
import path from "node:path";
import { indicesFromBands, type DamageClass } from "@/lib/sim/damage-sim";

interface Weights {
  model: string;
  version: string;
  simVersion: string;
  production: false;
  classes: DamageClass[];
  features: string[];
  scaler: { mean: number[]; std: number[] };
  W: number[][];
}

let cached: Weights | null | undefined;

function load(): Weights | null {
  if (cached !== undefined) return cached;
  try {
    const p = path.join(process.cwd(), "scripts/ml/out/sim-prior-weights.json");
    cached = JSON.parse(fs.readFileSync(p, "utf8")) as Weights;
  } catch {
    cached = null; // not trained in this environment — inference simply unavailable
  }
  return cached;
}

function softmax(z: number[]) {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

export interface PixelPrediction {
  cls: DamageClass;
  confidence: number; // model probability — SIM-space, NOT calibrated to reality
  probs: Record<string, number>;
  calibrated: false;
}

/** Classify one pixel from its indices. Returns null if the prior isn't loaded. */
export function classifyPixel(features: Record<string, number>): PixelPrediction | null {
  const w = load();
  if (!w) return null;
  const x = [1, ...w.features.map((k) => features[k] ?? 0)].map(
    (v, j) => (v - w.scaler.mean[j]) / w.scaler.std[j]
  );
  const probs = softmax(w.W.map((row) => row.reduce((a, wj, j) => a + wj * x[j], 0)));
  let best = 0;
  for (let k = 1; k < probs.length; k++) if (probs[k] > probs[best]) best = k;
  return {
    cls: w.classes[best],
    confidence: Math.round(probs[best] * 1000) / 1000,
    probs: Object.fromEntries(w.classes.map((c, i) => [c, Math.round(probs[i] * 1000) / 1000])),
    calibrated: false,
  };
}

/** Convenience: classify from raw bands (RGB[+NIR/RE]) the way a drone ortho provides. */
export function classifyBands(r: number, g: number, b: number, nir?: number, re?: number) {
  return classifyPixel(indicesFromBands(r, g, b, nir ?? (g + r) / 2, re ?? nir ?? (g + r) / 2));
}

export function simPriorAvailable(): boolean {
  return load() != null;
}

export function simPriorMeta() {
  const w = load();
  return {
    name: "sim-damage-mlr",
    version: w?.version ?? "0.1.0",
    kind: "learned-sim-prior" as const,
    production: false as const,
    description:
      "Multinomial logistic damage classifier trained on physically-grounded SIMULATED spectra (damage-sim@1.0.0). Sim-to-real prior, NOT validated on real fields — never drives real claim numbers. Awaits Track B calibration.",
  };
}

/**
 * Fine-tuning hook (documented, not yet active). When ≥150 calibration-grade
 * labeled captures exist (docs/CAPTURE-PROTOCOL.md §6), real (features →
 * outcome) pairs from the training export are used to (1) continue training
 * from these sim weights as the initialization, and (2) fit a conformal
 * calibrator on held-out real examples so `confidence` becomes a real
 * coverage guarantee. Until that validation passes, this prior stays
 * production:false and the fusion engine's abstention rules remain in force.
 */
export function finetuneHook() {
  return {
    ready: false,
    initFromSimWeights: true,
    requires: "≥150 calibration-grade labeled captures per damage type (docs/CAPTURE-PROTOCOL.md §6)",
    validation: "leave-one-event-out on real captures + conformal calibration before production:true",
  };
}
