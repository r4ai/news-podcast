CREATE TABLE `article_owner_states` (
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`saved` integer DEFAULT 0 NOT NULL,
	`read_later` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`hidden_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `article_owner_states_pk` PRIMARY KEY(`owner_id`, `article_id`),
	CONSTRAINT `fk_article_owner_states_article_id_feed_items_article_id_fk` FOREIGN KEY (`article_id`) REFERENCES `feed_items`(`article_id`) ON DELETE CASCADE,
	CONSTRAINT "article_owner_states_read_check" CHECK("read" IN (0, 1)),
	CONSTRAINT "article_owner_states_saved_check" CHECK("saved" IN (0, 1)),
	CONSTRAINT "article_owner_states_read_later_check" CHECK("read_later" IN (0, 1)),
	CONSTRAINT "article_owner_states_hidden_check" CHECK("hidden" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `article_snapshots` (
	`archive_request_id` text PRIMARY KEY,
	`snapshot_id` text NOT NULL UNIQUE,
	`article_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`captured_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `content_article_tags` (
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real,
	`created_at` text NOT NULL,
	CONSTRAINT `content_article_tags_pk` PRIMARY KEY(`owner_id`, `article_id`, `tag_id`),
	CONSTRAINT `fk_content_article_tags_article_id_feed_items_article_id_fk` FOREIGN KEY (`article_id`) REFERENCES `feed_items`(`article_id`) ON DELETE CASCADE,
	CONSTRAINT `content_article_tags_tag_fk` FOREIGN KEY (`owner_id`,`tag_id`) REFERENCES `content_tags`(`owner_id`,`tag_id`) ON DELETE CASCADE,
	CONSTRAINT "content_article_tags_source_check" CHECK("source" IN ('Manual', 'Ai')),
	CONSTRAINT "content_article_tags_confidence_check" CHECK("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `content_enrichment_daily_progress` (
	`local_date` text PRIMARY KEY,
	`processed_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "content_enrichment_daily_progress_count_check" CHECK("processed_count" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `content_enrichment_queue` (
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`priority` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_expires_at` text,
	`published_at` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error` text,
	CONSTRAINT `content_enrichment_queue_pk` PRIMARY KEY(`owner_id`, `article_id`),
	CONSTRAINT `fk_content_enrichment_queue_article_id_feed_items_article_id_fk` FOREIGN KEY (`article_id`) REFERENCES `feed_items`(`article_id`) ON DELETE CASCADE,
	CONSTRAINT "content_enrichment_queue_reason_check" CHECK("reason" IN ('New', 'Reprocess')),
	CONSTRAINT "content_enrichment_queue_status_check" CHECK("status" IN ('Queued', 'Processing', 'Succeeded', 'Failed')),
	CONSTRAINT "content_enrichment_queue_attempt_check" CHECK("attempt" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `content_enrichment_results` (
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`score` integer,
	`reason` text,
	`error` text,
	`tokens_in` integer NOT NULL,
	`tokens_out` integer NOT NULL,
	`completed_at` text NOT NULL,
	CONSTRAINT `content_enrichment_results_pk` PRIMARY KEY(`owner_id`, `article_id`),
	CONSTRAINT `fk_content_enrichment_results_article_id_feed_items_article_id_fk` FOREIGN KEY (`article_id`) REFERENCES `feed_items`(`article_id`) ON DELETE CASCADE,
	CONSTRAINT "content_enrichment_results_status_check" CHECK("status" IN ('Succeeded', 'Failed')),
	CONSTRAINT "content_enrichment_results_score_check" CHECK("score" IS NULL OR ("score" >= 0 AND "score" <= 100)),
	CONSTRAINT "content_enrichment_results_tokens_in_check" CHECK("tokens_in" >= 0),
	CONSTRAINT "content_enrichment_results_tokens_out_check" CHECK("tokens_out" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `content_interest_profiles` (
	`owner_id` text PRIMARY KEY,
	`include_topics` text NOT NULL,
	`exclude_topics` text NOT NULL,
	`updated_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `content_outbox` (
	`message_id` text PRIMARY KEY,
	`archive_request_id` text NOT NULL UNIQUE,
	`subject` text NOT NULL,
	`envelope_json` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	CONSTRAINT `fk_content_outbox_archive_request_id_article_snapshots_archive_request_id_fk` FOREIGN KEY (`archive_request_id`) REFERENCES `article_snapshots`(`archive_request_id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `content_tag_suggestions` (
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`last_seen_at` text NOT NULL,
	CONSTRAINT `content_tag_suggestions_pk` PRIMARY KEY(`owner_id`, `name`),
	CONSTRAINT "content_tag_suggestions_occurrences_check" CHECK("occurrences" > 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `content_tags` (
	`tag_id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `content_tags_owner_name` UNIQUE(`owner_id`,`name`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `feed_catalog` (
	`feed_id` text PRIMARY KEY,
	`feed_url` text NOT NULL UNIQUE,
	`created_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `feed_items` (
	`article_id` text PRIMARY KEY,
	`feed_id` text NOT NULL,
	`external_id` text NOT NULL,
	`source_url` text NOT NULL,
	`title` text NOT NULL,
	`published_at` text,
	`discovered_at` text NOT NULL,
	CONSTRAINT `fk_feed_items_feed_id_feed_catalog_feed_id_fk` FOREIGN KEY (`feed_id`) REFERENCES `feed_catalog`(`feed_id`) ON DELETE CASCADE,
	CONSTRAINT `feed_items_feed_external` UNIQUE(`feed_id`,`external_id`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `feed_subscriptions` (
	`subscription_id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`feed_id` text NOT NULL,
	`created_at` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_feed_subscriptions_feed_id_feed_catalog_feed_id_fk` FOREIGN KEY (`feed_id`) REFERENCES `feed_catalog`(`feed_id`) ON DELETE CASCADE,
	CONSTRAINT `feed_subscriptions_owner_feed` UNIQUE(`owner_id`,`feed_id`),
	CONSTRAINT "feed_subscriptions_enabled_check" CHECK("enabled" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `feed_sync_jobs` (
	`job_id` text PRIMARY KEY,
	`feed_id` text NOT NULL UNIQUE,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` text,
	`discovered` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	CONSTRAINT `fk_feed_sync_jobs_feed_id_feed_catalog_feed_id_fk` FOREIGN KEY (`feed_id`) REFERENCES `feed_catalog`(`feed_id`) ON DELETE CASCADE,
	CONSTRAINT "feed_sync_jobs_status_check" CHECK("status" IN ('Queued', 'Processing', 'Succeeded', 'Failed')),
	CONSTRAINT "feed_sync_jobs_attempt_check" CHECK("attempt" >= 0 AND "attempt" <= 4),
	CONSTRAINT "feed_sync_jobs_discovered_check" CHECK("discovered" >= 0),
	CONSTRAINT "feed_sync_jobs_archived_check" CHECK("archived" >= 0),
	CONSTRAINT "feed_sync_jobs_failed_check" CHECK("failed" >= 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `article_owner_states_owner` ON `article_owner_states` (`owner_id`,`updated_at`,`article_id`);--> statement-breakpoint
CREATE INDEX `article_snapshots_latest` ON `article_snapshots` (`article_id`,"captured_at" DESC,"snapshot_id" DESC);--> statement-breakpoint
CREATE INDEX `content_article_tags_article` ON `content_article_tags` (`owner_id`,`article_id`,`source`);--> statement-breakpoint
CREATE INDEX `content_enrichment_queue_claim` ON `content_enrichment_queue` (`owner_id`,`status`,`priority`,`published_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_outbox_pending` ON `content_outbox` (`created_at`,`message_id`) WHERE "content_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `content_tags_owner_tag` ON `content_tags` (`owner_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `feed_items_latest` ON `feed_items` (`feed_id`,"published_at" DESC,"discovered_at" DESC,"article_id" DESC);--> statement-breakpoint
CREATE INDEX `feed_subscriptions_owner` ON `feed_subscriptions` (`owner_id`,`created_at`,`subscription_id`);--> statement-breakpoint
CREATE INDEX `feed_sync_jobs_claim` ON `feed_sync_jobs` (`status`,`created_at`,`job_id`);