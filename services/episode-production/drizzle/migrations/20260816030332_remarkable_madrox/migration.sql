CREATE TABLE `episode_generation_plans` (
	`job_id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`selection_mode` text NOT NULL,
	`profile_include` text NOT NULL,
	`profile_exclude` text NOT NULL,
	`selected_article_ids` text NOT NULL,
	`selected_articles` text DEFAULT '[]' NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_episode_generation_plans_job_id_episode_jobs_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `episode_jobs`(`job_id`) ON DELETE CASCADE,
	CONSTRAINT "episode_generation_plans_selection_mode_check" CHECK("selection_mode" IN ('automatic', 'manual')),
	CONSTRAINT "episode_generation_plans_article_ids_json_check" CHECK(json_valid("selected_article_ids") AND json_array_length("selected_article_ids") BETWEEN 1 AND 20)
) STRICT;
--> statement-breakpoint
CREATE TABLE `episode_job_agui_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`job_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`run_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`payload` text NOT NULL,
	`event_key` text NOT NULL UNIQUE,
	CONSTRAINT `fk_episode_job_agui_events_job_id_episode_jobs_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `episode_jobs`(`job_id`) ON DELETE CASCADE,
	CONSTRAINT "episode_job_agui_events_payload_check" CHECK(json_valid("payload"))
) STRICT;
--> statement-breakpoint
ALTER TABLE `episode_jobs` ADD `current_stage` text;--> statement-breakpoint
DROP INDEX IF EXISTS `episode_job_status_events_owner_cursor`;--> statement-breakpoint
CREATE INDEX `episode_job_agui_events_owner_cursor` ON `episode_job_agui_events` (`owner_id`,`job_id`,`sequence`);--> statement-breakpoint
DROP TABLE `episode_job_status_events`;
