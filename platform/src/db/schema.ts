/**
 * Neumeric data model — source of truth for docs/ARCHITECTURE.md §3.
 *
 * Written against SQLite for the scaffold; column choices (text ids, ISO-8601
 * dates, JSON-as-text for geometry/metrics) port cleanly to Postgres+PostGIS,
 * where `boundary`/`affectedArea` become geometry columns and `metrics` jsonb.
 *
 * Records that anchor money (ImageryCapture, FieldConditionRecord,
 * TriggerEvaluation, AuditEvent) are append-only by convention: no UPDATE
 * paths exist in the app; corrections append a new row via `supersedes`.
 */
import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

// ————— Farm & land —————

export const operations = sqliteTable("operations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  state: text("state").notNull(), // 2-letter
  counties: text("counties", { mode: "json" }).$type<string[]>().notNull(),
  entityType: text("entity_type").notNull().default("sole_proprietor"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  // Workspace access: unguessable token in the invite link sets an HttpOnly
  // cookie. Interim access model until magic-link auth (ROADMAP Phase 1);
  // one farmer = one workspace = one private link.
  accessToken: text("access_token"),
  contactEmail: text("contact_email"),
  // Program-eligibility profile (drives the program-money finder)
  hasBaseAcres: integer("has_base_acres", { mode: "boolean" }).notNull().default(false),
  storesGrainOnFarm: integer("stores_grain_on_farm", { mode: "boolean" }).notNull().default(false),
  usesCoverCrops: integer("uses_cover_crops", { mode: "boolean" }).notNull().default(false),
  usesNoTill: integer("uses_no_till", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const fields = sqliteTable("fields", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  name: text("name").notNull(),
  county: text("county").notNull(),
  acres: real("acres").notNull(),
  // GeoJSON Polygon, [lng, lat] rings — becomes PostGIS geometry in prod
  boundary: text("boundary", { mode: "json" }).$type<GeoJSONPolygon>(),
  // FSA identifiers — how everything joins to USDA paperwork
  fsaFarmNumber: text("fsa_farm_number"),
  fsaTractNumber: text("fsa_tract_number"),
  fsaFieldNumber: text("fsa_field_number"),
});

export const cropSeasons = sqliteTable("crop_seasons", {
  id: text("id").primaryKey(),
  fieldId: text("field_id").notNull().references(() => fields.id),
  crop: text("crop").notNull(), // corn | soybeans | wheat | ...
  year: integer("year").notNull(),
  practice: text("practice").notNull().default("non_irrigated"),
  plantingDate: text("planting_date"),
  intendedAcres: real("intended_acres"),
  reportedAcres: real("reported_acres"), // null = not yet reported to FSA/RMA
});

// ————— Imagery & the Field Condition Record —————

export const imageryCaptures = sqliteTable("imagery_captures", {
  id: text("id").primaryKey(),
  fieldId: text("field_id").notNull().references(() => fields.id),
  source: text("source").notNull(), // phone | drone | satellite
  capturedAt: text("captured_at").notNull(),
  // capture centroid; footprint polygon added when source provides one
  lat: real("lat"),
  lng: real("lng"),
  fileName: text("file_name").notNull(),
  sha256: text("sha256").notNull(), // content hash = tamper-evidence primitive
  bytes: integer("bytes").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const fieldConditionRecords = sqliteTable("field_condition_records", {
  id: text("id").primaryKey(),
  fieldId: text("field_id").notNull().references(() => fields.id),
  cropSeasonId: text("crop_season_id").references(() => cropSeasons.id),
  observedAt: text("observed_at").notNull(),
  crop: text("crop").notNull(),
  growthStage: text("growth_stage"),
  conditionClass: text("condition_class").notNull(), // healthy|stressed|damaged|destroyed
  damageType: text("damage_type"), // hail|flood|drought|wind|disease|pest|other
  severityPct: real("severity_pct"),
  affectedAcres: real("affected_acres"),
  affectedArea: text("affected_area", { mode: "json" }).$type<GeoJSONPolygon>(),
  // open metric bag: ndvi_mean, exg_mean, stand_count_per_acre, canopy_cover_pct...
  metrics: text("metrics", { mode: "json" }).$type<Record<string, number>>().notNull(),
  confidence: real("confidence").notNull(),
  // provenance — what makes this record evidence rather than an opinion
  captureIds: text("capture_ids", { mode: "json" }).$type<string[]>().notNull(),
  imagerySha256: text("imagery_sha256", { mode: "json" }).$type<string[]>().notNull(),
  modelName: text("model_name").notNull(),
  modelVersion: text("model_version").notNull(),
  pipelineRunId: text("pipeline_run_id").notNull(),
  analyzedAt: text("analyzed_at").notNull(),
  reviewedBy: text("reviewed_by"), // human sign-off; required for claim packets in Phase 1
  supersedes: text("supersedes"), // append-only corrections
});

// ————— Pillar 1: insurance advocate —————

export const policyRefs = sqliteTable("policy_refs", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  crop: text("crop").notNull(),
  year: integer("year").notNull(),
  planType: text("plan_type").notNull(), // RP | YP | ARP | ...
  coverageLevelPct: integer("coverage_level_pct").notNull(),
  aipName: text("aip_name"), // approved insurance provider
  agentName: text("agent_name"),
  agentPhone: text("agent_phone"),
  policyNumber: text("policy_number"),
});

export const claims = sqliteTable("claims", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  fieldId: text("field_id").notNull().references(() => fields.id),
  cropSeasonId: text("crop_season_id").references(() => cropSeasons.id),
  policyRefId: text("policy_ref_id").references(() => policyRefs.id),
  damageType: text("damage_type").notNull(),
  eventDate: text("event_date").notNull(),
  discoveredDate: text("discovered_date").notNull(),
  narrative: text("narrative"),
  status: text("status").notNull().default("draft"), // draft|evidence|packet_ready|submitted|closed
  fcrIds: text("fcr_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: text("created_at").notNull(),
});

export const deadlineInstances = sqliteTable("deadline_instances", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  ruleId: text("rule_id").notNull(), // -> data/rules/deadlines.*.json
  crop: text("crop"),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("upcoming"), // upcoming|done|missed|na
  completedAt: text("completed_at"),
});

export const programMatches = sqliteTable("program_matches", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  programId: text("program_id").notNull(), // -> data/rules/programs.json
  matchedCriteria: text("matched_criteria", { mode: "json" }).$type<string[]>().notNull(),
  missingCriteria: text("missing_criteria", { mode: "json" }).$type<string[]>().notNull(),
  strength: text("strength").notNull(), // strong | likely | possible
  status: text("status").notNull().default("new"), // new|pursuing|dismissed|received
  evaluatedAt: text("evaluated_at").notNull(),
});

// ————— Pillar 2: parametric (schema reserved; carrier partner is the gate —
// see docs/DEPENDENCIES.md §5. No pricing/underwriting fields by design.) —————

export const triggerDefinitions = sqliteTable("trigger_definitions", {
  id: text("id").primaryKey(),
  fieldId: text("field_id").notNull().references(() => fields.id),
  version: integer("version").notNull(),
  metric: text("metric").notNull(), // FCR metric key, e.g. ndvi_mean
  comparator: text("comparator").notNull(), // lt | gt
  threshold: real("threshold").notNull(),
  consecutiveObservations: integer("consecutive_observations").notNull().default(2),
  imagerySourceClass: text("imagery_source_class").notNull(), // satellite|drone|any
  carrierContractRef: text("carrier_contract_ref"), // signed methodology doc
  active: integer("active", { mode: "boolean" }).notNull().default(false),
});

export const triggerEvaluations = sqliteTable("trigger_evaluations", {
  id: text("id").primaryKey(),
  triggerDefinitionId: text("trigger_definition_id").notNull().references(() => triggerDefinitions.id),
  definitionVersion: integer("definition_version").notNull(),
  inputFcrIds: text("input_fcr_ids", { mode: "json" }).$type<string[]>().notNull(),
  computedValue: real("computed_value").notNull(),
  fired: integer("fired", { mode: "boolean" }).notNull(),
  calculationTrace: text("calculation_trace", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  evaluatedAt: text("evaluated_at").notNull(),
});

// ————— Pillar 3: marketing position (decision support only — no
// recommendation fields exist in this schema by design; see DEPENDENCIES.md §7) —————

export const marketingPositions = sqliteTable("marketing_positions", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  crop: text("crop").notNull(),
  year: integer("year").notNull(),
  acres: real("acres"),
  expectedYieldBuPerAcre: real("expected_yield_bu_per_acre"),
  producedBu: real("produced_bu"), // CV-informed once FCR yield estimates exist
  storedBu: real("stored_bu"),
  soldBu: real("sold_bu"),
  avgSoldPrice: real("avg_sold_price"), // $/bu on bushels already sold
  contractedBu: real("contracted_bu"),
  costOfProductionPerAcre: real("cost_of_production_per_acre"),
  insuranceFloorPerBu: real("insurance_floor_per_bu"),
  // market snapshot — farmer-entered until licensed feeds land (DEPENDENCIES §8)
  currentCashPrice: real("current_cash_price"), // local elevator bid $/bu
  currentFuturesPrice: real("current_futures_price"), // nearby futures $/bu
  typicalBasisLo: real("typical_basis_lo"), // farmer's sense of local basis range
  typicalBasisHi: real("typical_basis_hi"),
  // storage & cash-flow
  storageCapacityBu: real("storage_capacity_bu"),
  storageCostPerBuMonth: real("storage_cost_per_bu_month"), // $/bu/month carry
  cashNeedUsd: real("cash_need_usd"), // cash the operation needs raised
  cashNeedByDate: text("cash_need_by_date"),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Farmer-authored marketing plan targets — the behavioral discipline layer.
 * The farmer sets these while calm; the app flags when one is hit. The
 * target is always the farmer's own decision, never system-generated
 * (CTA non-tailored boundary, DEPENDENCIES §7).
 */
export const marketingPlanTargets = sqliteTable("marketing_plan_targets", {
  id: text("id").primaryKey(),
  positionId: text("position_id").notNull().references(() => marketingPositions.id),
  kind: text("kind").notNull(), // cash_price | basis
  targetValue: real("target_value").notNull(), // $/bu (or basis $/bu, negative ok)
  amountBu: real("amount_bu").notNull(),
  note: text("note"),
  status: text("status").notNull().default("waiting"), // waiting | hit | acted | dropped
  createdAt: text("created_at").notNull(),
});

// ————— Audit —————

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
  at: text("at").notNull(),
});

export type GeoJSONPolygon = {
  type: "Polygon";
  coordinates: number[][][]; // [ [ [lng,lat], ... ] ]
};

export type Operation = typeof operations.$inferSelect;
export type Field = typeof fields.$inferSelect;
export type CropSeason = typeof cropSeasons.$inferSelect;
export type ImageryCapture = typeof imageryCaptures.$inferSelect;
export type FieldConditionRecord = typeof fieldConditionRecords.$inferSelect;
export type PolicyRef = typeof policyRefs.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type DeadlineInstance = typeof deadlineInstances.$inferSelect;
export type ProgramMatch = typeof programMatches.$inferSelect;
