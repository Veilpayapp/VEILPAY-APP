import { startWebSocketIndexers } from "./indexers/websocket";
import { startWebhookWorker } from "./webhook/dispatcher";
import { startStealthScanners } from "./stealth/scanner";
import { config } from "./config";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function main() {
  console.warn("[Veilpay] Indexer starting...");
  console.warn(`[Veilpay] Environment: ${config.nodeEnv}`);

  console.warn("[Veilpay] Starting WebSocket indexers...");
  const indexers = await startWebSocketIndexers();
  console.warn(`[Veilpay] Started ${indexers.size} indexers`);

  console.warn("[Veilpay] Starting webhook worker...");
  const worker = startWebhookWorker();

  console.warn("[Veilpay] Starting stealth scanners...");
  const scanners = await startStealthScanners();
  console.warn(`[Veilpay] Started ${scanners.size} stealth scanners`);

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const shutdown = async () => {
    console.warn("[Veilpay] Shutting down...");

    for (const [chainKey, indexer] of indexers) {
      await indexer.stop();
      console.warn(`[Veilpay] Stopped indexer for ${chainKey}`);
    }

    // `scanner.stop` is currently synchronous; the call site does not
    // need `await` and `await-thenable` rightly flags it. Drop the
    // `await` so the rule passes; the loop still completes before
    // `worker.close()` runs.
    for (const [chainKey, scanner] of scanners) {
      scanner.stop();
      console.warn(`[Veilpay] Stopped stealth scanner for ${chainKey}`);
    }

    await worker.close();
    console.warn("[Veilpay] Webhook worker stopped");

    process.exit(0);
  };

  // `process.on('SIGINT', shutdown)` registers an async function as an
  // event listener; `no-misused-promises` flags that because the
  // unhandled rejection path differs. Wrap in a sync trampoline that
  // logs unexpected errors.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const onSignal = (signal: NodeJS.Signals) => {
    void shutdown().catch((error) => {
      console.error(`[Veilpay] Shutdown error on ${signal}:`, error);
      process.exit(1);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  console.warn("[Veilpay] Indexer running (WebSocket + Stealth mode)");
}

main().catch((error) => {
  console.error("[Veilpay] Fatal error:", error);
  process.exit(1);
});
