CREATE TABLE `ground_truth_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`field_id` text NOT NULL,
	`claim_id` text,
	`fcr_id` text,
	`label_type` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`source` text NOT NULL,
	`notes` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `provenance_entries` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`prev_entry_hash` text NOT NULL,
	`entry_hash` text NOT NULL,
	`hmac` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provenance_entries_id_unique` ON `provenance_entries` (`id`);--> statement-breakpoint
CREATE TABLE `scene_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`source` text DEFAULT 'earth-search/sentinel-2-l2a' NOT NULL,
	`acquired_at` text NOT NULL,
	`year` integer NOT NULL,
	`doy` integer NOT NULL,
	`epsg` integer NOT NULL,
	`cloud_cover_scene` real,
	`clear_frac` real NOT NULL,
	`water_frac` real,
	`valid_pixels` integer NOT NULL,
	`total_pixels` integer NOT NULL,
	`stats` text NOT NULL,
	`scene_ref_hash` text NOT NULL,
	`methodology_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scene_obs_unique` ON `scene_observations` (`field_id`,`scene_id`,`methodology_version`);--> statement-breakpoint
ALTER TABLE `trigger_definitions` ADD `methodology_params` text;--> statement-breakpoint
ALTER TABLE `trigger_definitions` ADD `methodology_hash` text;