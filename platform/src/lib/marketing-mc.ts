/**
 * Monte Carlo marketing engine (Hard Core 4) — non-directive by construction.
 *
 * What it does: for each farmer-selectable selling schedule, simulate the
 * joint evolution of futures price and local basis across the marketing
 * window and report the full DISTRIBUTION of net revenue (P10/P50/P90),
 * with and without the crop-insurance floor, plus cash-need coverage odds.
 *
 * What it deliberately does NOT do (CTA exemption, docs/DEPENDENCIES.md §7):
 * no strategy ranking, no "optimal" flag, no recommendation, no drift in the
 * price process. Futures follow a ZERO-DRIFT geometric Brownian motion —
 * i.e. the engine's explicit stance is "we do not know where price goes."
 * Volatility widens the cone; it never tilts it.
 *
 * Model (parameters shown in the UI, documented in docs/ENGINES.md §4):
 *   Futures  F_t : GBM, μ = 0, σ = user-adjustable annualized vol
 *   Basis    B_t : Ornstein-Uhlenbeck mean-reverting to the midpoint of the
 *                  farm's own typical basis range; σ_B from the range width
 *                  ((hi − lo)/4 ≈ 1σ); calibrated to nothing external —
 *                  the farmer's stated range IS the calibration, honestly.
 *   Cash     C_t = F_t + B_t
 *   Floor: revenue-protection payoff ≈ max(0, floor$/bu − F_h) × expected bu
 *          (simplified RP: indemnity keyed to harvest-month futures; the
 *          real product uses a monthly average and APH yields — stated.)
 *
 * Determinism: seeded PRNG derived from the position's own numbers — same
 * inputs ⇒ identical distributions, byte for byte, run anywhere.
 */
import { createHash } from "node:crypto";
import type { Position } from "@/lib/marketing";
import { derivePosition } from "@/lib/marketing";

export interface McParams {
  annualVol: number; // futures annualized volatility, e.g. 0.24
  basisKappa: number; // OU mean-reversion rate (per year)
  paths: number;
  horizonMonths: number;
  harvestMonth: number; // months from now when the insurance floor settles
}

export const DEFAULT_MC: McParams = {
  annualVol: 0.24,
  basisKappa: 1.5,
  paths: 4000,
  horizonMonths: 9,
  harvestMonth: 3,
};

export interface StrategySpec {
  label: string;
  /** fraction of currently-unpriced bushels sold at each month offset */
  schedule: Array<{ month: number; frac: number }>;
}

export const STRATEGIES: StrategySpec[] = [
  { label: "Sell everything unpriced now", schedule: [{ month: 0, frac: 1 }] },
  { label: "Half now, half in 6 months", schedule: [{ month: 0, frac: 0.5 }, { month: 6, frac: 0.5 }] },
  { label: "Thirds: now / 3 mo / 6 mo", schedule: [{ month: 0, frac: 1 / 3 }, { month: 3, frac: 1 / 3 }, { month: 6, frac: 1 / 3 }] },
  { label: "Quarter now, rest in 9 months", schedule: [{ month: 0, frac: 0.25 }, { month: 9, frac: 0.75 }] },
  { label: "Hold everything 6 months", schedule: [{ month: 6, frac: 1 }] },
  { label: "Hold everything 9 months", schedule: [{ month: 9, frac: 1 }] },
];

export interface StrategyDistribution {
  label: string;
  schedule: Array<{ month: number; frac: number }>;
  // net revenue across all expected production (booked + simulated sales − carry)
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  // with the insurance floor payoff folded in
  floorP10: number;
  floorP50: number;
  floorP90: number;
  probBelowBreakeven: number | null; // P(total revenue < cost of production), null if no breakeven known
  probCashNeedMet: number | null; // P(cumulative proceeds by need date ≥ need)
  avgPriceP50: number; // median realized $/bu across sold + unpriced
  carryCostP50: number;
}

export interface McResult {
  ok: boolean;
  reason?: string;
  params: McParams & { basisMean: number; basisSigma: number; seed: number };
  strategies: StrategyDistribution[];
  floorNote: string;
}

/** mulberry32 — tiny deterministic PRNG */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller from two uniforms */
function gauss(u: () => number): number {
  let a = 0;
  while (a === 0) a = u();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
}

function seedFromPosition(p: Position, params: McParams): number {
  const s = JSON.stringify([
    p.currentFuturesPrice, p.currentCashPrice, p.typicalBasisLo, p.typicalBasisHi,
    p.soldBu, p.contractedBu, p.avgSoldPrice, p.producedBu, p.acres, p.expectedYieldBuPerAcre,
    p.storageCostPerBuMonth, p.insuranceFloorPerBu, p.cashNeedUsd, params,
  ]);
  return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);
}

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

