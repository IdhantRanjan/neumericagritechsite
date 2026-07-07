/**
 * CV pipeline contract — the stable interface real analyzers implement.
 * See docs/ARCHITECTURE.md §4. The pipeline is: ingest → validate →
 * geo-register → analyze → emit FieldConditionRecord (+ human review in
 * Phase 1 before anything enters a claim packet).
 */

export type ImagerySource = "phone" | "drone" | "satellite";

export interface AnalyzerInput {
  fieldId: string;
  crop: string;
  damageType: string; // hail | flood | drought | wind | disease | pest | other
  eventDate: string; // ISO date of the damage event
  captures: Array<{
    id: string;
    source: ImagerySource;
    capturedAt: string;
    sha256: string;
    fileName: string;
  }>;
  fieldAcres: number;
}

export interface AnalyzerOutput {
  conditionClass: "healthy" | "stressed" | "damaged" | "destroyed";
  growthStage: string | null;
  severityPct: number; // 0–100
  affectedAcres: number;
  metrics: Record<string, number>; // ndvi_mean, exg_mean, stand_count_per_acre...
  confidence: number; // 0–1
  narrative: string; // plain-language finding, adjuster-legible
}

export interface Analyzer {
  /** Recorded in every FCR's provenance; bump on any behavior change. */
  name: string;
  version: string;
  analyze(input: AnalyzerInput): Promise<AnalyzerOutput>;
}
