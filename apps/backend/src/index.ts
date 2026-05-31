import express from "express";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { config } from "./config";
import { invoiceRoutes } from "./routes/invoice";
import { merchantRoutes } from "./routes/merchant";
import { webhookRoutes } from "./routes/webhook";
import { healthRoutes } from "./routes/health";
import { directoryRoutes } from "./routes/directory";
import { docsRoutes } from "./routes/docs";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { globalRateLimiter, authRateLimiter, webhookRateLimiter, webhookVerifyRateLimiter } from "./middleware/rateLimiter";
import { startInvoiceExpiryWorker, stopInvoiceExpiryWorker } from "./lib/invoiceExpiry";
import { closeWebhookQueue, initializeWebhookQueue } from "./jobs/webhookQueue";
import { closeWebhookWorker, initializeWebhookWorker } from "./jobs/webhookWorker";
import { startChainIndexer, stopChainIndexer } from "./jobs/chainIndexer";
import { paymentRoutes } from "./routes/payment";
import { relayerRoutes } from "./routes/relayer";
import onrampRoutes from "./routes/onramp";
import { prisma } from "./lib/prisma";
import { getRedisClient } from "./lib/redis";

Sentry.init({
  dsn: config.sentryDsn || "",
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: config.nodeEnv === "production" ? 0.2 : 1.0,
  profilesSampleRate: 1.0,
});

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
    verify: (req: import("http").IncomingMessage & { rawBody?: string }, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    },
  })
);

// Distributed Session Middleware (Phase 6.5 groundwork)
const redisClient = getRedisClient();
if (redisClient) {
  app.use(
    session({
      store: new RedisStore({ client: redisClient, prefix: "veilpay:sess:" }),
      secret: config.jwtSecret || "veilpay_dev_session_secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.nodeEnv === "production",
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      },
    })
  );
}

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
app.use("/api/v1/directory", directoryRoutes);
app.use("/api/v1/invoice", invoiceRoutes);
app.use("/api/v1/merchant", merchantRoutes);
app.use("/api/v1/payment", paymentRoutes);
app.use("/api/v1/webhook", webhookRoutes);
app.use("/api/v1/onramp", onrampRoutes);
app.use("/api/v1/relayer", relayerRoutes);
app.use("/api/docs", docsRoutes);

Sentry.setupExpressErrorHandler(app);
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
    // Active startup of BullMQ webhook queue and worker
    initializeWebhookQueue();
    initializeWebhookWorker();
    console.log(`[VeilPay] Webhook delivery worker started`);
    // Multi-chain polling worker
    startChainIndexer();
  });

  const shutdown = async () => {
    console.log("[VeilPay] Shutting down...");
    stopInvoiceExpiryWorker();
    stopChainIndexer();
    await closeWebhookWorker();
    await closeWebhookQueue();
    await prisma.$disconnect();
    console.log("[VeilPay] Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    shutdown().catch(console.error);
  });
  process.on("SIGINT", () => {
    shutdown().catch(console.error);
  });
  process.on("unhandledRejection", (err) => {
    console.error('[VeilPay] Unhandled rejection:', err);
  });
}
