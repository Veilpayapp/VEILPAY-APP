import { Router } from "express";
import { authRateLimiter } from "../middleware/rateLimiter";
import { relayerCallerAuth } from "../middleware/relayerAuth";
import { asyncHandler } from "../utils/asyncHandler";
import { withdraw } from "../controllers/relayerController";

const router: Router = Router();

// SEC-006 residual: shared-secret caller gate (when configured) + rate limit
// before gas-sponsoring withdraw. Quotas still enforced inside the handler.
router.post(
  "/withdraw",
  authRateLimiter,
  relayerCallerAuth,
  asyncHandler(withdraw)
);

export { router as relayerRoutes };
