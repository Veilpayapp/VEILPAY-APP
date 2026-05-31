import type { Request, Response, NextFunction, RequestHandler } from "express";

export const asyncHandler = <Req = Request, Res = Response>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>
): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as unknown as Req, res as unknown as Res, next)).catch(next);
  };
