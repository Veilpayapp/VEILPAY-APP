-- VeilPay round-5 migration: onramp lifecycle states
-- Hand-written, then reconciled OFFLINE against:
--   npx prisma migrate diff \
--     --from-schema-datamodel /tmp/veilpay-stream-e/schema.pre-round5.prisma \
--     --to-schema-datamodel apps/backend/prisma/schema.prisma --script
-- which emitted EXACTLY:
--   -- AlterEnum
--   ALTER TYPE "FiatOrderStatus" ADD VALUE 'refunded';
-- No database was contacted while writing this file.
--
-- This migration contains the ADD VALUE statement ALONE (no other
-- statements): Postgres cannot combine ALTER TYPE ... ADD VALUE with
-- statements that USE the new enum value in the same transaction, and some
-- versions disallow ADD VALUE inside a transaction block entirely. Any
-- follow-up that references 'refunded' must live in a later migration.

-- AlterEnum
ALTER TYPE "FiatOrderStatus" ADD VALUE 'refunded';
