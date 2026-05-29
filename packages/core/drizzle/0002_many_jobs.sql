CREATE TABLE IF NOT EXISTS `job_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`job_name` text NOT NULL,
	`input_json` text NOT NULL,
	`trigger_json` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`next_run_at` text,
	`last_run_at` text,
	`last_session_id` text,
	`last_status` text,
	`last_error` text,
	`locked_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_job_schedules_due` ON `job_schedules` (`enabled`,`next_run_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_job_schedules_job` ON `job_schedules` (`job_name`);
