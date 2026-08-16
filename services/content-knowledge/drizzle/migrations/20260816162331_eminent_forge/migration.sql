PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_content_enrichment_daily_progress` (
	`owner_id` text NOT NULL,
	`local_date` text NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `content_enrichment_daily_progress_pk` PRIMARY KEY(`owner_id`, `local_date`),
	CONSTRAINT "content_enrichment_daily_progress_count_check" CHECK("processed_count" >= 0)
) STRICT;
--> statement-breakpoint
-- The old counter was global and cannot be attributed to an owner safely.
-- It is a transient daily allowance, so migration intentionally starts each
-- owner's counter at zero instead of leaking one tenant's usage to another.
DROP TABLE `content_enrichment_daily_progress`;--> statement-breakpoint
ALTER TABLE `__new_content_enrichment_daily_progress` RENAME TO `content_enrichment_daily_progress`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
