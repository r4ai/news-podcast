ALTER TABLE `user_settings` ADD `last_scheduled_day` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `last_scheduled_completion` text;
--> statement-breakpoint
UPDATE `user_settings` SET `last_scheduled_day` = CAST(julianday(`last_scheduled_local_date`) - 2440587.5 AS INTEGER) WHERE `last_scheduled_local_date` IS NOT NULL;
