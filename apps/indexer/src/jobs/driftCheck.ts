/**
 * Periodic settlement drift check (round-4 stream C, task (b)).
 *
 * Config-gated interval job (default OFF —
 * `RECONCILIATION_DRIFT_CHECK_INTERVAL_MS=0` means disabled) that compares
 * payments ↔ invoices and logs drift, and reports WebhookDelivery rows
 * stuck undelivered (the durable-outbox rows from task (f) that never
 * reached a terminal state).
 *
 * Read-only by design: the repair path is the one-time reconciliation
 * script (scripts/reconcile-settlements.ts). This job only detects and
 * logs so operators can decide.
 */

import { prisma } from "../lib/prisma";
import { scanSettlements, type ReconciliationFinding, type ScanResult } from "./settlementReconciliation";

/**
 * A pending WebhookDelivery row older than this is "stuck undelivered":
 * the outbox row was created before enqueue, so a crash between the DB
 * commit and the BullMQ add (or a delivery that died mid-retry) leaves it
 * pending forever. Retries normally resolve within seconds-to-minutes, so
 * 10 minutes is a safe floor.
 */
export const STUCK_WEBHOOK_DELIVERY_AGE_MS = 10 * 60 * 1000;

/** Cap on stuck rows fetched per drift run (logging only). */
export const STUCK_WEBHOOK_DELIVERY_LIMIT = 50;

export interface StuckWebhookDelivery {
  id: string;
  merchantId: string;
  eventType: string;
  createdAt: Date;
  retryCount: number;
}

export interface DriftCheckReport {
  ranAt: Date;
  scannedPayments: number;
  scannedInvoices: number;
  /** Pre-round-3 disease rows still present (see settlementReconciliation). */
  settlementDrift: ReconciliationFinding[];
  /** Payments whose invoiceId points at a missing invoice. */
  orphanPayments: ScanResult["orphanPayments"];
  /** WebhookDelivery rows pending longer than STUCK_WEBHOOK_DELIVERY_AGE_MS. */
  stuckWebhookDeliveries: StuckWebhookDelivery[];
  /** Terminal webhook failures (dead-lettered deliveries). */
  failedWebhookDeliveryCount: number;
}

export interface DriftCheckOptions {
  /** Override the stuck-delivery age threshold (tests use small values). */
  stuckAgeMs?: number;
}

export async function runDriftCheck(options: DriftCheckOptions = {}): Promise<DriftCheckReport> {
  const scan = await scanSettlements();

  const stuckAgeMs = options.stuckAgeMs ?? STUCK_WEBHOOK_DELIVERY_AGE_MS;
  const cutoff = new Date(Date.now() - stuckAgeMs);
  const stuckWebhookDeliveries = (await prisma.webhookDelivery.findMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    select: { id: true, merchantId: true, eventType: true, createdAt: true, retryCount: true },
    orderBy: { createdAt: "asc" },
    take: STUCK_WEBHOOK_DELIVERY_LIMIT,
  })) as StuckWebhookDelivery[];
  const failedWebhookDeliveryCount = (await prisma.webhookDelivery.count({
    where: { status: "failed" },
  })) as number;

  // ── log drift loudly ─────────────────────────────────────────────────────
  if (scan.findings.length > 0) {
    console.warn(
      `[DriftCheck] Settlement drift: ${scan.findings.length} finding(s) across ${scan.scannedPayments} payment(s)`
    );
    for (const finding of scan.findings) {
      console.warn(`[DriftCheck]   - [${finding.kind}] ${finding.description}`);
    }
  }
  if (scan.orphanPayments.length > 0) {
    console.warn(
      `[DriftCheck] Orphan payments: ${scan.orphanPayments.length} payment(s) point at missing invoices`
    );
    for (const orphan of scan.orphanPayments) {
      console.warn(`[DriftCheck]   - payment ${orphan.paymentId} → missing invoice ${orphan.invoiceId}`);
    }
  }
  if (stuckWebhookDeliveries.length > 0) {
    console.warn(
      `[DriftCheck] Webhook deliveries stuck undelivered: ${stuckWebhookDeliveries.length} row(s) pending for more than ${stuckAgeMs}ms`
    );
    for (const stuck of stuckWebhookDeliveries) {
      console.warn(
        `[DriftCheck]   - delivery ${stuck.id} (merchant ${stuck.merchantId}, ${stuck.eventType}, retryCount ${stuck.retryCount}, created ${stuck.createdAt.toISOString()})`
      );
    }
  }
  if (failedWebhookDeliveryCount > 0) {
    console.warn(
      `[DriftCheck] Failed webhook deliveries (dead-lettered): ${failedWebhookDeliveryCount}`
    );
  }

  return {
    ranAt: new Date(),
    scannedPayments: scan.scannedPayments,
    scannedInvoices: scan.scannedInvoices,
    settlementDrift: scan.findings,
    orphanPayments: scan.orphanPayments,
    stuckWebhookDeliveries,
    failedWebhookDeliveryCount,
  };
}

/**
 * Start the periodic drift check. Returns null (and starts nothing) when
 * intervalMs is not a positive finite number — the config default of 0
 * means disabled. The timer is unref'd so it never keeps the process
 * alive on its own, and overlapping runs are skipped.
 */
export function startDriftCheckScheduler(intervalMs: number): NodeJS.Timeout | null {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return null;
  }
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return; // previous run still in flight — skip this tick
    }
    running = true;
    void runDriftCheck()
      .catch((err: unknown) => {
        console.error(
          "[DriftCheck] Drift check run failed:",
          err instanceof Error ? err.message : String(err)
        );
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  console.warn(`[DriftCheck] Scheduled every ${intervalMs}ms`);
  return timer;
}

export function stopDriftCheckScheduler(timer: NodeJS.Timeout | null): void {
  if (timer) {
    clearInterval(timer);
  }
}
