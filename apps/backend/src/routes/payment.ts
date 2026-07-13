import { Router } from "express";
import { authMiddleware, requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { confirmPayment, getPayments, getPaymentDetails } from "../controllers/paymentController";

const router: Router = Router();

// SEC-001 fix: /confirm is now auth-gated. The caller's merchantId is taken
// from the HMAC-signed auth context (not the body), and the invoice must
// belong to that merchant. Previously this endpoint was unauthenticated and
// any caller could mark any invoice paid with a caller-supplied txHash.
router.post("/confirm", authMiddleware, requireAuth, asyncHandler(confirmPayment));
router.get("/", authMiddleware, requireAuth, asyncHandler(getPayments));
router.get("/:id", authMiddleware, requireAuth, asyncHandler(getPaymentDetails));

export { router as paymentRoutes };
