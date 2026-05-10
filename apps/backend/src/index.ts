import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { config } from "./config";
import { invoiceRoutes } from "./routes/invoice";
import { merchantRoutes } from "./routes/merchant";
import { webhookRoutes } from "./routes/webhook";
import { healthRoutes } from "./routes/health";
import { docsRoutes } from "./routes/docs";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { globalRateLimiter, authRateLimiter, webhookRateLimiter, webhookVerifyRateLimiter } from "./middleware/rateLimiter";
import { startInvoiceExpiryWorker, stopInvoiceExpiryWorker } from "./lib/invoiceExpiry";
import { closeWebhookQueue } from "./jobs/webhookQueue";
import { paymentRoutes } from "./routes/payment";
import onrampRoutes from "./routes/onramp";

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  referrerPolicy: { policy: "no-referrer" },
  xContentTypeOptions: true,
  xDnsPrefetchControl: { allow: false },
  xDownloadOptions: true,
  xFrameOptions: { action: "deny" },
  xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
  xXssProtection: true,
}));
app.use(compression());
app.use(cors(config.cors));
app.use(
  express.json({
    limit: "1mb",
    verify: (req: any, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    },
  })
);
app.use(requestLogger);

app.use("/api/", globalRateLimiter);

app.use("/api/v1/merchant/register", authRateLimiter);
// BE-H4 fix: apply webhook rate limiter to webhook routes
app.use("/api/v1/webhook", webhookRateLimiter);
// Rate limit on webhook verification to prevent brute-force signature probing
app.use("/api/v1/webhook/verify", webhookVerifyRateLimiter);

app.get("/", (_req, res) => {
  res.json({
    name: "VeilPay API",
    version: "1.0.0",
    description: "Multi-Chain Privacy Payment Protocol API",
  });
});

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/invoice", invoiceRoutes);
app.use("/api/v1/merchant", merchantRoutes);
app.use("/api/v1/payment", paymentRoutes);
app.use("/api/v1/webhook", webhookRoutes);
app.use("/api/v1/onramp", onrampRoutes);
app.use("/api/docs", docsRoutes);

app.use(errorHandler);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export { app };

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[VeilPay] API server running on port ${config.port}`);
    console.log(`[VeilPay] Environment: ${config.nodeEnv}`);
    // BE-C2 fix: start invoice expiry background worker
    startInvoiceExpiryWorker();
    console.log(`[VeilPay] Webhook delivery worker started`);
  });

  const shutdown = async () => {
    console.log("[VeilPay] Shutting down...");
    stopInvoiceExpiryWorker();
    await closeWebhookQueue();
    console.log("[VeilPay] Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
