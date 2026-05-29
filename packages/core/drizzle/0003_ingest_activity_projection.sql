CREATE TABLE IF NOT EXISTS `ingest_activity_runs` (
	`session_id` text PRIMARY KEY NOT NULL,
	`projected_at` text NOT NULL,
	`last_event_id` integer NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`stage` text NOT NULL,
	`operation` text NOT NULL,
	`source` text,
	`connector` text,
	`dry_run` integer,
	`job_name` text,
	`schedule_id` text,
	`schedule_name` text,
	`summary` text,
	`error_message` text,
	`related_session_ids_json` text NOT NULL,
	`raw_scanned` integer NOT NULL,
	`raw_written` integer NOT NULL,
	`raw_skipped` integer NOT NULL,
	`raw_indexed` integer NOT NULL,
	`raw_index_skipped` integer NOT NULL,
	`wiki_pages_touched` integer NOT NULL,
	`failures` integer NOT NULL,
	`search_indexed` integer NOT NULL,
	`item_count` integer NOT NULL,
	`has_writes_or_wiki_indexes` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ingest_activity_runs_started` ON `ingest_activity_runs` (`started_at` desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ingest_activity_runs_write_index` ON `ingest_activity_runs` (`has_writes_or_wiki_indexes`,`started_at` desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ingest_activity_runs_source` ON `ingest_activity_runs` (`source`,`started_at` desc);
