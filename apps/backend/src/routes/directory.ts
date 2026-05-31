import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { getPublicMerchant } from "../controllers/directoryController";

const router: Router = Router();

router.get("/:id", asyncHandler(getPublicMerchant));

export { router as directoryRoutes };
