CREATE TABLE `article_search_short_grams` (
	`snapshot_id` text NOT NULL,
	`gram` text NOT NULL,
	CONSTRAINT `article_search_short_grams_pk` PRIMARY KEY(`snapshot_id`, `gram`),
	CONSTRAINT `fk_article_search_short_grams_snapshot_id_article_snapshots_snapshot_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `article_snapshots`(`snapshot_id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE INDEX `article_search_short_grams_lookup` ON `article_search_short_grams` (`gram`,`snapshot_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `article_search_fts` USING fts5(
	`snapshot_id` UNINDEXED,
	`article_id` UNINDEXED,
	`body`,
	tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `article_search_index_queue_after_snapshot_insert`
AFTER INSERT ON `article_snapshots`
WHEN json_extract(NEW.`snapshot_json`, '$.capture.markdown.key') IS NOT NULL
BEGIN
	INSERT OR IGNORE INTO `article_search_index_queue`
		(`snapshot_id`, `article_id`, `markdown_key`, `enqueued_at`)
	VALUES (
		NEW.`snapshot_id`,
		NEW.`article_id`,
		json_extract(NEW.`snapshot_json`, '$.capture.markdown.key'),
		NEW.`captured_at`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `article_search_index_after_snapshot_delete`
AFTER DELETE ON `article_snapshots`
BEGIN
	DELETE FROM `article_search_fts` WHERE `snapshot_id` = OLD.`snapshot_id`;
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `article_search_index_queue`
	(`snapshot_id`, `article_id`, `markdown_key`, `enqueued_at`)
SELECT
	`snapshot_id`,
	`article_id`,
	json_extract(`snapshot_json`, '$.capture.markdown.key'),
	`captured_at`
FROM `article_snapshots`
WHERE json_extract(`snapshot_json`, '$.capture.markdown.key') IS NOT NULL;
