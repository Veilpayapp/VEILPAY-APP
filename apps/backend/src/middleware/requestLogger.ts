import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import type { AuthenticatedRequest } from "./auth";

/**
 * PRIV-204: onramp status tokens are signed bearer credentials carried in the
 * URL path (`GET /api/v1/onramp/status/<token>`). Redact the token before the
 * request line is written to logs so a log compromise cannot yield live tokens.
 */
function redactPath(path: string): string {
  return path.replace(/^(\/api\/v1\/onramp\/status\/)[^/]+/, "$1[REDACTED]");
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  // BE-M6 fix: add request ID for traceability
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const duration = Date.now() - start;
    const authReq = req as AuthenticatedRequest;
    const merchantId = authReq.merchantId || "-";
    // eslint-disable-next-line no-console
    console.log(
      `[HTTP] ${req.method} ${redactPath(req.path)} ${res.statusCode} ${duration}ms req=${requestId} merchant=${merchantId}`
    );
  });

  next();
}
