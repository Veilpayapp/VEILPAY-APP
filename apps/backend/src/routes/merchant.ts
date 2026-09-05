import { Router, type Request, type Response, type NextFunction } from "express";
import { authMiddleware, requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { registrationRateLimiter, getMerchantLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";
import {
  registerMerchant,
  publishKey,
  getMerchant,
  getMerchantStats,
  updateMerchant,
} from "../controllers/merchantController";

const router: Router = Router();

// Apply the per-merchant tier rate limit (basic 60 / pro 300 / enterprise 1000
// per minute). Needs auth to have run first (requireAuth guarantees merchantId).
// getMerchantLimiter does the first DB lookup then caches per merchant.
async function merchantTierLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const merchantId = (req as AuthenticatedRequest).merchantId;
  if (!merchantId) {
    next();
    return;
  }
  const limiter = await getMerchantLimiter(merchantId);
  limiter(req, res, next);
}


// SEC-002: throttle the unauthenticated registration endpoint to bound
// email-enumeration and create-spam before the handler runs.
router.post("/register", registrationRateLimiter, asyncHandler(registerMerchant));
router.post("/keys/publish", authMiddleware, requireAuth, asyncHandler(merchantTierLimiter), asyncHandler(publishKey));
router.get("/:id", authMiddleware, requireAuth, asyncHandler(merchantTierLimiter), asyncHandler(getMerchant));
router.get("/:id/stats", authMiddleware, requireAuth, asyncHandler(merchantTierLimiter), asyncHandler(getMerchantStats));
router.put("/:id", authMiddleware, requireAuth, asyncHandler(merchantTierLimiter), asyncHandler(updateMerchant));

export { router as merchantRoutes };
