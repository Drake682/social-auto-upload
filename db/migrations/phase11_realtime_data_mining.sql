BEGIN;

ALTER TABLE trends ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE trends ADD COLUMN IF NOT EXISTS trend_type VARCHAR(20) DEFAULT 'video';
ALTER TABLE trends ADD COLUMN IF NOT EXISTS source_url VARCHAR(500);
UPDATE trends SET trend_type = 'video' WHERE trend_type IS NULL;
ALTER TABLE trends ALTER COLUMN trend_type SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trends_tenant_platform ON trends (tenant_id, platform);
CREATE INDEX IF NOT EXISTS idx_trends_platform_type_extracted ON trends (platform, trend_type, extracted_at);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS affiliate_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  platform VARCHAR(20) NOT NULL,
  product_url VARCHAR(1000) NOT NULL,
  product_name VARCHAR(500) NOT NULL,
  price DOUBLE PRECISION,
  commission_rate DOUBLE PRECISION,
  extracted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_tenant_platform
  ON affiliate_products (tenant_id, platform);
CREATE INDEX IF NOT EXISTS idx_affiliate_products_extracted_at
  ON affiliate_products (extracted_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_products_product_url
  ON affiliate_products (product_url);

COMMIT;
