import { Request, Response, NextFunction } from "express";
import { ZodError, type ZodIssue } from "zod";

const isDev = process.env["NODE_ENV"] === "development";

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

  res.status(500).json({
    error: "Internal server error",
    message: isDev ? error.message : "Something went wrong",
  });
}
