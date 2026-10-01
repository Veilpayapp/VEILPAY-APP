/* eslint-disable no-console */
/**
 * Retention purge job (PRIV-207 / INFRA-103).
 *
 * Runs periodically to prune old terminal-state rows from the database,
 * keeping the database size bounded. Uses batched deleteMany with a Redis
 * lock to prevent concurrent runs.
 *
 * Prunes:
 *   - WebhookDelivery rows in terminal states (delivered, failed) older than
 *     RETENTION_WEBHOOK_DAYS (default 30)
 *   - FiatOrder rows in terminal states (completed, failed, cancelled) older
 *     than RETENTION_FIAT_DAYS (default 90)
 *   - Payment rows with invoiceId = null and status = failed older than
 *     RETENTION_PAYMENT_DAYS (default 90)
 */

import { prisma } from '../lib/prisma';
import { withRedisLock } from '../lib/redisLock';
import { config } from '../config';

const BATCH_SIZE = 1000;

export interface RetentionConfig {
  webhookDays: number;
  fiatDays: number;
  paymentDays: number;
  intervalMs: number;
  enabled: boolean;
}

function getConfig(): RetentionConfig {
  return {
    webhookDays: config.retention.webhookDays,
    fiatDays: config.retention.fiatDays,
    paymentDays: config.retention.paymentDays,
    intervalMs: config.retention.intervalMs,
    enabled: config.retention.enabled,
  };
}

/**
 * Prune old WebhookDelivery rows in terminal states.
 */
async function pruneWebhookDeliveries(cutoff: Date): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const ids = await prisma.webhookDelivery.findMany({
      where: {
        status: { in: ['delivered', 'failed'] },
        createdAt: { lt: cutoff },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (ids.length === 0) break;
    const idList = ids.map((row) => row.id);
    const result = await prisma.webhookDelivery.deleteMany({
      where: { id: { in: idList } },
    });
    totalDeleted += result.count;
    if (ids.length < BATCH_SIZE) break;
  }
  return totalDeleted;
}

/**
 * Prune old FiatOrder rows in terminal states.
 */
async function pruneFiatOrders(cutoff: Date): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const ids = await prisma.fiatOrder.findMany({
      where: {
        status: { in: ['completed', 'failed', 'cancelled'] },
        createdAt: { lt: cutoff },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (ids.length === 0) break;
    const idList = ids.map((row) => row.id);
    const result = await prisma.fiatOrder.deleteMany({
      where: { id: { in: idList } },
    });
    totalDeleted += result.count;
    if (ids.length < BATCH_SIZE) break;
  }
  return totalDeleted;
}

/**
 * Prune old Payment rows with invoiceId = null and status = failed.
 */
async function prunePayments(cutoff: Date): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const ids = await prisma.payment.findMany({
      where: {
        invoiceId: null,
        status: 'failed',
        timestamp: { lt: cutoff },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (ids.length === 0) break;
    const idList = ids.map((row) => row.id);
    const result = await prisma.payment.deleteMany({
      where: { id: { in: idList } },
    });
    totalDeleted += result.count;
    if (ids.length < BATCH_SIZE) break;
  }
  return totalDeleted;
}

/**
 * Run a single retention purge sweep.
 * Returns the total number of rows deleted across all three tables.
 */
export async function runRetentionPurge(): Promise<number> {
  const cfg = getConfig();
  if (!cfg.enabled) {
    console.log('[RetentionPurge] Disabled by config');
    return 0;
  }

  const now = new Date();
  const webhookCutoff = new Date(now.getTime() - cfg.webhookDays * 24 * 60 * 60 * 1000);
  const fiatCutoff = new Date(now.getTime() - cfg.fiatDays * 24 * 60 * 60 * 1000);
  const paymentCutoff = new Date(now.getTime() - cfg.paymentDays * 24 * 60 * 60 * 1000);

  console.log(
    `[RetentionPurge] Starting sweep: webhookCutoff=${webhookCutoff.toISOString()}, ` +
    `fiatCutoff=${fiatCutoff.toISOString()}, paymentCutoff=${paymentCutoff.toISOString()}`
  );

  let total = 0;

  try {
    const webhookDeleted = await pruneWebhookDeliveries(webhookCutoff);
    total += webhookDeleted;
    console.log(`[RetentionPurge] Deleted ${webhookDeleted} webhook deliveries`);
  } catch (err) {
    console.error('[RetentionPurge] Error pruning webhook deliveries:', err);
  }

  try {
    const fiatDeleted = await pruneFiatOrders(fiatCutoff);
    total += fiatDeleted;
    console.log(`[RetentionPurge] Deleted ${fiatDeleted} fiat orders`);
  } catch (err) {
    console.error('[RetentionPurge] Error pruning fiat orders:', err);
  }

  try {
    const paymentDeleted = await prunePayments(paymentCutoff);
    total += paymentDeleted;
    console.log(`[RetentionPurge] Deleted ${paymentDeleted} payments`);
  } catch (err) {
    console.error('[RetentionPurge] Error pruning payments:', err);
  }

  console.log(`[RetentionPurge] Sweep complete, total deleted: ${total}`);
  return total;
}

let purgeInterval: NodeJS.Timeout | null = null;

export function startRetentionPurge(): void {
  if (purgeInterval) return;

  const cfg = getConfig();
  if (!cfg.enabled) {
    console.log('[RetentionPurge] Not starting (disabled by config)');
    return;
  }

  console.log(`[RetentionPurge] Starting with interval ${cfg.intervalMs}ms`);
  purgeInterval = setInterval(() => {
    withRedisLock('retention_purge', 300_000, async () => {
      await runRetentionPurge();
    }).catch((err) => {
      console.error('[RetentionPurge] Unhandled error in sweep:', err);
    });
  }, cfg.intervalMs);
}

export function stopRetentionPurge(): void {
  if (purgeInterval) {
    clearInterval(purgeInterval);
    purgeInterval = null;
    console.log('[RetentionPurge] Stopped');
  }
}