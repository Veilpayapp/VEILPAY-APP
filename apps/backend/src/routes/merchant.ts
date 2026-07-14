import { Router } from "express";
import { authMiddleware, requireAuth } from "../middleware/auth";
import { registrationRateLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";
import {
  registerMerchant,
  publishKey,
  getMerchant,
  getMerchantStats,
  updateMerchant,
} from "../controllers/merchantController";

const router: Router = Router();

// SEC-002: throttle the unauthenticated registration endpoint to bound
// email-enumeration and create-spam before the handler runs.
router.post("/register", registrationRateLimiter, asyncHandler(registerMerchant));
router.post("/keys/publish", authMiddleware, requireAuth, asyncHandler(publishKey));
router.get("/:id", authMiddleware, requireAuth, asyncHandler(getMerchant));
router.get("/:id/stats", authMiddleware, requireAuth, asyncHandler(getMerchantStats));
router.put("/:id", authMiddleware, requireAuth, asyncHandler(updateMerchant));

export { router as merchantRoutes };
