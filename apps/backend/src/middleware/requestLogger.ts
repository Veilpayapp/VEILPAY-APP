import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  // BE-M6 fix: add request ID for traceability
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const duration = Date.now() - start;
    const merchantId = (req as any).merchantId || "-";
    console.log(
      `[HTTP] ${req.method} ${req.path} ${res.statusCode} ${duration}ms req=${requestId} merchant=${merchantId}`
    );
  });

  next();
}
