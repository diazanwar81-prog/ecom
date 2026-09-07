-- ECOM dedupe unique constraints (ops-p2 productDedupeKey + webhook order idempotency)
-- PostgreSQL: multiple NULLs are allowed in UNIQUE columns.

-- Product.dedupeKey
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_storeId_dedupeKey_key" ON "Product"("storeId", "dedupeKey");

CREATE INDEX IF NOT EXISTS "Product_dedupeKey_idx" ON "Product"("dedupeKey");

CREATE INDEX IF NOT EXISTS "Product_externalId_idx" ON "Product"("externalId");

-- ProductSupplier.cjVariantId unique when set
DROP INDEX IF EXISTS "ProductSupplier_cjVariantId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "ProductSupplier_cjVariantId_key" ON "ProductSupplier"("cjVariantId");

CREATE INDEX IF NOT EXISTS "ProductSupplier_cjSku_idx" ON "ProductSupplier"("cjSku");

-- Order unique (storeId, externalId) for webhook idempotency
DROP INDEX IF EXISTS "Order_externalId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "Order_storeId_externalId_key" ON "Order"("storeId", "externalId");

CREATE INDEX IF NOT EXISTS "Order_externalId_idx" ON "Order"("externalId");
