CREATE TABLE `public_feed_listings` (
	`feed_id` text PRIMARY KEY,
	`listed_at` text NOT NULL,
	CONSTRAINT `fk_public_feed_listings_feed_id_feed_catalog_feed_id_fk` FOREIGN KEY (`feed_id`) REFERENCES `feed_catalog`(`feed_id`) ON DELETE CASCADE
) STRICT;
