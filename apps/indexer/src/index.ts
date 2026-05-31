import { startWebSocketIndexers } from "./indexers/websocket";
import { startWebhookWorker } from "./webhook/dispatcher";
import { startStealthScanners } from "./stealth/scanner";
import { config } from "./config";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function main() {
  console.warn("[VeilPay] Indexer starting...");
  console.warn(`[VeilPay] Environment: ${config.nodeEnv}`);

  console.warn("[VeilPay] Starting WebSocket indexers...");
  const indexers = await startWebSocketIndexers();
  console.warn(`[VeilPay] Started ${indexers.size} indexers`);

  console.warn("[VeilPay] Starting webhook worker...");
  const worker = startWebhookWorker();

  console.warn("[VeilPay] Starting stealth scanners...");
  const scanners = await startStealthScanners();
  console.warn(`[VeilPay] Started ${scanners.size} stealth scanners`);

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const shutdown = async () => {
    console.warn("[VeilPay] Shutting down...");

    for (const [chainKey, indexer] of indexers) {
      await indexer.stop();
      console.warn(`[VeilPay] Stopped indexer for ${chainKey}`);
    }

    // `scanner.stop` is currently synchronous; the call site does not
    // need `await` and `await-thenable` rightly flags it. Drop the
    // `await` so the rule passes; the loop still completes before
    // `worker.close()` runs.
    for (const [chainKey, scanner] of scanners) {
      scanner.stop();
      console.warn(`[VeilPay] Stopped stealth scanner for ${chainKey}`);
    }

    await worker.close();
    console.warn("[VeilPay] Webhook worker stopped");

    process.exit(0);
  };

  // `process.on('SIGINT', shutdown)` registers an async function as an
  // event listener; `no-misused-promises` flags that because the
  // unhandled rejection path differs. Wrap in a sync trampoline that
  // logs unexpected errors.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const onSignal = (signal: NodeJS.Signals) => {
    void shutdown().catch((error) => {
      console.error(`[VeilPay] Shutdown error on ${signal}:`, error);
      process.exit(1);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  console.warn("[VeilPay] Indexer running (WebSocket + Stealth mode)");
}

main().catch((error) => {
  console.error("[VeilPay] Fatal error:", error);
  process.exit(1);
});
