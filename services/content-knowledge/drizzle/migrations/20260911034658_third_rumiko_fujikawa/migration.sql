CREATE TABLE `archive_refresh_jobs` (
	`job_id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`context_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`deadline_at` text NOT NULL,
	`completed_at` text,
	`error` text,
	CONSTRAINT `fk_archive_refresh_jobs_article_id_feed_items_article_id_fk` FOREIGN KEY (`article_id`) REFERENCES `feed_items`(`article_id`) ON DELETE CASCADE,
	CONSTRAINT "archive_refresh_status" CHECK("status" IN ('queued', 'processing', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archive_refresh_active_article` ON `archive_refresh_jobs` (`owner_id`,`article_id`) WHERE "archive_refresh_jobs"."status" IN ('queued', 'processing');--> statement-breakpoint
CREATE INDEX `archive_refresh_status_created` ON `archive_refresh_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `archive_refresh_owner_created` ON `archive_refresh_jobs` (`owner_id`,`created_at`);