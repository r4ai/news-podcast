CREATE TRIGGER episode_jobs_owner_active_admission_insert
BEFORE INSERT ON episode_jobs
WHEN NEW.status IN ('Queued', 'Running', 'Retrying')
 AND EXISTS (
   SELECT 1 FROM episode_jobs
   WHERE owner_id = NEW.owner_id
     AND status IN ('Queued', 'Running', 'Retrying')
 )
BEGIN
  SELECT RAISE(ABORT, 'owner_active_job_exists');
END;
--> statement-breakpoint
CREATE TRIGGER episode_jobs_owner_active_admission_update
BEFORE UPDATE OF status ON episode_jobs
WHEN NEW.status IN ('Queued', 'Running', 'Retrying')
 AND EXISTS (
   SELECT 1 FROM episode_jobs
   WHERE owner_id = NEW.owner_id
     AND job_id <> NEW.job_id
     AND status IN ('Queued', 'Running', 'Retrying')
 )
BEGIN
  SELECT RAISE(ABORT, 'owner_active_job_exists');
END;
