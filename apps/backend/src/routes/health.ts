import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { getHealth, getReady, getLive } from "../controllers/healthController";

const router = Router();

router.get("/", asyncHandler(getHealth));
router.get("/ready", asyncHandler(getReady));
router.get("/live", getLive);

export { router as healthRoutes };
