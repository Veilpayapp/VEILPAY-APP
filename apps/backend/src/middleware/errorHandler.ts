import { Request, Response, NextFunction } from "express";
import { STATUS_CODES } from "http";
import { ZodError, type ZodIssue } from "zod";

const isDev = process.env["NODE_ENV"] === "development";

/**
 * D3: body-parser (and other framework) errors carry a numeric HTTP status —
 * malformed JSON → 400 (`entity.parse.failed`), oversized body → 413
 * (`PayloadTooLargeError`, express.json limit is "1mb"). Only ZodError (400)
 * and Prisma known errors (409) were mapped, so every parse failure surfaced
 * as a blanket 500. Trust a valid 4xx/5xx status on the error; anything else
 * stays a 500.
 */
function errorHttpStatus(error: Error): number | undefined {
  const candidate =
    (error as { status?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  if (typeof candidate !== "number") return undefined;
  if (!Number.isInteger(candidate) || candidate < 400 || candidate > 599) {
    return undefined;
  }
  return candidate;
}

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[Error]", error);

  if (error instanceof ZodError || error.name === "ZodError") {
    const zodErr = error as ZodError;
    // BE-M7 fix: in production, return only field-level errors without schema paths
    res.status(400).json({
      error: "Validation error",
      details: isDev
        ? zodErr.issues
        : zodErr.issues.map((i: ZodIssue) => ({
            message: i.message,
            path: i.path.map(String),
          })),
    });
    return;
  }

  if (error.name === "PrismaClientKnownRequestError") {
    res.status(409).json({
      error: "Database conflict",
      message: isDev ? error.message : "A conflict occurred. Please try again.",
    });
    return;
  }

  const status = errorHttpStatus(error);
  if (status !== undefined) {
    // Framework errors with a status (parse failures, payload limits, auth
    // challenges from upstream middleware) keep the same JSON shape.
    res.status(status).json({
      error: STATUS_CODES[status] || "Request failed",
      message: isDev ? error.message : "Something went wrong",
    });
    return;
  }

  res.status(500).json({
    error: "Internal server error",
    message: isDev ? error.message : "Something went wrong",
  });
}
