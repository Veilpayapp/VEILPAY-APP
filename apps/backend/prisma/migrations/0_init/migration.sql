-- VeilPay baseline migration (0_init)
-- Generated OFFLINE via: npx prisma migrate diff --from-empty --to-schema-datamodel <pre-round-4 schema snapshot>
-- This is the from-empty baseline of the PRE-ROUND-4 schema (snapshot:
-- /c/Users/vahi1/.zcode/tmp/p4-tmp/schema.pre-round4.prisma, sha256
-- 3a40d068c4549c16599a99fe7c8fc92ccec63580f11e7e06e198417652664c31).
-- It REPLACES the two stale hand-written 2026-07-14 migrations
-- (20260714000000_chain_type_xlm_token_address,
-- 20260714010000_privacy_level_stealth_private), which were ALTER-only patches
-- on a db-push'd database and were never a coherent from-empty history.
-- No database was contacted while generating this file.

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('pending', 'active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "MerchantTier" AS ENUM ('basic', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('pending', 'paid', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "ChainType" AS ENUM ('evm', 'svm', 'xlm');

-- CreateEnum
CREATE TYPE "PrivacyLevel" AS ENUM ('standard', 'stealth', 'max', 'private');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'retrying', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "FiatOrderStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "FiatFlow" AS ENUM ('buy', 'sell');

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "business_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "webhook_url" VARCHAR(500),
    "api_key_hash" VARCHAR(255) NOT NULL,
    "tier" "MerchantTier" NOT NULL DEFAULT 'basic',
    "status" "MerchantStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_viewing_keys" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "chain_type" "ChainType" NOT NULL,
    "chain_key" VARCHAR(50) NOT NULL,
    "viewing_key" TEXT NOT NULL,
    "settlement_address" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chain_viewing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "chain_key" VARCHAR(50) NOT NULL,
    "token_symbol" VARCHAR(20) NOT NULL,
    "token_address" VARCHAR(100),
    "amount" VARCHAR(50) NOT NULL,
    "amount_usd" VARCHAR(50),
    "memo" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'pending',
    "privacy_level" "PrivacyLevel" NOT NULL DEFAULT 'standard',
    "payment_address" VARCHAR(100),
    "payment_tx_hash" VARCHAR(100),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "merchant_id" TEXT NOT NULL,
    "chain_key" VARCHAR(50) NOT NULL,
    "tx_hash" VARCHAR(100) NOT NULL,
    "from_address" VARCHAR(100) NOT NULL,
    "to_address" VARCHAR(100) NOT NULL,
    "amount" VARCHAR(50) NOT NULL,
    "token_symbol" VARCHAR(20) NOT NULL,
    "privacy_level" "PrivacyLevel" NOT NULL,
    "nullifier" VARCHAR(100),
    "commitment" VARCHAR(100),
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "block_number" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_blocks" (
    "id" TEXT NOT NULL,
    "chain_key" VARCHAR(50) NOT NULL,
    "block_number" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "status_code" INTEGER,
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiat_orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT,
    "provider" VARCHAR(50) NOT NULL,
    "user_address" VARCHAR(100) NOT NULL,
    "fiat_amount" VARCHAR(50) NOT NULL,
    "fiat_currency" VARCHAR(10) NOT NULL,
    "crypto_amount" VARCHAR(50),
    "crypto_token" VARCHAR(20) NOT NULL,
    "chain_key" VARCHAR(50) NOT NULL,
    "status" "FiatOrderStatus" NOT NULL DEFAULT 'pending',
    "flow" "FiatFlow" NOT NULL,
    "tx_hash" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiat_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_email_key" ON "merchants"("email");

-- CreateIndex
CREATE INDEX "merchants_email_idx" ON "merchants"("email");

-- CreateIndex
CREATE INDEX "merchants_status_idx" ON "merchants"("status");

-- CreateIndex
CREATE INDEX "chain_viewing_keys_merchant_id_idx" ON "chain_viewing_keys"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "chain_viewing_keys_merchant_id_chain_key_key" ON "chain_viewing_keys"("merchant_id", "chain_key");

-- CreateIndex
CREATE INDEX "invoices_merchant_id_idx" ON "invoices"("merchant_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_expires_at_idx" ON "invoices"("expires_at");

-- CreateIndex
CREATE INDEX "payments_merchant_id_idx" ON "payments"("merchant_id");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_timestamp_idx" ON "payments"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "payments_chain_key_tx_hash_key" ON "payments"("chain_key", "tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "processed_blocks_chain_key_key" ON "processed_blocks"("chain_key");

-- CreateIndex
CREATE INDEX "webhook_deliveries_merchant_id_idx" ON "webhook_deliveries"("merchant_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries"("status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries"("created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_next_retry_at_idx" ON "webhook_deliveries"("next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "fiat_orders_order_id_key" ON "fiat_orders"("order_id");

-- CreateIndex
CREATE INDEX "fiat_orders_user_address_idx" ON "fiat_orders"("user_address");

-- CreateIndex
CREATE INDEX "fiat_orders_status_idx" ON "fiat_orders"("status");

-- AddForeignKey
ALTER TABLE "chain_viewing_keys" ADD CONSTRAINT "chain_viewing_keys_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

