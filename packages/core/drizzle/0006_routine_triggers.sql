CREATE TABLE `routine_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`name` text,
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
	`locked_at` text,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `routine_triggers` (
	`id`, `routine_id`, `name`, `input_json`, `trigger_json`, `enabled`,
	`created_at`, `updated_at`, `next_run_at`, `last_run_at`,
	`last_session_id`, `last_status`, `last_error`, `locked_at`
)
SELECT
	`id`,
	json_extract(`input_json`, '$.routineId'),
	`name`,
	coalesce(json_extract(`input_json`, '$.input'), '{}'),
	`trigger_json`,
	`enabled`,
	`created_at`,
	`updated_at`,
	`next_run_at`,
	`last_run_at`,
	`last_session_id`,
	`last_status`,
	`last_error`,
	`locked_at`
FROM `job_schedules`
WHERE `job_name` = 'routine.run'
	AND json_extract(`input_json`, '$.routineId') IN (SELECT `id` FROM `routines`);
--> statement-breakpoint
DROP TABLE `job_schedules`;
--> statement-breakpoint
CREATE INDEX `idx_routine_triggers_due` ON `routine_triggers` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `idx_routine_triggers_routine` ON `routine_triggers` (`routine_id`);
