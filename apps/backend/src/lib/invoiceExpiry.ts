/* eslint-disable no-console */
import { prisma } from "../lib/prisma";
import { withRedisLock } from "./redisLock";
import { enqueueWebhook } from "../jobs/webhookQueue";

const EXPIRY_CHECK_INTERVAL_MS = 60 * 1000;

let intervalHandle: NodeJS.Timeout | null = null;

export function startInvoiceExpiryWorker(): void {
  if (intervalHandle) {
    return;
  }

  console.log("[InvoiceExpiry] Starting invoice expiry worker");

  // setInterval expects `() => void`; an `async` callback returns a
  // Promise that no caller awaits, so we wrap the async work in a
  // synchronous handler that swallows rejections (and logs them) to
  // satisfy `no-misused-promises`.
  intervalHandle = setInterval(() => {
    void (async (): Promise<void> => {
      try {
        await withRedisLock('invoice_expiry', 50000, async () => {
          await expirePendingInvoices();
        });
      } catch (error) {
        console.error("[InvoiceExpiry] Error during expiry sweep:", error);
      }
    })();
  }, EXPIRY_CHECK_INTERVAL_MS);
}

export function stopInvoiceExpiryWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[InvoiceExpiry] Stopped invoice expiry worker");
  }
}

// BE-C2 fix: transition expired invoices from pending to expired.
// REL-002: emit an `invoice.expired` webhook for each invoice we expire so
// merchants are notified (the event enum already includes `invoice.expired`,
// but nothing previously enqueued it).
async function expirePendingInvoices(): Promise<number> {
  const now = new Date();

  // Claim the rows to expire in a single atomic pass. We select first so we
  // have each invoice's details for the webhook, then flip only the ones that
  // are still pending — `updateMany` with the `status: "pending"` predicate is
  // idempotent under concurrent sweeps (another worker that already flipped a
  // row updates 0 and we never double-enqueue for it).
  const candidates = await prisma.invoice.findMany({
    where: { status: "pending", expiresAt: { lt: now } },
    select: {
      id: true,
      merchantId: true,
      chainKey: true,
      tokenSymbol: true,
      amount: true,
      privacyLevel: true,
    },
  });

  if (candidates.length === 0) {
    return 0;
  }

  let expiredCount = 0;
  for (const invoice of candidates) {
    const updated = await prisma.invoice.updateMany({
      where: { id: invoice.id, status: "pending" },
      data: { status: "expired" },
    });

    // Only notify if THIS sweep is the one that expired the invoice, so a
    // concurrent worker or retry cannot double-fire the webhook.
    if (updated.count === 0) {
      continue;
    }
    expiredCount += 1;

    try {
      await enqueueWebhook({
        eventType: "invoice.expired",
        merchantId: invoice.merchantId,
        invoiceId: invoice.id,
        chainKey: invoice.chainKey,
        tokenSymbol: invoice.tokenSymbol,
        amount: invoice.amount.toString(),
        privacyLevel: invoice.privacyLevel,
        timestamp: now.getTime(),
      });
    } catch (error) {
      // A webhook enqueue failure must not abort the sweep or roll back the
      // already-committed status change. enqueueWebhook has its own DB outbox
      // fallback; log and continue.
      console.error(
        `[InvoiceExpiry] Failed to enqueue invoice.expired webhook for ${invoice.id}:`,
        error
      );
    }
  }

  if (expiredCount > 0) {
    console.log(`[InvoiceExpiry] Expired ${expiredCount} invoice(s)`);
  }

  return expiredCount;
}
