CREATE TABLE `classification_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`source` text NOT NULL,
	`target_session_id` text NOT NULL,
	`target_event_id` integer NOT NULL,
	`raw_path` text NOT NULL,
	`observed_json` text NOT NULL,
	`verdict` text NOT NULL,
	`correction_json` text,
	`derived_proposal_path` text,
	`status` text NOT NULL,
	`dedupe_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_classification_corrections_dedupe` ON `classification_corrections` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_classification_corrections_created` ON `classification_corrections` ("created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_classification_corrections_status` ON `classification_corrections` (`status`,"created_at" desc);
