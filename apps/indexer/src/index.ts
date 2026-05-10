import { startWebSocketIndexers } from "./indexers/websocket";
import { startWebhookWorker } from "./webhook/dispatcher";
import { startStealthScanners } from "./stealth/scanner";
import { config } from "./config";

async function main() {
  console.log("[VeilPay] Indexer starting...");
  console.log(`[VeilPay] Environment: ${config.nodeEnv}`);

  console.log("[VeilPay] Starting WebSocket indexers...");
  const indexers = await startWebSocketIndexers();
  console.log(`[VeilPay] Started ${indexers.size} indexers`);

  console.log("[VeilPay] Starting webhook worker...");
  const worker = startWebhookWorker();

  console.log("[VeilPay] Starting stealth scanners...");
  const scanners = await startStealthScanners();
  console.log(`[VeilPay] Started ${scanners.size} stealth scanners`);

  const shutdown = async () => {
    console.log("[VeilPay] Shutting down...");

    for (const [chainKey, indexer] of indexers) {
      await indexer.stop();
      console.log(`[VeilPay] Stopped indexer for ${chainKey}`);
    }

    for (const [chainKey, scanner] of scanners) {
      await scanner.stop();
      console.log(`[VeilPay] Stopped stealth scanner for ${chainKey}`);
    }

    await worker.close();
    console.log("[VeilPay] Webhook worker stopped");

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[VeilPay] Indexer running (WebSocket + Stealth mode)");
}

main().catch((error) => {
  console.error("[VeilPay] Fatal error:", error);
  process.exit(1);
});
