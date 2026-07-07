CREATE TABLE `marketing_plan_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`position_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_value` real NOT NULL,
	`amount_bu` real NOT NULL,
	`note` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `marketing_positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `acres` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `expected_yield_bu_per_acre` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `avg_sold_price` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `current_cash_price` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `current_futures_price` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `typical_basis_lo` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `typical_basis_hi` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `storage_capacity_bu` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `storage_cost_per_bu_month` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `cash_need_usd` real;--> statement-breakpoint
ALTER TABLE `marketing_positions` ADD `cash_need_by_date` text;--> statement-breakpoint
ALTER TABLE `operations` ADD `access_token` text;--> statement-breakpoint
ALTER TABLE `operations` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `operations` ADD `has_base_acres` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `operations` ADD `stores_grain_on_farm` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `operations` ADD `uses_cover_crops` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `operations` ADD `uses_no_till` integer DEFAULT false NOT NULL;