CREATE TABLE IF NOT EXISTS `extraction_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope_json` text NOT NULL,
	`day` text,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`extractor_version` text NOT NULL,
	`verifier_version` text NOT NULL,
	`model` text,
	`session_id` text,
	`dry_run` integer NOT NULL,
	`candidate_count` integer NOT NULL,
	`rejected_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_extraction_runs_name_day` ON `extraction_runs` (`name`,`day`,`extractor_version`,`verifier_version`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_extraction_runs_session` ON `extraction_runs` (`session_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `extraction_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`day` text NOT NULL,
	`source_path` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_type` text NOT NULL,
	`line_start` integer NOT NULL,
	`line_end` integer NOT NULL,
	`evidence_span_id` text NOT NULL,
	`evidence_text` text NOT NULL,
	`candidate_hash` text NOT NULL,
	`candidate_kind` text NOT NULL,
	`candidate_text` text NOT NULL,
	`status` text NOT NULL,
	`verification_json` text NOT NULL,
	`deterministic_reasons_json` text NOT NULL,
	`metadata_json` text NOT NULL,
	`published_target` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `extraction_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_extraction_candidates_dedupe` ON `extraction_candidates` (`name`,`day`,`source_path`,`line_start`,`line_end`,`candidate_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_extraction_candidates_day_status` ON `extraction_candidates` (`name`,`day`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_extraction_candidates_run` ON `extraction_candidates` (`run_id`);
