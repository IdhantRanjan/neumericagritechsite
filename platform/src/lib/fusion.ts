/**
 * Sensor-fusion + honest-uncertainty engine (`fusion@1.0.0`).
 *
 * Fuses the three tiers into ONE decision about a claim event, with a bias
 * the audit demands: **prefer abstention over false confidence.** The
 * backtest (docs/ENGINES.md §3c) and the label-permutation control
 * (docs/AUDIT.md §A2) both show the raw satellite gate cannot, on its own,
 * separate patch-scale damage from healthy at a statistically meaningful
 * level, and that its heuristic confidence is anti-calibrated. So this engine
 * NEVER emits a calibrated damage confidence from satellite alone; it routes,
 * screens, corroborates, and — when it cannot honestly answer — abstains and
 * says exactly why.
 *
 * Deterministic and versioned: same inputs ⇒ same fused state + reasons.
 * There is no learned/calibrated component yet; `calibrationState()` reports
 * how far the label flywheel (docs/ENGINES.md §2) is from the threshold at
 * which a conformal calibrator can replace the fixed abstention rules.
 */
import { createHash } from "node:crypto";
import type { DamageAssessment } from "@/lib/satellite/damage";
import type { DroneAssessment } from "@/lib/drone/analyze";
import type { WeatherCounterpart } from "@/lib/parametric";
import { routeSensors } from "@/lib/sensors/routing";

export const FUSION_VERSION = "fusion@1.0.0";

const PARAMS = {
  // labels needed before a learned calibrator may replace these fixed rules
  calibrationLabelThreshold: 150,
  // satellite drought screening: require weather corroboration to call a
  // fired screen "corroborated" (pre-registered cutoff, §3c lever)
  weatherCorroborationMaxRatio: 0.6,
  // drone stays uncalibrated → we surface its measurement but never a
  // calibrated confidence until real captures validate it
  droneCalibrated: false,
} as const;

export const FUSION_PARAMS_HASH = createHash("sha256")
  .update(JSON.stringify({ FUSION_VERSION, PARAMS }))
  .digest("hex");

export type FusionState =
  | "abstain" // cannot honestly answer — the default when in doubt
  | "screening_only" // satellite screened; not claim-grade on its own
  | "screening_corroborated" // satellite + weather agree (drought path)
  | "field_measured_uncalibrated"; // drone measured it; magnitude real, confidence not yet calibrated

export interface TierInput {
  routedPrimary: "satellite" | "drone" | "phone";
  damageType: string;
  satellite?: DamageAssessment | { ok: false; reason: string };
  drone?: DroneAssessment;
  weather?: WeatherCounterpart;
  phoneCorroboration?: boolean; // a geotagged ground photo exists
}

export interface FusionResult {
  version: string;
  paramsHash: string;
  state: FusionState;
  /** the damage magnitude we are willing to stand behind, or null when abstaining */
  reportedSeverityPct: number | null;
  reportedAffectedAcres: number | null;
  /** deliberately null unless a calibrated tier produced it (none exist yet) */
  calibratedConfidence: number | null;
  abstained: boolean;
  reasons: string[];
  perTier: {
    satellite: "fired" | "quiet" | "unavailable" | "not-used";
    drone: "measured" | "unavailable" | "not-used";
    weather: "corroborates" | "contradicts" | "unavailable" | "not-used";
    phone: "corroborates" | "absent";
  };
}

function abstain(reasons: string[], perTier: FusionResult["perTier"]): FusionResult {
  return {
    version: FUSION_VERSION,
    paramsHash: FUSION_PARAMS_HASH,
    state: "abstain",
    reportedSeverityPct: null,
    reportedAffectedAcres: null,
    calibratedConfidence: null,
    abstained: true,
    reasons,
    perTier,
  };
}

