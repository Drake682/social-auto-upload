BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE users SET tenant_id = id WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);

UPDATE trends SET platform = 'unknown' WHERE platform IS NULL;
UPDATE trends SET keyword = 'unknown' WHERE keyword IS NULL;
UPDATE trends SET extracted_at = NOW() WHERE extracted_at IS NULL;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE accounts a
SET tenant_id = u.tenant_id
FROM users u
WHERE a.user_id = u.id AND a.tenant_id IS NULL;
UPDATE accounts SET tenant_id = user_id WHERE tenant_id IS NULL;
ALTER TABLE accounts ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_tenant_user ON accounts (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_tenant_id_id ON accounts (tenant_id, id);

ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE video_jobs v
SET tenant_id = u.tenant_id
FROM users u
WHERE v.user_id = u.id AND v.tenant_id IS NULL;
UPDATE video_jobs SET tenant_id = user_id WHERE tenant_id IS NULL;
ALTER TABLE video_jobs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE video_jobs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS source_s3_uri VARCHAR(500);
CREATE INDEX IF NOT EXISTS idx_video_jobs_tenant_user ON video_jobs (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_tenant_id_id ON video_jobs (tenant_id, id);

DO $$
BEGIN
  IF to_regclass('public.upload_jobs') IS NOT NULL THEN
    ALTER TABLE upload_jobs ADD COLUMN IF NOT EXISTS user_id INTEGER;
    ALTER TABLE upload_jobs ADD COLUMN IF NOT EXISTS tenant_id INTEGER;

    UPDATE upload_jobs uj
    SET user_id = v.user_id,
        tenant_id = v.tenant_id
    FROM video_jobs v
    WHERE uj.video_job_id = v.id
      AND (uj.user_id IS NULL OR uj.tenant_id IS NULL);

    UPDATE upload_jobs uj
    SET user_id = a.user_id,
        tenant_id = a.tenant_id
    FROM accounts a
    WHERE uj.account_id = a.id
      AND (uj.user_id IS NULL OR uj.tenant_id IS NULL);

    UPDATE upload_jobs
    SET user_id = COALESCE(user_id, (SELECT id FROM users ORDER BY id LIMIT 1)),
        tenant_id = COALESCE(tenant_id, (SELECT tenant_id FROM users ORDER BY id LIMIT 1))
    WHERE user_id IS NULL OR tenant_id IS NULL;

    ALTER TABLE upload_jobs ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE upload_jobs ALTER COLUMN tenant_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_upload_jobs_tenant_user ON upload_jobs (tenant_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_upload_jobs_tenant_id_id ON upload_jobs (tenant_id, id);
  END IF;
END $$;

COMMIT;
