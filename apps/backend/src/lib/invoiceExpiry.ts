import { prisma } from "../lib/prisma";
import { withRedisLock } from "./redisLock";

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
    void (async () => {
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

// BE-C2 fix: transition expired invoices from pending to expired
async function expirePendingInvoices(): Promise<number> {
  const result = await prisma.invoice.updateMany({
    where: {
      status: "pending",
      expiresAt: {
        lt: new Date(),
      },
    },
    data: {
      status: "expired",
    },
  });

  if (result.count > 0) {
    console.log(`[InvoiceExpiry] Expired ${result.count} invoice(s)`);
  }

  return result.count;
}
