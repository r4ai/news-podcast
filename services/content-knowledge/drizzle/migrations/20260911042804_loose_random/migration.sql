ALTER TABLE `feed_sync_jobs` ADD `ready_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
DROP INDEX `feed_sync_jobs_claim`;
--> statement-breakpoint
CREATE INDEX `feed_sync_jobs_claim` ON `feed_sync_jobs` (`status`, `ready_sequence`, `job_id`);
