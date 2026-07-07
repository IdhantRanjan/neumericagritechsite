CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`detail` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`field_id` text NOT NULL,
	`crop_season_id` text,
	`policy_ref_id` text,
	`damage_type` text NOT NULL,
	`event_date` text NOT NULL,
	`discovered_date` text NOT NULL,
	`narrative` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`fcr_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_season_id`) REFERENCES `crop_seasons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_ref_id`) REFERENCES `policy_refs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `crop_seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`crop` text NOT NULL,
	`year` integer NOT NULL,
	`practice` text DEFAULT 'non_irrigated' NOT NULL,
	`planting_date` text,
	`intended_acres` real,
	`reported_acres` real,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deadline_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`crop` text,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `field_condition_records` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`crop_season_id` text,
	`observed_at` text NOT NULL,
	`crop` text NOT NULL,
	`growth_stage` text,
	`condition_class` text NOT NULL,
	`damage_type` text,
	`severity_pct` real,
	`affected_acres` real,
	`affected_area` text,
	`metrics` text NOT NULL,
	`confidence` real NOT NULL,
	`capture_ids` text NOT NULL,
	`imagery_sha256` text NOT NULL,
	`model_name` text NOT NULL,
	`model_version` text NOT NULL,
	`pipeline_run_id` text NOT NULL,
	`analyzed_at` text NOT NULL,
	`reviewed_by` text,
	`supersedes` text,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_season_id`) REFERENCES `crop_seasons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fields` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`name` text NOT NULL,
	`county` text NOT NULL,
	`acres` real NOT NULL,
	`boundary` text,
	`fsa_farm_number` text,
	`fsa_tract_number` text,
	`fsa_field_number` text,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `imagery_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`source` text NOT NULL,
	`captured_at` text NOT NULL,
	`lat` real,
	`lng` real,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`metadata` text,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `marketing_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`crop` text NOT NULL,
	`year` integer NOT NULL,
	`produced_bu` real,
	`stored_bu` real,
	`sold_bu` real,
	`contracted_bu` real,
	`cost_of_production_per_acre` real,
	`insurance_floor_per_bu` real,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`counties` text NOT NULL,
	`entity_type` text DEFAULT 'sole_proprietor' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policy_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`crop` text NOT NULL,
	`year` integer NOT NULL,
	`plan_type` text NOT NULL,
	`coverage_level_pct` integer NOT NULL,
	`aip_name` text,
	`agent_name` text,
	`agent_phone` text,
	`policy_number` text,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `program_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`program_id` text NOT NULL,
	`matched_criteria` text NOT NULL,
	`missing_criteria` text NOT NULL,
	`strength` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`evaluated_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trigger_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`version` integer NOT NULL,
	`metric` text NOT NULL,
	`comparator` text NOT NULL,
	`threshold` real NOT NULL,
	`consecutive_observations` integer DEFAULT 2 NOT NULL,
	`imagery_source_class` text NOT NULL,
	`carrier_contract_ref` text,
	`active` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trigger_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_definition_id` text NOT NULL,
	`definition_version` integer NOT NULL,
	`input_fcr_ids` text NOT NULL,
	`computed_value` real NOT NULL,
	`fired` integer NOT NULL,
	`calculation_trace` text NOT NULL,
	`evaluated_at` text NOT NULL,
	FOREIGN KEY (`trigger_definition_id`) REFERENCES `trigger_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
