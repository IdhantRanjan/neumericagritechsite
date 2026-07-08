CREATE TABLE `routing_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`field_id` text,
	`claim_id` text,
	`question` text NOT NULL,
	`damage_type` text,
	`primary_sensor` text NOT NULL,
	`corroborating` text NOT NULL,
	`rationale` text NOT NULL,
	`rule_version` text NOT NULL,
	`rule_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action
);
