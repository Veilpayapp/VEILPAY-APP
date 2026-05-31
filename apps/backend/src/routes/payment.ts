import { Router } from "express";
import { authMiddleware, requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { confirmPayment, getPayments, getPaymentDetails } from "../controllers/paymentController";

const router: Router = Router();

router.post("/confirm", asyncHandler(confirmPayment));
router.get("/", authMiddleware, requireAuth, asyncHandler(getPayments));
router.get("/:id", authMiddleware, requireAuth, asyncHandler(getPaymentDetails));

export { router as paymentRoutes };
