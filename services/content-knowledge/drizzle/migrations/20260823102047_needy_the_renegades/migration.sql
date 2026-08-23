CREATE TABLE `article_search_index_queue` (
	`snapshot_id` text PRIMARY KEY,
	`article_id` text NOT NULL,
	`markdown_key` text NOT NULL,
	`enqueued_at` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`last_failure` text,
	CONSTRAINT `fk_article_search_index_queue_snapshot_id_article_snapshots_snapshot_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `article_snapshots`(`snapshot_id`) ON DELETE CASCADE,
	CONSTRAINT "article_search_index_queue_attempt_check" CHECK("attempt" >= 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `article_search_index_queue_pending` ON `article_search_index_queue` (`attempt`,`enqueued_at`,`snapshot_id`);
