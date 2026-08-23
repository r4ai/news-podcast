DROP INDEX IF EXISTS `episode_jobs_execution_state`;--> statement-breakpoint
CREATE INDEX `episode_jobs_execution_priority` ON `episode_jobs` (CASE "status"
            WHEN 'Running' THEN 0
            WHEN 'Retrying' THEN 1
            WHEN 'Queued' THEN 2
            ELSE 3
          END,CASE "status"
            WHEN 'Running' THEN "leased_until"
            WHEN 'Retrying' THEN "retry_at"
            WHEN 'Queued' THEN "enqueued_at"
            ELSE "created_at"
          END,`job_id`);