export function runMonteCarlo(p: Position, overrides: Partial<McParams> = {}): McResult {
  const params = { ...DEFAULT_MC, ...overrides };
  const d = derivePosition(p);
  const F0 = p.currentFuturesPrice;
  const C0 = p.currentCashPrice;
  if (!F0 || !C0)
    return {
      ok: false,
      reason: "Enter current cash and futures prices to run outcome distributions.",
      params: { ...params, basisMean: 0, basisSigma: 0, seed: 0 },
      strategies: [],
      floorNote: "",
    };
  if (d.unpricedBu <= 0)
    return {
      ok: false,
      reason: "No unpriced bushels — the distribution engine models decisions about what's still unsold.",
      params: { ...params, basisMean: 0, basisSigma: 0, seed: 0 },
      strategies: [],
      floorNote: "",
    };

  const B0 = C0 - F0;
  const basisMean =
    p.typicalBasisLo != null && p.typicalBasisHi != null
      ? (p.typicalBasisLo + p.typicalBasisHi) / 2
      : B0;
  const basisSigma =
    p.typicalBasisLo != null && p.typicalBasisHi != null
      ? Math.max(0.02, (p.typicalBasisHi - p.typicalBasisLo) / 4)
      : 0.06;

  const dt = 1 / 12;
  const sigM = params.annualVol * Math.sqrt(dt);
  const kappaM = params.basisKappa * dt;
  const carry = p.storageCostPerBuMonth ?? 0;
  const seed = seedFromPosition(p, params);

  const breakevenRevenue =
    p.costOfProductionPerAcre != null && p.acres != null ? p.costOfProductionPerAcre * p.acres : null;
  const needMonth = p.cashNeedByDate
    ? Math.max(0, Math.min(params.horizonMonths, Math.round((new Date(p.cashNeedByDate).getTime() - Date.now()) / (30.44 * 86400000))))
    : null;

  // Pre-generate shared paths so every strategy sees the SAME price worlds —
  // differences between rows are then purely the schedule, not sampling noise.
  const u = rng(seed);
  const months = params.horizonMonths + 1;
  const futures = new Float64Array(params.paths * months);
  const basis = new Float64Array(params.paths * months);
  for (let k = 0; k < params.paths; k++) {
    let F = F0;
    let B = B0;
    futures[k * months] = F;
    basis[k * months] = B;
    for (let m = 1; m < months; m++) {
      F = F * Math.exp(-0.5 * sigM * sigM + sigM * gauss(u)); // zero drift
      B = B + kappaM * (basisMean - B) + basisSigma * Math.sqrt(kappaM * 2) * gauss(u);
      futures[k * months + m] = F;
      basis[k * months + m] = B;
    }
  }

  const floorBu = d.expectedProductionBu;
  const strategies: StrategyDistribution[] = STRATEGIES.map((spec) => {
    const schedule = spec.schedule.filter((s) => s.month <= params.horizonMonths);
    const net: number[] = new Array(params.paths);
    const netFloor: number[] = new Array(params.paths);
    const avgPrice: number[] = new Array(params.paths);
    const carryCosts: number[] = new Array(params.paths);
    let cashMet = 0,
      belowBreakeven = 0;

    for (let k = 0; k < params.paths; k++) {
      let proceeds = 0;
      let carryCost = 0;
      let cashByNeed = d.bookedRevenue;
      let remaining = d.unpricedBu;
      for (const { month, frac } of schedule) {
        const bu = d.unpricedBu * frac;
        const cash = futures[k * months + month] + basis[k * months + month];
        proceeds += bu * Math.max(0, cash);
        carryCost += bu * carry * month; // stored until its sale month
        remaining -= bu;
        if (needMonth != null && month <= needMonth) cashByNeed += bu * Math.max(0, cash);
      }
      // any residual (rounding) sells at horizon
      if (remaining > 1) {
        const cash = futures[k * months + params.horizonMonths] + basis[k * months + params.horizonMonths];
        proceeds += remaining * Math.max(0, cash);
        carryCost += remaining * carry * params.horizonMonths;
      }
      const revenue = d.bookedRevenue + proceeds - carryCost;
      // insurance floor as an embedded put on harvest-month futures
      const floorPay =
        p.insuranceFloorPerBu != null
          ? Math.max(0, (p.insuranceFloorPerBu - futures[k * months + Math.min(params.harvestMonth, params.horizonMonths)]) * floorBu)
          : 0;
      net[k] = revenue;
      netFloor[k] = revenue + floorPay;
      const denomBu = (p.soldBu ?? 0) + d.unpricedBu;
      avgPrice[k] = denomBu > 0 ? revenue / denomBu : 0;
      carryCosts[k] = carryCost;
      if (breakevenRevenue != null && netFloor[k] < breakevenRevenue) belowBreakeven++;
      if (needMonth != null && p.cashNeedUsd != null && cashByNeed >= p.cashNeedUsd) cashMet++;
    }

    net.sort((a, b) => a - b);
    netFloor.sort((a, b) => a - b);
    avgPrice.sort((a, b) => a - b);
    carryCosts.sort((a, b) => a - b);
    const r0 = (x: number) => Math.round(x);
    return {
      label: spec.label,
      schedule,
      p10: r0(pct(net, 0.1)),
      p50: r0(pct(net, 0.5)),
      p90: r0(pct(net, 0.9)),
      mean: r0(net.reduce((a, b) => a + b, 0) / net.length),
      floorP10: r0(pct(netFloor, 0.1)),
      floorP50: r0(pct(netFloor, 0.5)),
      floorP90: r0(pct(netFloor, 0.9)),
      probBelowBreakeven: breakevenRevenue != null ? Math.round((belowBreakeven / params.paths) * 100) / 100 : null,
      probCashNeedMet: needMonth != null && p.cashNeedUsd != null ? Math.round((cashMet / params.paths) * 100) / 100 : null,
      avgPriceP50: Math.round(pct(avgPrice, 0.5) * 100) / 100,
      carryCostP50: r0(pct(carryCosts, 0.5)),
    };
  });

  return {
    ok: true,
    params: { ...params, basisMean: Math.round(basisMean * 100) / 100, basisSigma: Math.round(basisSigma * 100) / 100, seed },
    strategies,
    floorNote:
      p.insuranceFloorPerBu != null
        ? `Floor modeled as a simplified revenue-protection payoff: max(0, $${p.insuranceFloorPerBu.toFixed(2)} − harvest-month futures) × ${Math.round(floorBu).toLocaleString()} bu. Real RP indemnities use monthly-average futures and APH yields — confirm specifics with your agent.`
        : "No insurance floor entered — the with-floor columns equal the without-floor columns.",
  };
}
