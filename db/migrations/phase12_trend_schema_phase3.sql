BEGIN;

ALTER TABLE trends ADD COLUMN IF NOT EXISTS title VARCHAR(500);
ALTER TABLE trends ADD COLUMN IF NOT EXISTS views DOUBLE PRECISION;
ALTER TABLE trends ADD COLUMN IF NOT EXISTS region VARCHAR(100) DEFAULT 'global';
ALTER TABLE trends ADD COLUMN IF NOT EXISTS crawled_at TIMESTAMP;
ALTER TABLE trends ADD COLUMN IF NOT EXISTS run_id UUID;

UPDATE trends SET title = keyword WHERE title IS NULL AND keyword IS NOT NULL;
UPDATE trends SET views = volume WHERE views IS NULL AND volume IS NOT NULL;
UPDATE trends SET region = 'global' WHERE region IS NULL;
UPDATE trends SET crawled_at = extracted_at WHERE crawled_at IS NULL AND extracted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trends_platform_region_crawled
  ON trends (platform, region, crawled_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trends_dedupe_run
  ON trends (COALESCE(tenant_id, 0), platform, region, run_id, keyword)
  WHERE run_id IS NOT NULL;

COMMIT;
