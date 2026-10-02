import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Round-4 migrations baseline guard.
 *
 * The prisma migration history was rebuilt offline:
 *   - `0_init` — from-empty baseline of the PRE-round-4 schema, generated
 *     with `npx prisma migrate diff --from-empty --to-schema-datamodel
 *     <snapshot> --script` (replacing the two stale hand-written 2026-07-14
 *     ALTER-only migrations that were never coherent with the db-push'd DB).
 *   - `1_webhook_secret_and_key_index` — the round-4 additions
 *     (merchants.webhook_secret + merchants_api_key_hash_idx), hand-written
 *     and reconciled against
 *     `npx prisma migrate diff --from-schema-datamodel <snapshot>
 *      --to-schema-datamodel schema.prisma --script`.
 *   - `2_onramp_states` — the round-5 onramp lifecycle addition
 *     (FiatOrderStatus.refunded), hand-written and reconciled the same way.
 *
 * These tests fail if anyone silently regresses the files or resurrects the
 * stale 20260714 directories.
 */
const migrationsDir = join(__dirname, '..', 'prisma', 'migrations');

function readMigration(name: string): string {
  return readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
}

describe('prisma migrations baseline (round 4)', () => {
  it('0_init is the from-empty baseline covering every table', () => {
    const sql = readMigration('0_init');
    for (const table of [
      'merchants',
      'chain_viewing_keys',
      'invoices',
      'payments',
      'processed_blocks',
      'webhook_deliveries',
      'fiat_orders',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    // enums the models depend on
    for (const enumName of [
      'MerchantStatus',
      'MerchantTier',
      'InvoiceStatus',
      'PaymentStatus',
      'ChainType',
      'PrivacyLevel',
      'WebhookDeliveryStatus',
      'FiatOrderStatus',
      'FiatFlow',
    ]) {
      expect(sql).toContain(`CREATE TYPE "${enumName}"`);
    }
    // baseline documents itself as generated offline from the pre-round-4 snapshot
    expect(sql).toMatch(/from-empty baseline of the PRE-ROUND-4 schema/i);
    expect(sql).toMatch(/OFFLINE/i);
  });

  it('0_init must NOT contain the round-4 additions (they live in migration 1)', () => {
    const sql = readMigration('0_init');
    expect(sql).not.toContain('webhook_secret');
    expect(sql).not.toContain('merchants_api_key_hash_idx');
  });

  it('1_webhook_secret_and_key_index adds the nullable webhook_secret column and the api_key_hash index', () => {
    const sql = readMigration('1_webhook_secret_and_key_index');
    // decisive statements — semantically identical to the prisma-generated diff
    expect(sql).toMatch(/ALTER TABLE "merchants" ADD COLUMN\s+"webhook_secret" TEXT/);
    expect(sql).toContain(
      'CREATE INDEX "merchants_api_key_hash_idx" ON "merchants"("api_key_hash")'
    );
    // additive-only migration: nothing dropped or narrowed
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/NOT NULL/);
  });

  it('the two stale 20260714 migrations are gone (replaced by 0_init)', () => {
    expect(
      existsSync(join(migrationsDir, '20260714000000_chain_type_xlm_token_address'))
    ).toBe(false);
    expect(
      existsSync(join(migrationsDir, '20260714010000_privacy_level_stealth_private'))
    ).toBe(false);
    // the lock file survives; the on-disk history is exactly 0_init + 1 + 2
    const entries = readdirSync(migrationsDir)
      .filter((e) => e !== 'migration_lock.toml')
      .sort();
    expect(existsSync(join(migrationsDir, 'migration_lock.toml'))).toBe(true);
    expect(entries).toEqual(['0_init', '1_webhook_secret_and_key_index', '2_onramp_states']);
  });

  it('2_onramp_states adds ONLY the refunded enum value (round 5)', () => {
    const sql = readMigration('2_onramp_states');
    expect(sql).toContain(`ALTER TYPE "FiatOrderStatus" ADD VALUE 'refunded'`);
    // ADD VALUE must be the ONLY statement in its own migration (Postgres
    // cannot combine it with usage of the new value; some versions disallow
    // it inside a transaction block entirely).
    const statements = sql
      .split(';')
      .map((s) => s.replace(/--[^\n]*/g, '').trim())
      .filter((s) => s.length > 0);
    expect(statements).toEqual([`ALTER TYPE "FiatOrderStatus" ADD VALUE 'refunded'`]);
    // additive-only migration: nothing dropped or narrowed
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/NOT NULL/);
  });

  it('migration 1 documents its offline reconciliation against prisma migrate diff', () => {
    const sql = readMigration('1_webhook_secret_and_key_index');
    expect(sql).toMatch(/reconciled OFFLINE/i);
    expect(sql).toMatch(/migrate diff/);
  });
});
