-- VeilPay round-4 migration: per-merchant webhook secret + api_key_hash index
-- Hand-written, then reconciled OFFLINE against:
--   npx prisma migrate diff \
--     --from-schema-datamodel <pre-round-4 snapshot> \
--     --to-schema-datamodel apps/backend/prisma/schema.prisma --script
-- Expected (prisma-generated) statements:
--   ALTER TABLE "merchants" ADD COLUMN "webhook_secret" TEXT;
--   CREATE INDEX "merchants_api_key_hash_idx" ON "merchants"("api_key_hash");
-- The statements below match those semantically (nullable TEXT column named
-- webhook_secret on merchants; btree index merchants_api_key_hash_idx over
-- merchants.api_key_hash). No database was contacted while writing this file.

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN "webhook_secret" TEXT;

-- CreateIndex
-- Turns the auth lookup (findFirst WHERE api_key_hash = <hash> AND status)
-- from a sequential scan into an index probe.
CREATE INDEX "merchants_api_key_hash_idx" ON "merchants"("api_key_hash");
