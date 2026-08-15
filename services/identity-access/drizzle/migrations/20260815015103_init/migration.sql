CREATE TABLE `user_settings` (
	`owner_id` text PRIMARY KEY,
	`schedule_enabled` integer DEFAULT 0 NOT NULL,
	`schedule_local_time` text DEFAULT '07:30' NOT NULL,
	`schedule_time_zone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`last_scheduled_local_date` text,
	CONSTRAINT "user_settings_schedule_enabled_check" CHECK("schedule_enabled" IN (0, 1))
) STRICT;
