import { Router } from "express";
import { authRateLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";
import { withdraw } from "../controllers/relayerController";

const router: Router = Router();

router.post("/withdraw", authRateLimiter, asyncHandler(withdraw));

export { router as relayerRoutes };
