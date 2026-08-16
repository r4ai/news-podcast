ALTER TABLE `episode_sources` ADD `article_id` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_episode_sources` (
	`episode_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_kind` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`article_id` text,
	`published_at` text,
	`snapshot_id` text,
	CONSTRAINT `episode_sources_pk` PRIMARY KEY(`episode_id`, `position`),
	CONSTRAINT `fk_episode_sources_episode_id_episodes_id_fk` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "episode_sources_position_check" CHECK("position" >= 0),
	CONSTRAINT "episode_sources_kind_check" CHECK("source_kind" IN ('rss', 'web')),
	CONSTRAINT "episode_sources_provenance_check" CHECK(("source_kind" = 'rss' AND "snapshot_id" IS NOT NULL) OR ("source_kind" = 'web' AND "article_id" IS NULL AND "snapshot_id" IS NULL AND "published_at" IS NULL))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_episode_sources`(`episode_id`, `position`, `source_kind`, `url`, `title`, `published_at`, `snapshot_id`) SELECT `episode_id`, `position`, `source_kind`, `url`, `title`, `published_at`, `snapshot_id` FROM `episode_sources`;--> statement-breakpoint
DROP TABLE `episode_sources`;--> statement-breakpoint
ALTER TABLE `__new_episode_sources` RENAME TO `episode_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
