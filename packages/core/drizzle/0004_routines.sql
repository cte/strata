CREATE TABLE IF NOT EXISTS `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`input_schema_json` text NOT NULL,
	`default_input_json` text,
	`output_schema_json` text,
	`output_mode` text NOT NULL,
	`tool_profile` text NOT NULL,
	`required_skills_json` text NOT NULL,
	`pre_run_steps_json` text NOT NULL,
	`publication_policy_json` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_routines_status` ON `routines` (`status`,`updated_at` desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_routines_updated` ON `routines` (`updated_at` desc);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `routine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`routine_version` integer NOT NULL,
	`input_json` text NOT NULL,
	`status` text NOT NULL,
	`task_status` text,
	`job_session_id` text,
	`agent_session_id` text,
	`child_session_ids_json` text NOT NULL,
	`output_artifact_ids_json` text NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_routine_runs_routine` ON `routine_runs` (`routine_id`,`started_at` desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_routine_runs_started` ON `routine_runs` (`started_at` desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_routine_runs_status` ON `routine_runs` (`status`,`started_at` desc);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `routine_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_run_id` text NOT NULL,
	`routine_id` text NOT NULL,
	`schema_name` text NOT NULL,
	`schema_version` text NOT NULL,
	`payload_json` text NOT NULL,
	`validation_status` text NOT NULL,
	`task_status` text NOT NULL,
	`dedupe_key` text,
	`source_refs_json` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`routine_run_id`) REFERENCES `routine_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_routine_artifacts_run` ON `routine_artifacts` (`routine_run_id`,`created_at` desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_routine_artifacts_routine` ON `routine_artifacts` (`routine_id`,`created_at` desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_routine_artifacts_dedupe` ON `routine_artifacts` (`routine_id`,`dedupe_key`);
