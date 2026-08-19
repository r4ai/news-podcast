ALTER TABLE `episode_jobs` ADD `idempotency_scope` text DEFAULT 'create' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_episode_jobs` (
	`job_id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`idempotency_scope` text DEFAULT 'create' NOT NULL,
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
	`current_stage` text,
	`stage_started_at` text,
	`last_progress_at` text,
	`stage_progress_completed` integer,
	`stage_progress_total` integer,
	CONSTRAINT `episode_jobs_owner_scope_idempotency` UNIQUE(`owner_id`,`idempotency_scope`,`idempotency_key`),
	CONSTRAINT "episode_jobs_status_check" CHECK("status" IN ('Queued', 'Running', 'Retrying', 'Succeeded', 'Failed', 'Canceled')),
	CONSTRAINT "episode_jobs_attempt_check" CHECK("attempt" >= 0 AND "attempt" <= 4),
	CONSTRAINT "episode_jobs_running_lease_check" CHECK("status" <> 'Running' OR ("lease_token" IS NOT NULL AND "leased_until" IS NOT NULL AND "started_at" IS NOT NULL)),
	CONSTRAINT "episode_jobs_succeeded_check" CHECK("status" <> 'Succeeded' OR ("episode_id" IS NOT NULL AND "completed_at" IS NOT NULL)),
	CONSTRAINT "episode_jobs_failed_check" CHECK("status" <> 'Failed' OR ("failure_code" IS NOT NULL AND "failed_at" IS NOT NULL)),
	CONSTRAINT "episode_jobs_retrying_check" CHECK("status" <> 'Retrying' OR ("failure_code" IS NOT NULL AND "retry_at" IS NOT NULL)),
	CONSTRAINT "episode_jobs_canceled_check" CHECK("status" <> 'Canceled' OR ("canceled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)),
	CONSTRAINT "episode_jobs_stage_progress_check" CHECK(("stage_progress_completed" IS NULL AND "stage_progress_total" IS NULL) OR ("stage_progress_completed" >= 0 AND "stage_progress_total" > 0 AND "stage_progress_completed" <= "stage_progress_total"))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_episode_jobs`(`job_id`, `owner_id`, `idempotency_key`, `request_fingerprint`, `trigger`, `status`, `attempt`, `created_at`, `enqueued_at`, `started_at`, `retry_at`, `completed_at`, `failed_at`, `canceled_at`, `lease_token`, `leased_until`, `failure_code`, `failure_retryable`, `episode_id`, `cancel_reason`, `current_stage`, `stage_started_at`, `last_progress_at`, `stage_progress_completed`, `stage_progress_total`) SELECT `job_id`, `owner_id`, `idempotency_key`, `request_fingerprint`, `trigger`, `status`, `attempt`, `created_at`, `enqueued_at`, `started_at`, `retry_at`, `completed_at`, `failed_at`, `canceled_at`, `lease_token`, `leased_until`, `failure_code`, `failure_retryable`, `episode_id`, `cancel_reason`, `current_stage`, `stage_started_at`, `last_progress_at`, `stage_progress_completed`, `stage_progress_total` FROM `episode_jobs`;--> statement-breakpoint
DROP TABLE `episode_jobs`;--> statement-breakpoint
ALTER TABLE `__new_episode_jobs` RENAME TO `episode_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `episode_jobs_execution_state` ON `episode_jobs` (`status`,`job_id`);--> statement-breakpoint
CREATE INDEX `episode_jobs_owner_recent` ON `episode_jobs` (`owner_id`,"created_at" DESC,"job_id" DESC);
