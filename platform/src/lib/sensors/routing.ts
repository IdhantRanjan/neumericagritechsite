/**
 * Sensor routing — the explicit, versioned rule that decides which sensor
 * tier answers which question. This is an auditable lookup, not ML: an
 * insurer reading a packet must be able to see WHY a given sensor produced
 * a given number, and the rule that chose it, byte-for-byte.
 *
 * The three tiers (docs/ARCHITECTURE.md §Sensors):
 *  - satellite: Sentinel-2 L2A, 10 m/px, ~5-day revisit, passive, free.
 *    Always-on monitoring, drought/season-scale signals, yield features.
 *  - drone: farmer-operated, 1–3 cm/px, on-demand. Claim-evidence
 *    quantification when damage features are smaller than a satellite
 *    pixel or can't wait for a clear revisit. Neumeric flies nothing —
 *    it turns the farmer's own capture into evidence.
 *  - phone: geotagged ground shots. Corroboration in every packet, and
 *    the ground-truth label channel for the training flywheel.
 *
 * Physics constants that drive the rule are stated per damage type below —
 * they are the same facts that define where the satellite tier is blind
 * (docs/ENGINES.md §sensor-ceiling).
 */
import { createHash } from "node:crypto";

export const ROUTING_VERSION = "sensor-routing@1.0.0";

export type SensorTier = "satellite" | "drone" | "phone";
export type Question =
  | "continuous_monitoring"
  | "yield_estimate"
  | "claim_event"
  | "corroboration"
  | "parametric_trigger";

/**
 * Damage-type physics: characteristic spatial scale of the visible feature,
 * and how fast the evidence degrades. These decide whether 10 m / ~5-day
 * satellite observation can carry the claim or a drone capture is required.
 */
const DAMAGE_PHYSICS: Record<
  string,
  { featureScaleM: [number, number]; evidenceDecays: "hours" | "days" | "weeks"; note: string }
> = {
  hail: {
    featureScaleM: [1, 50],
    evidenceDecays: "days",
    note: "Bruising/defoliation striping is sub-pixel at 10 m; canopy can partially regrow within 1–2 weeks.",
  },
  wind: {
    featureScaleM: [5, 100],
    evidenceDecays: "days",
    note: "Lodging changes canopy geometry more than spectral signature — weak NDVI signal at 10 m.",
  },
  flood: {
    featureScaleM: [10, 500],
    evidenceDecays: "days",
    note: "Standing water is visible at 10 m (SCL water class) but recedes before the next clear pass more often than not.",
  },
  drought: {
    featureScaleM: [100, 10_000],
    evidenceDecays: "weeks",
    note: "Field-to-region scale, slow onset — squarely inside satellite resolution and revisit.",
  },
  disease: {
    featureScaleM: [5, 200],
    evidenceDecays: "weeks",
    note: "Early foci are sub-pixel; late widespread pressure becomes satellite-visible.",
  },
  pest: {
    featureScaleM: [5, 200],
    evidenceDecays: "weeks",
    note: "Same scale behavior as disease.",
  },
  other: {
    featureScaleM: [1, 100],
    evidenceDecays: "days",
    note: "Unknown mechanism — treated conservatively as sub-pixel and fast-decaying.",
  },
};

const SATELLITE = { resolutionM: 10, medianClearRevisitDays: 8 }; // 5-day revisit × cloud odds (IL summer)

export interface RoutingDecision {
  question: Question;
  damageType: string | null;
  primary: SensorTier;
  corroborating: SensorTier[];
  rationale: string[];
  ruleVersion: string;
  ruleHash: string;
}

const RULE_HASH = createHash("sha256")
  .update(JSON.stringify({ ROUTING_VERSION, DAMAGE_PHYSICS, SATELLITE }))
  .digest("hex");

export function routeSensors(question: Question, damageType?: string | null): RoutingDecision {
  const base = {
    question,
    damageType: damageType ?? null,
    ruleVersion: ROUTING_VERSION,
    ruleHash: RULE_HASH,
  };

  if (question === "continuous_monitoring" || question === "yield_estimate" || question === "parametric_trigger") {
    return {
      ...base,
      primary: "satellite",
      corroborating: [],
      rationale: [
        "Field-scale, season-scale signal — inside Sentinel-2's 10 m resolution and ~5-day revisit.",
        "Zero farm hardware and zero per-observation cost make continuous coverage of every enrolled field possible.",
        question === "parametric_trigger"
          ? "Trigger methodology is locked to a fixed public imagery source so any party can recompute it."
          : "Escalation to finer sensors happens only when this layer flags a discrete event.",
      ],
    };
  }

  if (question === "corroboration") {
    return {
      ...base,
      primary: "phone",
      corroborating: [],
      rationale: [
        "Geotagged, timestamped ground photos corroborate remote observations and become ground-truth labels for the training flywheel.",
      ],
    };
  }

  // claim_event — the physics decision
  const phys = DAMAGE_PHYSICS[damageType ?? "other"] ?? DAMAGE_PHYSICS.other;
  const [minScale] = phys.featureScaleM;
  const subPixel = minScale < SATELLITE.resolutionM * 2; // needs ≥2 px to resolve a feature
  const outrunsRevisit = phys.evidenceDecays === "hours" || phys.evidenceDecays === "days";

  if (!subPixel && !outrunsRevisit) {
    return {
      ...base,
      primary: "satellite",
      corroborating: ["phone"],
      rationale: [
        `${damageType}: characteristic feature scale ${phys.featureScaleM[0]}–${phys.featureScaleM[1]} m resolves at 10 m/px. ${phys.note}`,
        "Phone photos ride along as ground corroboration and flywheel labels.",
      ],
    };
  }

  const rationale = [
    subPixel
      ? `${damageType}: damage features start at ~${minScale} m — below what ${SATELLITE.resolutionM} m/px satellite pixels can resolve (needs ≥2 px per feature). ${phys.note}`
      : `${damageType}: ${phys.note}`,
    outrunsRevisit
      ? `Evidence degrades in ${phys.evidenceDecays}; the median clear Sentinel-2 revisit here is ~${SATELLITE.medianClearRevisitDays} days — the satellite can miss the condition at its worst.`
      : "",
    "Escalate to a farmer-operated drone capture (1–3 cm/px, flyable the same day); satellite change detection still runs as the independent wide-area cross-check.",
    "Phone photos corroborate from the ground and become training labels.",
  ].filter(Boolean);

  return { ...base, primary: "drone", corroborating: ["satellite", "phone"], rationale };
}
