CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`status` text NOT NULL,
	`model` text,
	`git_commit` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sessions_started` ON `sessions` ("started_at" desc);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `events` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ts` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_session` ON `events` (`session_id`,`ts`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_call_id` text,
	`tool_calls_json` text,
	`attachments_json` text,
	`ts` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_session` ON `messages` (`session_id`,`ts`);
