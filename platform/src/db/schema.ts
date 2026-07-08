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
import { sqliteTable, text, real, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  sha256: text("sha256").notNull(), // content hash = tamper-evidence primitive AND storage key
  bytes: integer("bytes").notNull(),
  storageUrl: text("storage_url"), // durable object-storage URL (null = local/dev or reference-only)
  storageBackend: text("storage_backend"), // vercel-blob | local | reference (satellite scenes)
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
  affectedArea: text("affected_area", { mode: "json" }).$type<GeoJSONPolygon | GeoJSONMultiPolygon>(),
  // open metric bag: ndvi_mean, exg_mean, stand_count_per_acre, canopy_cover_pct...
  metrics: text("metrics", { mode: "json" }).$type<Record<string, number>>().notNull(),
  confidence: real("confidence").notNull(),
  // provenance — what makes this record evidence rather than an opinion
  captureIds: text("capture_ids", { mode: "json" }).$type<string[]>().notNull(),
  imagerySha256: text("imagery_sha256", { mode: "json" }).$type<string[]>().notNull(),
  // plain-language finding, adjuster-legible (generated from the trace, never free-form)
  narrative: text("narrative"),
  modelName: text("model_name").notNull(),
  modelVersion: text("model_version").notNull(),
  pipelineRunId: text("pipeline_run_id").notNull(),
  analyzedAt: text("analyzed_at").notNull(),
  reviewedBy: text("reviewed_by"), // human sign-off; required for claim packets in Phase 1
  supersedes: text("supersedes"), // append-only corrections
});

/**
 * Per-scene, per-field satellite observation — the atomic unit of the
 * remote-sensing layer. One row = one Sentinel-2 scene's index statistics
 * over one field boundary, cloud-masked via SCL, with full provenance.
 * Append-only; unique per (field, scene, methodology version) so a
 * methodology upgrade re-observes without rewriting history.
 */
export const sceneObservations = sqliteTable(
  "scene_observations",
  {
    id: text("id").primaryKey(),
    fieldId: text("field_id").notNull().references(() => fields.id),
    sceneId: text("scene_id").notNull(), // STAC item id, e.g. S2B_16TCM_20230704_0_L2A
    source: text("source").notNull().default("earth-search/sentinel-2-l2a"),
    acquiredAt: text("acquired_at").notNull(),
    year: integer("year").notNull(),
    doy: integer("doy").notNull(), // day of year, for phenology baselines
    epsg: integer("epsg").notNull(),
    cloudCoverScene: real("cloud_cover_scene"), // scene-level eo:cloud_cover %
    clearFrac: real("clear_frac").notNull(), // field-level clear-pixel fraction (SCL)
    waterFrac: real("water_frac"), // SCL water fraction (flood signal)
    validPixels: integer("valid_pixels").notNull(),
    totalPixels: integer("total_pixels").notNull(),
    // index statistics over clear field pixels: ndvi_mean/median/p10/p90/std,
    // evi_mean, ndre_mean, frac_below_040 ...
    stats: text("stats", { mode: "json" }).$type<Record<string, number>>().notNull(),
    // sha256 of the canonical scene reference (item id + asset hrefs + datetime):
    // deterministic identity for imagery we reference but don't copy
    sceneRefHash: text("scene_ref_hash").notNull(),
    methodologyVersion: text("methodology_version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("scene_obs_unique").on(t.fieldId, t.sceneId, t.methodologyVersion)]
);

/**
 * Ground-truth labels — the ML flywheel's compounding asset. Each row links
 * a confirmed real-world outcome (farmer-reported damage, adjuster
 * settlement, actual harvested yield) to the field/event/imagery it
 * describes, so index features can be joined into training data.
 */
export const groundTruthLabels = sqliteTable("ground_truth_labels", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  fieldId: text("field_id").notNull().references(() => fields.id),
  claimId: text("claim_id").references(() => claims.id),
  fcrId: text("fcr_id"), // the FCR whose prediction this label grades
  labelType: text("label_type").notNull(), // farmer_damage_pct | adjuster_settlement_pct | harvested_yield_bu_ac
  value: real("value").notNull(),
  unit: text("unit").notNull(), // pct | bu_per_acre | usd
  source: text("source").notNull(), // farmer | adjuster | scale_ticket | fsa_report
  notes: text("notes"),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: text("recorded_at").notNull(),
});

/**
 * Tamper-evident provenance chain. Every money-relevant artifact (imagery
 * capture, field condition record, trigger evaluation, ground-truth label)
 * appends an entry committing to the previous entry's hash — altering any
 * historical record breaks every subsequent hash. HMAC-signed with a server
 * key; external RFC-3161 timestamping is the documented next step.
 */
export const provenanceEntries = sqliteTable("provenance_entries", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  payloadSha256: text("payload_sha256").notNull(), // hash of canonical entity payload
  prevEntryHash: text("prev_entry_hash").notNull(), // "genesis" for the first entry
  entryHash: text("entry_hash").notNull(), // sha256(seq|prev|payload|entity|at)
  hmac: text("hmac").notNull(), // HMAC-SHA256(entryHash, PROVENANCE_KEY)
  at: text("at").notNull(),
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

/**
 * Sensor-routing decisions — the auditable record of WHICH sensor tier the
 * platform selected for a given question and WHY. Deterministic rule output
 * (src/lib/sensors/routing.ts), stored so an insurer can see the routing
 * that produced a given number. One row per routing invocation.
 */
export const routingDecisions = sqliteTable("routing_decisions", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  fieldId: text("field_id").references(() => fields.id),
  claimId: text("claim_id").references(() => claims.id),
  question: text("question").notNull(), // continuous_monitoring|claim_event|...
  damageType: text("damage_type"),
  primarySensor: text("primary_sensor").notNull(), // satellite|drone|phone
  corroborating: text("corroborating", { mode: "json" }).$type<string[]>().notNull(),
  rationale: text("rationale", { mode: "json" }).$type<string[]>().notNull(),
  ruleVersion: text("rule_version").notNull(),
  ruleHash: text("rule_hash").notNull(),
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
  // The locked methodology: full parameter set + its canonical-JSON sha256.
  // An evaluation is only valid against the exact hash it was defined with —
  // this is what makes a payout dispute resolvable byte-for-byte.
  methodologyParams: text("methodology_params", { mode: "json" }).$type<Record<string, unknown>>(),
  methodologyHash: text("methodology_hash"),
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

// ————— Accounts & auth (magic-link primary, optional password fallback) —————

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(), // stored lowercased
  name: text("name"),
  // scrypt hash "scrypt:N:r:p:salt:hash" — null means magic-link-only account
  passwordHash: text("password_hash"),
  emailVerifiedAt: text("email_verified_at"),
  createdAt: text("created_at").notNull(),
});

/** A user's role inside one operation. Every page/mutation is role-scoped. */
export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    operationId: text("operation_id").notNull().references(() => operations.id),
    // owner: full control · member: day-to-day writes · advisor: read + notes
    // partner: reserved lender/co-op read-only channel (tenant-isolated)
    role: text("role").notNull().default("member"),
    invitedBy: text("invited_by"),
    createdAt: text("created_at").notNull(),
  },
  (m) => [uniqueIndex("membership_unique").on(m.userId, m.operationId)]
);

