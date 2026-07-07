/**
 * Marketing scenario engine — Pillar 3's core, built deliberately as
 * NON-TAILORED decision support (docs/DEPENDENCIES.md §7):
 *
 *  - It reflects the farmer's own numbers back (position, breakeven, basis,
 *    storage carry, insurance floor, cash needs).
 *  - It sweeps farmer-chosen actions across a symmetric price-outcome grid.
 *  - It never forecasts prices and never emits "you should sell X" — there
 *    is no code path that ranks or recommends a scenario. Every scenario is
 *    shown against every outcome; the farmer decides.
 *
 * All math is simple enough to check by hand on purpose: trust is the product.
 */
import type { marketingPositions } from "@/db/schema";

export type Position = typeof marketingPositions.$inferSelect;

export interface DerivedPosition {
  expectedProductionBu: number;
  pricedBu: number; // sold + contracted
  unpricedBu: number;
  pctPriced: number; // 0–100
  breakevenPerBu: number | null; // cost/acre ÷ expected yield
  basisNow: number | null; // local cash − futures
  basisVsTypical: "tight" | "normal" | "wide" | null;
  bookedRevenue: number; // sold bushels × avg sold price
  floorPerBu: number | null; // insurance revenue floor
  storageOverCapacityBu: number; // stored beyond on-farm capacity
}

export function derivePosition(p: Position): DerivedPosition {
  const expected =
    p.producedBu ??
    (p.acres && p.expectedYieldBuPerAcre ? p.acres * p.expectedYieldBuPerAcre : 0);
  const sold = p.soldBu ?? 0;
  const contracted = p.contractedBu ?? 0;
  const priced = sold + contracted;
  const unpriced = Math.max(0, expected - priced);
  const breakeven =
    p.costOfProductionPerAcre && p.expectedYieldBuPerAcre
      ? p.costOfProductionPerAcre / p.expectedYieldBuPerAcre
      : null;
  const basis =
    p.currentCashPrice != null && p.currentFuturesPrice != null
      ? p.currentCashPrice - p.currentFuturesPrice
      : null;
  let basisVsTypical: DerivedPosition["basisVsTypical"] = null;
  if (basis != null && p.typicalBasisLo != null && p.typicalBasisHi != null) {
    basisVsTypical =
      basis > p.typicalBasisHi ? "tight" : basis < p.typicalBasisLo ? "wide" : "normal";
  }
  return {
    expectedProductionBu: expected,
    pricedBu: priced,
    unpricedBu: unpriced,
    pctPriced: expected > 0 ? Math.round((priced / expected) * 100) : 0,
    breakevenPerBu: breakeven,
    basisNow: basis,
    basisVsTypical,
    bookedRevenue: sold * (p.avgSoldPrice ?? 0),
    floorPerBu: p.insuranceFloorPerBu ?? null,
    storageOverCapacityBu: Math.max(0, (p.storedBu ?? 0) - (p.storageCapacityBu ?? Infinity)),
  };
}

export interface ScenarioCell {
  priceShiftPct: number; // the assumed cash price at horizon vs today
  horizonPrice: number;
  netAvgPricePerBu: number; // effective avg across ALL expected bushels
  totalNetRevenue: number; // booked + scenario proceeds − storage carry
  vsBreakeven: "above" | "below" | null;
  aboveFloor: boolean | null;
}

export interface ScenarioRow {
  label: string;
  sellNowFrac: number; // fraction of unpriced bushels sold at today's cash
  holdMonths: number; // remaining unpriced held this long, then sold
  sellNowBu: number;
  heldBu: number;
  carryCost: number; // heldBu × $/bu/mo × months
  cashRaisedNow: number; // proceeds at today's cash price
  coversCashNeed: boolean | null; // vs (cashNeedUsd − booked already counted? see note)
  cells: ScenarioCell[];
}

/**
 * Sweep: for each farmer-selectable action (sell some fraction of the
 * unpriced bushels today, hold the rest N months), show the outcome across
 * a symmetric ±20% cash-price grid. Assumptions kept visible in the UI:
 * held bushels sell at horizon price; carry = stored cost/bu/month; basis
 * held constant (a stated simplification, not a claim).
 */
export function runScenarios(p: Position): ScenarioRow[] {
  const d = derivePosition(p);
  const cash = p.currentCashPrice;
  if (!cash || d.expectedProductionBu <= 0) return [];
  const carryRate = p.storageCostPerBuMonth ?? 0;
  const grid = [-0.2, -0.1, 0, 0.1, 0.2];

  const actions: Array<{ label: string; frac: number; months: number }> = [
    { label: "Sell nothing — hold 6 months", frac: 0, months: 6 },
    { label: "Sell a quarter now, hold rest 6 months", frac: 0.25, months: 6 },
    { label: "Sell half now, hold rest 6 months", frac: 0.5, months: 6 },
    { label: "Sell half now, hold rest 3 months", frac: 0.5, months: 3 },
    { label: "Sell everything unpriced now", frac: 1, months: 0 },
  ];

  return actions.map(({ label, frac, months }) => {
    const sellNowBu = d.unpricedBu * frac;
    const heldBu = d.unpricedBu - sellNowBu;
    const carryCost = heldBu * carryRate * months;
    const cashRaisedNow = sellNowBu * cash;
    const coversCashNeed =
      p.cashNeedUsd != null ? cashRaisedNow + d.bookedRevenue >= p.cashNeedUsd : null;

    const cells = grid.map((shift) => {
      const horizonPrice = round2(cash * (1 + shift));
      const proceeds = cashRaisedNow + heldBu * horizonPrice - carryCost;
      const total = d.bookedRevenue + proceeds;
      // contracted bushels excluded from revenue (price unknown) but included
      // in the priced denominator — stated in the UI
      const denomBu = (p.soldBu ?? 0) + d.unpricedBu;
      const netAvg = denomBu > 0 ? (d.bookedRevenue + proceeds) / denomBu : 0;
      return {
        priceShiftPct: shift * 100,
        horizonPrice,
        netAvgPricePerBu: round2(netAvg),
        totalNetRevenue: Math.round(total),
        vsBreakeven:
          d.breakevenPerBu != null ? (netAvg >= d.breakevenPerBu ? "above" : "below") : null,
        aboveFloor: d.floorPerBu != null ? netAvg >= d.floorPerBu : null,
      } satisfies ScenarioCell;
    });

    return { label, sellNowFrac: frac, holdMonths: months, sellNowBu, heldBu, carryCost, cashRaisedNow, coversCashNeed, cells };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A farmer-set target is "hit" when today's numbers cross it. */
export function targetHit(
  kind: string,
  targetValue: number,
  p: Position
): boolean | null {
  if (kind === "cash_price")
    return p.currentCashPrice != null ? p.currentCashPrice >= targetValue : null;
  if (kind === "basis") {
    const d = derivePosition(p);
    return d.basisNow != null ? d.basisNow >= targetValue : null;
  }
  return null;
}
