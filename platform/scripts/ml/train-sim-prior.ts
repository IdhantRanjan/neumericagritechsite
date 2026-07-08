/**
 * B2 — train the sim-to-real damage PRIOR on physically-grounded simulated
 * spectra (src/lib/sim/damage-sim.ts). Multinomial logistic regression
 * (pure TS, deterministic), validated on a held-out simulated set AND on
 * held-out simulated SCENES (segmentation IoU). Writes weights + an honest
 * report. This model is a PRIOR: it is trained only on simulation and is
 * never allowed to drive a real claim number until real captures calibrate
 * it (registry production:false).
 *
 * Run: npx tsx scripts/ml/train-sim-prior.ts
 */
import fs from "node:fs";
import { generateDataset, generateScene, CLASSES, type DamageClass } from "../../src/lib/sim/damage-sim";
import { SIM_VERSION, SIM_PARAMS_HASH } from "../../src/lib/sim/damage-sim";

const FEATURES = ["ndvi", "ndre", "exg", "gcc", "brightness"] as const;

function featVec(f: Record<string, number>): number[] {
  return [1, ...FEATURES.map((k) => f[k])]; // bias + features
}

// standardize features (fit on train)
function fitScaler(rows: number[][]) {
  const d = rows[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j];
  for (let j = 0; j < d; j++) mean[j] /= rows.length;
  for (const r of rows) for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / rows.length) || 1;
  mean[0] = 0; std[0] = 1; // keep bias
  return { mean, std };
}
const applyScaler = (r: number[], s: { mean: number[]; std: number[] }) =>
  r.map((v, j) => (v - s.mean[j]) / s.std[j]);

function softmax(z: number[]) {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
}

function train(X: number[][], y: number[], nClasses: number, epochs = 300, lr = 0.5, l2 = 1e-4) {
  const d = X[0].length;
  const W = Array.from({ length: nClasses }, () => new Array(d).fill(0));
  for (let ep = 0; ep < epochs; ep++) {
    const grad = Array.from({ length: nClasses }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const z = W.map((w) => w.reduce((a, wj, j) => a + wj * X[i][j], 0));
      const p = softmax(z);
      for (let k = 0; k < nClasses; k++) {
        const err = p[k] - (y[i] === k ? 1 : 0);
        for (let j = 0; j < d; j++) grad[k][j] += err * X[i][j];
      }
    }
    for (let k = 0; k < nClasses; k++)
      for (let j = 0; j < d; j++)
        W[k][j] -= lr * (grad[k][j] / X.length + l2 * W[k][j]);
  }
  return W;
}

const predict = (W: number[][], x: number[]) => {
  const p = softmax(W.map((w) => w.reduce((a, wj, j) => a + wj * x[j], 0)));
  let best = 0;
  for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
  return { cls: best, conf: p[best], probs: p };
};

function main() {
  const nC = CLASSES.length;
  const clsIdx = (c: DamageClass) => CLASSES.indexOf(c);

  // ---- pixel dataset: train / validation (disjoint seeds) ----
  const train_ds = generateDataset(8000, 42);
  const val_ds = generateDataset(3000, 99);
  const Xtr_raw = train_ds.map((s) => featVec(s.features));
  const scaler = fitScaler(Xtr_raw);
  const Xtr = Xtr_raw.map((r) => applyScaler(r, scaler));
  const ytr = train_ds.map((s) => clsIdx(s.cls));
  const W = train(Xtr, ytr, nC);

  // pixel validation confusion matrix
  const conf = Array.from({ length: nC }, () => new Array(nC).fill(0));
  let correct = 0;
  for (const s of val_ds) {
    const x = applyScaler(featVec(s.features), scaler);
    const { cls } = predict(W, x);
    conf[clsIdx(s.cls)][cls]++;
    if (cls === clsIdx(s.cls)) correct++;
  }
  const pixelAcc = correct / val_ds.length;
  // binary damaged(=damaged|destroyed) vs not: precision/recall
  const dmgIdx = new Set([clsIdx("damaged"), clsIdx("destroyed")]);
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let a = 0; a < nC; a++) for (let b = 0; b < nC; b++) {
    const av = dmgIdx.has(a), bv = dmgIdx.has(b), n = conf[a][b];
    if (av && bv) tp += n; else if (!av && bv) fp += n; else if (av && !bv) fn += n; else tn += n;
  }
  const precision = tp / (tp + fp || 1), recall = tp / (tp + fn || 1);

  // ---- scene segmentation: held-out scenes, IoU + affected-fraction error ----
  const sceneReports: { seed: number; damage: string; iou: number; fracErr: number }[] = [];
  let iouSum = 0, fracErrSum = 0, nScene = 0;
  for (const damage of ["damaged", "destroyed", "stressed"] as DamageClass[]) {
    for (let k = 0; k < 8; k++) {
      const sc = generateScene({ size: 48, damage, affected: 0.25 + 0.4 * (k / 8), seed: 1000 + k + damage.length });
      let inter = 0, uni = 0, predAff = 0;
      for (let i = 0; i < sc.features.length; i++) {
        const { cls } = predict(W, applyScaler(featVec(sc.features[i]), scaler));
        const predDmg = dmgIdx.has(cls) ? 1 : 0;
        const truth = sc.truthMask[i];
        if (predDmg && truth) inter++;
        if (predDmg || truth) uni++;
        predAff += predDmg;
      }
      const iou = uni ? inter / uni : 1;
      const fracErr = Math.abs(predAff / sc.features.length - sc.affectedFrac);
      sceneReports.push({ seed: sc.seed, damage, iou: +iou.toFixed(3), fracErr: +fracErr.toFixed(3) });
      iouSum += iou; fracErrSum += fracErr; nScene++;
    }
  }

  const weights = {
    model: "sim-damage-mlr",
    version: "0.1.0",
    simVersion: SIM_VERSION,
    simParamsHash: SIM_PARAMS_HASH,
    trainedOn: "SIMULATION ONLY — physically-grounded synthetic spectra. NOT validated on real fields.",
    production: false,
    classes: CLASSES,
    features: FEATURES,
    scaler,
    W,
  };
  fs.mkdirSync("scripts/ml/out", { recursive: true });
  fs.writeFileSync("scripts/ml/out/sim-prior-weights.json", JSON.stringify(weights));

  const report = {
    ranAt: new Date().toISOString(),
    simVersion: SIM_VERSION,
    simParamsHash: SIM_PARAMS_HASH,
    trainN: train_ds.length, valN: val_ds.length,
    pixelAccuracy: +pixelAcc.toFixed(3),
    binaryDamage: { precision: +precision.toFixed(3), recall: +recall.toFixed(3) },
    confusionMatrix: { classes: CLASSES, matrix: conf },
    segmentation: {
      meanIoU: +(iouSum / nScene).toFixed(3),
      meanAffectedFracError: +(fracErrSum / nScene).toFixed(3),
      scenes: sceneReports,
    },
    honestCaveats: [
      "Trained and validated on SIMULATION ONLY. Real-field performance is unknown and expected to be worse (sim-to-real gap).",
      "Classes deliberately overlap (real canopies do), so <100% accuracy is by design and honest.",
      "Largest sim-to-real gap expected: mixed pixels, atmospheric effects, soil/residue diversity, and crop-stage variation not modeled here.",
      "This prior is registered production:false and must never drive a real claim/trigger number until calibrated on real captures (docs/CAPTURE-PROTOCOL.md).",
    ],
  };
  fs.writeFileSync("scripts/ml/out/sim-prior-report.json", JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

main();
