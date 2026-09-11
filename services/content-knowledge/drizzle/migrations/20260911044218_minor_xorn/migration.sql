ALTER TABLE `feed_sync_jobs` ADD `ready_sequence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `feed_sync_jobs` ADD `ready_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `feed_sync_jobs` ADD `continuation_json` text;--> statement-breakpoint
ALTER TABLE `feed_sync_jobs` ADD `item_error` text;--> statement-breakpoint
DROP INDEX `feed_sync_jobs_claim`;
--> statement-breakpoint
CREATE INDEX `feed_sync_jobs_claim` ON `feed_sync_jobs` (`status`, `ready_sequence`, `job_id`);
--> statement-breakpoint
UPDATE `feed_sync_jobs` SET `item_error` = `error` WHERE `status` = 'Succeeded' AND `failed` > 0;
--> statement-breakpoint
UPDATE `feed_sync_jobs` SET `discovered` = 0, `archived` = 0, `failed` = 0 WHERE `status` = 'Failed';
