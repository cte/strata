CREATE TABLE IF NOT EXISTS `web_chat_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ended_at` text,
	`cancelled` integer DEFAULT 0 NOT NULL,
	`session_id` text,
	`continue_session_id` text,
	`stopped_reason` text,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `web_chat_run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`ts` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `web_chat_runs`(`run_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `web_chat_queued_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`run_id` text,
	`message` text NOT NULL,
	`attachments_json` text NOT NULL,
	`delivery` text DEFAULT 'follow-up' NOT NULL,
	`provider` text,
	`model` text,
	`reasoning_effort` text,
	`created_at` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	check (`session_id` is not null or `run_id` is not null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `web_chat_queue_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`session_id` text,
	`run_id` text,
	check (`session_id` is not null or `run_id` is not null)
);
