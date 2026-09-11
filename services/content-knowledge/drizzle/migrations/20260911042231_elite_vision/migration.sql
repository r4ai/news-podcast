ALTER TABLE `feed_sync_jobs` ADD `ready_sequence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `feed_sync_jobs` ADD `continuation_json` text;