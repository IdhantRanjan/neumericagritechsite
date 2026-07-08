/**
 * Pluggable damage-model registry (Hard Core 2).
 *
 * Callers ask the registry, never a concrete implementation, so a trained
 * regressor (index features → damage %) drops in later without touching the
 * claim flow. Each model declares whether it may drive a REAL claim number
 * (`production`) — the demo stub is registered but permanently barred from
 * real operations, enforced here rather than by UI convention.
 *
 * Training threshold (docs/ENGINES.md §2): a learned model earns a slot here
 * only after ~150+ labeled events per damage type with holdout error better
 * than the index method — until then, explainable change detection is both
 * the primary and the fallback.
 */
import type { DB } from "@/db";
import type { Field } from "@/db/schema";
import { detectDamage, type DamageAssessment } from "@/lib/satellite/damage";
import { demoAnalyzer } from "./demo-analyzer";
import { simPriorMeta } from "./sim-prior";
import { METHODOLOGY_VERSION } from "@/lib/satellite/methodology";

export interface DamageModelMeta {
  name: string;
  version: string;
  kind: "index-change-detection" | "learned-regressor" | "demo-stub" | "learned-sim-prior";
  production: boolean; // may this model's output back a real claim?
  description: string;
}

export interface DamageModel extends DamageModelMeta {
  assess(db: DB, field: Field, eventDate: string): Promise<DamageAssessment>;
}

const satelliteModel: DamageModel = {
  name: "s2-change-detection",
  version: METHODOLOGY_VERSION,
  kind: "index-change-detection",
  production: true,
  description:
    "Sentinel-2 L2A NDVI change detection vs the field's own multi-year baseline and the surrounding region. Deterministic, explainable, fully provenanced.",
  assess: (db, field, eventDate) => detectDamage(db, field, eventDate),
};

const demoModel: DamageModel = {
  name: "demo-analyzer",
  version: demoAnalyzer.version,
  kind: "demo-stub",
  production: false, // hard-barred from real operations
  description: "Deterministic fake output for demo workspaces only. Never a real assessment.",
  assess: async (db, field, eventDate) => {
    const out = await demoAnalyzer.analyze({
      fieldId: field.id,
      crop: "corn",
      damageType: "other",
      eventDate,
      captures: [],
      fieldAcres: field.acres,
    });
    return {
      ok: true,
      eventDate,
      significant: true,
      extent: "localized",
      persistence: "unconfirmed",
      conditionClass: out.conditionClass,
      severityPct: out.severityPct,
      affectedFrac: out.affectedAcres / field.acres,
      affectedAcres: out.affectedAcres,
      affectedArea: null,
      confidence: out.confidence,
      confidenceFactors: { clear: 0, baseline: 0, effect: 0 },
      metrics: out.metrics,
      narrative: out.narrative,
      trace: {
        methodologyVersion: `demo@${demoAnalyzer.version}`,
        paramsHash: "demo",
        preScene: null,
        postScene: null,
        temporalBaseline: null,
        regional: null,
        scenesConsidered: 0,
      },
    };
  },
};

const REGISTRY = new Map<string, DamageModel>([
  [satelliteModel.name, satelliteModel],
  [demoModel.name, demoModel],
]);

export function getModel(name: string): DamageModel | undefined {
  return REGISTRY.get(name);
}

/** The model a given operation is allowed to use. Real ops never get the stub. */
export function primaryModelFor(isDemoOperation: boolean): DamageModel {
  return isDemoOperation ? demoModel : satelliteModel;
}

export function listModels(): DamageModelMeta[] {
  const base = [...REGISTRY.values()].map(({ name, version, kind, production, description }) => ({
    name,
    version,
    kind,
    production,
    description,
  }));
  // The sim-to-real prior (B2) is discoverable here but is imagery/pixel-level
  // (not the field-level assess() interface) and permanently production:false
  // until real-capture calibration. Listed so the registry is the single
  // source of truth about what exists and what may touch a real number.
  base.push(simPriorMeta());
  return base;
}