/**
 * One-time tokens (magic links, invites, email changes, waitlist confirms).
 * Only the sha256 of the token is stored — a DB leak can't mint sessions.
 */
export const authTokens = sqliteTable("auth_tokens", {
  id: text("id").primaryKey(),
  purpose: text("purpose").notNull(), // magic_link | invite | email_change | waitlist_confirm
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  userId: text("user_id"),
  operationId: text("operation_id"),
  role: text("role"), // for invites
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  revokedAt: text("revoked_at"),
});

/** Per-account login audit log (also serves the auditability principle). */
export const loginEvents = sqliteTable("login_events", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  email: text("email").notNull(),
  kind: text("kind").notNull(), // magic_link_sent|signin|signout|signout_all|password_set|password_failed|invite_accepted
  ip: text("ip"),
  userAgent: text("user_agent"),
  at: text("at").notNull(),
});

// ————— Growth: waitlist + founder validation CRM —————

export const waitlistSignups = sqliteTable("waitlist_signups", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  state: text("state"),
  county: text("county"),
  acres: text("acres"),
  channel: text("channel").notNull().default("direct"), // direct | lender | agent | coop | other
  // funnel: pending (needs email confirm) → confirmed → onboarded
  status: text("status").notNull().default("pending"),
  confirmedAt: text("confirmed_at"),
  onboardedOperationId: text("onboarded_operation_id"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

/** Founder validation pipeline — the real IL outreach, tracked. */
export const crmContacts = sqliteTable("crm_contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  org: text("org"),
  county: text("county"),
  kind: text("kind").notNull().default("farmer"), // farmer | lender | agent | extension | coop | other
  source: text("source"), // farm_bureau | extension | il_farm_link | bounty_of_kane | cold | referral
  stage: text("stage").notNull().default("identified"), // identified|contacted|replied|meeting|piloting|passed
  email: text("email"),
  phone: text("phone"),
  nextAction: text("next_action"),
  nextActionDate: text("next_action_date"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ————— Ops: rate limiting + background jobs —————

/** Fixed-window rate limiting that works across serverless instances. */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), // e.g. "waitlist:1.2.3.4:2026-07-07T18"
  count: integer("count").notNull().default(0),
  windowStart: text("window_start").notNull(),
});

/** Long-running work (satellite scans/analyses) tracked out of the request. */
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  kind: text("kind").notNull(), // satellite_scan | satellite_analysis
  entityId: text("entity_id").notNull(), // fieldId or claimId
  status: text("status").notNull().default("queued"), // queued|running|done|failed
  progress: text("progress"), // human-readable step, e.g. "12/20 scenes"
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
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

export type GeoJSONMultiPolygon = {
  type: "MultiPolygon";
  coordinates: number[][][][];
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
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type CrmContact = typeof crmContacts.$inferSelect;
export type Job = typeof jobs.$inferSelect;