export function fuse(input: TierInput): FusionResult {
  const sat = input.satellite;
  const satOk = sat && sat.ok;
  const satFired = satOk && (sat as DamageAssessment).significant;
  const weatherCorroborates =
    input.weather?.ok && input.weather.ratioToNormal != null
      ? input.weather.ratioToNormal < PARAMS.weatherCorroborationMaxRatio
      : null;

  const perTier: FusionResult["perTier"] = {
    satellite: !sat ? "not-used" : !sat.ok ? "unavailable" : satFired ? "fired" : "quiet",
    drone: input.drone ? (input.drone.ok ? "measured" : "unavailable") : "not-used",
    weather:
      input.weather == null
        ? "not-used"
        : !input.weather.ok
        ? "unavailable"
        : weatherCorroborates
        ? "corroborates"
        : "contradicts",
    phone: input.phoneCorroboration ? "corroborates" : "absent",
  };

  const reasons: string[] = [];

  // 1. Drone available → it is the only tier that can quantify patch-scale
  //    damage. Report its magnitude, but NEVER a calibrated confidence
  //    (uncalibrated pipeline). If satellite also ran and flatly contradicts
  //    (it says clearly healthy where drone says heavily damaged, or vice
  //    versa), abstain and flag the disagreement for human review.
  if (input.drone?.ok) {
    const droneHeavy = input.drone.affectedFrac >= 0.15;
    if (satOk && !satFired && droneHeavy && (sat as DamageAssessment).confidence >= 0.8 && (sat as DamageAssessment).extent === "region-wide") {
      reasons.push(
        "Tier disagreement: the drone capture shows substantial localized damage while satellite reads the wider area as unchanged. Localized damage below 10 m resolution is the expected reason — but the disagreement is flagged for human review before any number is relied on."
      );
    }
    reasons.push(
      `Drone orthomosaic quantified ${Math.round(input.drone.affectedFrac * 100)}% of the field affected at ${input.drone.resolutionM} m effective resolution. Magnitude is real and reproducible; confidence is NOT yet calibrated (no validated drone captures exist — docs/ENGINES.md §0), so no probability is attached.`
    );
    return {
      version: FUSION_VERSION,
      paramsHash: FUSION_PARAMS_HASH,
      state: "field_measured_uncalibrated",
      reportedSeverityPct: input.drone.severityPct,
      reportedAffectedAcres: input.drone.affectedAcres,
      calibratedConfidence: null, // by design until calibration
      abstained: false,
      reasons,
      perTier,
    };
  }

  // 2. No drone. If the event routed to drone (hail/flood/wind/disease —
  //    sub-pixel or fast-decaying), satellite cannot carry a claim-grade
  //    number. Abstain and escalate.
  const routed = routeSensors("claim_event", input.damageType);
  if (routed.primary === "drone") {
    reasons.push(
      `${input.damageType} damage is sub-pixel or faster than the satellite revisit (routing ${routed.ruleVersion}). Satellite screening alone cannot produce a claim-grade damage number — a drone capture is required. Abstaining rather than emitting a satellite figure that the backtest shows is unreliable at this scale.`
    );
    if (satFired)
      reasons.push("Satellite did register a wide-area change, attached below as screening context only.");
    return abstain(reasons, perTier);
  }

  // 3. Drought path (routed to satellite). Screening is legitimate here, but
  //    the raw gate over-fires (§3c). Require weather corroboration to call it
  //    corroborated; otherwise it is screening-only, never a confident number.
  if (!satOk) {
    reasons.push(`Satellite analysis unavailable (${(sat as { reason?: string })?.reason ?? "no clear scenes"}). Nothing to fuse — abstaining.`);
    return abstain(reasons, perTier);
  }
  if (!satFired) {
    reasons.push("Satellite screening found no significant deviation from the field's own multi-year baseline and its region. No damage signal to report.");
    return {
      version: FUSION_VERSION, paramsHash: FUSION_PARAMS_HASH,
      state: "screening_only", reportedSeverityPct: 0, reportedAffectedAcres: 0,
      calibratedConfidence: null, abstained: false, reasons, perTier,
    };
  }
  // satellite fired on the drought path
  if (weatherCorroborates === true) {
    reasons.push(
      `Satellite screening fired AND independent rainfall (Open-Meteo ERA5) sits below ${PARAMS.weatherCorroborationMaxRatio * 100}% of the 10-year normal — the two agree. Note (docs/AUDIT.md §A2): the corroboration lever's specificity rests on very few events; treat as a strong screen, not a calibrated severity.`
    );
    return {
      version: FUSION_VERSION, paramsHash: FUSION_PARAMS_HASH,
      state: "screening_corroborated",
      reportedSeverityPct: (sat as DamageAssessment).severityPct,
      reportedAffectedAcres: (sat as DamageAssessment).affectedAcres,
      calibratedConfidence: null, // heuristic confidence is anti-calibrated → withheld
      abstained: false, reasons, perTier,
    };
  }
  reasons.push(
    weatherCorroborates === false
      ? "Satellite screening fired but rainfall was near or above normal — the field-vs-region drop is not corroborated by weather. On documented-quiet seasons the raw gate fires ~42% of the time (§3c), so an uncorroborated fire is treated as screening-only, not a damage finding."
      : "Satellite screening fired but the weather cross-check could not be computed. Without corroboration this stays screening-only."
  );
  return {
    version: FUSION_VERSION, paramsHash: FUSION_PARAMS_HASH,
    state: "screening_only",
    reportedSeverityPct: null, reportedAffectedAcres: null,
    calibratedConfidence: null, abstained: true, reasons, perTier,
  };
}

/** How close is the label flywheel to enabling a real calibrator? */
export function calibrationState(labelCount: number) {
  return {
    labelCount,
    threshold: PARAMS.calibrationLabelThreshold,
    calibrated: false as const, // never true until real labels exist and are validated
    remaining: Math.max(0, PARAMS.calibrationLabelThreshold - labelCount),
    note:
      labelCount >= PARAMS.calibrationLabelThreshold
        ? "Label threshold reached — a conformal calibrator can now be fit and validated leave-one-event-out before replacing the fixed abstention rules. Until that validation passes, abstention rules remain in force."
        : `${PARAMS.calibrationLabelThreshold - labelCount} more calibration-grade labeled events needed before a learned confidence can replace the fixed abstention rules.`,
  };
}
