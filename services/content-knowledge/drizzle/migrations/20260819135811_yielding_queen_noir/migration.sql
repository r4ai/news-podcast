CREATE TABLE `article_owner_access` (
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`acquired_at` text NOT NULL,
	CONSTRAINT `article_owner_access_pk` PRIMARY KEY(`owner_id`, `article_id`),
	CONSTRAINT `fk_article_owner_access_article_id_feed_items_article_id_fk` FOREIGN KEY (`article_id`) REFERENCES `feed_items`(`article_id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE INDEX `article_owner_access_owner` ON `article_owner_access` (`owner_id`,`acquired_at`,`article_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `article_owner_access` (`owner_id`, `article_id`, `acquired_at`)
SELECT subscriptions.`owner_id`, items.`article_id`,
       MAX(subscriptions.`created_at`, items.`discovered_at`)
FROM `feed_subscriptions` AS subscriptions
INNER JOIN `feed_items` AS items ON items.`feed_id` = subscriptions.`feed_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `article_owner_access` (`owner_id`, `article_id`, `acquired_at`)
SELECT states.`owner_id`, states.`article_id`, states.`updated_at`
FROM `article_owner_states` AS states;
