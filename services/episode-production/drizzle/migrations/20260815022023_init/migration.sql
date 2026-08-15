CREATE TABLE `episode_completion_outbox` (
	`job_id` text PRIMARY KEY,
	`episode_id` text NOT NULL UNIQUE,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	CONSTRAINT `fk_episode_completion_outbox_job_id_episode_jobs_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `episode_jobs`(`job_id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `episode_dictionary_snapshots` (
	`job_id` text PRIMARY KEY,
	`snapshot` text NOT NULL,
	CONSTRAINT `fk_episode_dictionary_snapshots_job_id_episode_jobs_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `episode_jobs`(`job_id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `episode_execution_checkpoints` (
	`job_id` text PRIMARY KEY,
	`script` text NOT NULL,
	`audio` text,
	CONSTRAINT `fk_episode_execution_checkpoints_job_id_episode_jobs_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `episode_jobs`(`job_id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `episode_job_articles` (
	`job_id` text NOT NULL,
	`position` integer NOT NULL,
	`article_id` text NOT NULL,
	CONSTRAINT `episode_job_articles_pk` PRIMARY KEY(`job_id`, `position`),
	CONSTRAINT `fk_episode_job_articles_job_id_episode_jobs_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `episode_jobs`(`job_id`) ON DELETE CASCADE,
	CONSTRAINT "episode_job_articles_position_check" CHECK("position" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `episode_job_status_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`job_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`occurred_at` text NOT NULL,
	`document` text NOT NULL,
	CONSTRAINT `fk_episode_job_status_events_job_id_episode_jobs_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `episode_jobs`(`job_id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `episode_jobs` (
	`job_id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`created_at` text NOT NULL,
	`enqueued_at` text,
	`started_at` text,
	`retry_at` text,
	`completed_at` text,
	`failed_at` text,
	`canceled_at` text,
	`lease_token` text,
	`leased_until` text,
	`failure_code` text,
	`failure_retryable` integer,
	`episode_id` text,
	`cancel_reason` text,
	CONSTRAINT `episode_jobs_owner_idempotency` UNIQUE(`owner_id`,`idempotency_key`),
	CONSTRAINT "episode_jobs_status_check" CHECK("status" IN ('Queued', 'Running', 'Retrying', 'Succeeded', 'Failed', 'Canceled')),
	CONSTRAINT "episode_jobs_attempt_check" CHECK("attempt" >= 0 AND "attempt" <= 4),
	CONSTRAINT "episode_jobs_running_lease_check" CHECK("status" <> 'Running' OR ("lease_token" IS NOT NULL AND "leased_until" IS NOT NULL AND "started_at" IS NOT NULL)),
	CONSTRAINT "episode_jobs_succeeded_check" CHECK("status" <> 'Succeeded' OR ("episode_id" IS NOT NULL AND "completed_at" IS NOT NULL)),
	CONSTRAINT "episode_jobs_failed_check" CHECK("status" <> 'Failed' OR ("failure_code" IS NOT NULL AND "failed_at" IS NOT NULL)),
	CONSTRAINT "episode_jobs_retrying_check" CHECK("status" <> 'Retrying' OR ("failure_code" IS NOT NULL AND "retry_at" IS NOT NULL)),
	CONSTRAINT "episode_jobs_canceled_check" CHECK("status" <> 'Canceled' OR ("canceled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE TABLE `production_agent_events` (
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	CONSTRAINT `production_agent_events_pk` PRIMARY KEY(`run_id`, `sequence`),
	CONSTRAINT `fk_production_agent_events_run_id_production_agent_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `production_agent_runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "production_agent_events_sequence_check" CHECK("sequence" >= 0),
	CONSTRAINT "production_agent_events_payload_check" CHECK(json_valid("payload_json"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `production_agent_instances` (
	`id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`agent_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `production_agent_instances_owner_key` UNIQUE(`owner_id`,`agent_key`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `production_agent_memories` (
	`id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`agent_instance_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`current_version` integer NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_production_agent_memories_agent_instance_id_production_agent_instances_id_fk` FOREIGN KEY (`agent_instance_id`) REFERENCES `production_agent_instances`(`id`) ON DELETE CASCADE,
	CONSTRAINT "production_agent_memories_kind_check" CHECK("kind" IN ('preference', 'episode_history', 'working_note')),
	CONSTRAINT "production_agent_memories_status_check" CHECK("status" IN ('proposed', 'active', 'rejected', 'deleted')),
	CONSTRAINT "production_agent_memories_version_check" CHECK("current_version" >= 1)
) STRICT;
--> statement-breakpoint
CREATE TABLE `production_agent_memory_versions` (
	`memory_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_json` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `production_agent_memory_versions_pk` PRIMARY KEY(`memory_id`, `version`),
	CONSTRAINT `fk_production_agent_memory_versions_memory_id_production_agent_memories_id_fk` FOREIGN KEY (`memory_id`) REFERENCES `production_agent_memories`(`id`) ON DELETE CASCADE,
	CONSTRAINT "production_agent_memory_versions_version_check" CHECK("version" >= 1),
	CONSTRAINT "production_agent_memory_versions_content_check" CHECK(json_valid("content_json"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `production_agent_runs` (
	`id` text PRIMARY KEY,
	`job_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`agent_instance_id` text,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`policy_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	`failure_code` text,
	CONSTRAINT `fk_production_agent_runs_job_id_episode_jobs_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `episode_jobs`(`job_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_agent_runs_agent_instance_id_production_agent_instances_id_fk` FOREIGN KEY (`agent_instance_id`) REFERENCES `production_agent_instances`(`id`) ON DELETE SET NULL,
	CONSTRAINT "production_agent_runs_status_check" CHECK("status" IN ('queued', 'running', 'waiting_approval', 'retrying', 'succeeded', 'failed', 'canceled'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `reading_dictionary` (
	`id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`surface` text NOT NULL,
	`reading` text NOT NULL,
	`accent_type` integer NOT NULL,
	`source` text NOT NULL,
	`episode_job_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `reading_dictionary_owner_surface_unique` UNIQUE(`owner_id`,`surface`),
	CONSTRAINT "reading_dictionary_accent_type_check" CHECK("accent_type" BETWEEN 0 AND 100),
	CONSTRAINT "reading_dictionary_source_check" CHECK("source" IN ('manual', 'ai_auto'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `episode_completion_outbox_pending` ON `episode_completion_outbox` (`published_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `episode_job_status_events_owner_cursor` ON `episode_job_status_events` (`owner_id`,`job_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `episode_jobs_execution_state` ON `episode_jobs` (`status`,`job_id`);--> statement-breakpoint
CREATE INDEX `episode_jobs_owner_recent` ON `episode_jobs` (`owner_id`,"created_at" DESC,"job_id" DESC);--> statement-breakpoint
CREATE INDEX `production_agent_memories_scope` ON `production_agent_memories` (`owner_id`,`agent_instance_id`,`status`,`kind`,`id`);--> statement-breakpoint
CREATE INDEX `production_agent_runs_owner_status` ON `production_agent_runs` (`owner_id`,`status`,"created_at" DESC,`id`);--> statement-breakpoint
CREATE INDEX `reading_dictionary_owner_surface` ON `reading_dictionary` (`owner_id`,`surface`,`id`);