CREATE TABLE `episode_completion_inbox` (
	`message_id` text PRIMARY KEY,
	`episode_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`received_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `episode_sources` (
	`episode_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_kind` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`published_at` text,
	`snapshot_id` text,
	CONSTRAINT `episode_sources_pk` PRIMARY KEY(`episode_id`, `position`),
	CONSTRAINT `fk_episode_sources_episode_id_episodes_id_fk` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "episode_sources_position_check" CHECK("position" >= 0),
	CONSTRAINT "episode_sources_kind_check" CHECK("source_kind" IN ('rss', 'web')),
	CONSTRAINT "episode_sources_provenance_check" CHECK(("source_kind" = 'rss' AND "snapshot_id" IS NOT NULL) OR ("source_kind" = 'web' AND "snapshot_id" IS NULL AND "published_at" IS NULL))
) STRICT;
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`script` text NOT NULL,
	`audio_object_key` text NOT NULL,
	`audio_byte_length` integer NOT NULL,
	`audio_content_type` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "episodes_audio_byte_length_check" CHECK("audio_byte_length" > 0),
	CONSTRAINT "episodes_audio_content_type_check" CHECK("audio_content_type" IN ('audio/wav', 'audio/mpeg'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `episodes_owner_created_idx` ON `episodes` (`owner_id`,"created_at" DESC,"id" DESC);