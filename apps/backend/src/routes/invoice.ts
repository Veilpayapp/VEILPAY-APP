import { Router } from "express";
import { authMiddleware, requireAuth } from "../middleware/auth";
import { invoiceStatusRateLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getInvoices,
  createInvoice,
  getInvoiceStatus,
  getInvoiceDetails,
  cancelInvoice,
  payInvoice,
} from "../controllers/invoiceController";

const router: Router = Router();

router.get("/", authMiddleware, requireAuth, asyncHandler(getInvoices));
router.post("/create", authMiddleware, requireAuth, asyncHandler(createInvoice));
router.get("/:id/status", invoiceStatusRateLimiter, asyncHandler(getInvoiceStatus));
router.get("/:id", authMiddleware, requireAuth, asyncHandler(getInvoiceDetails));
router.post("/:id/cancel", authMiddleware, requireAuth, asyncHandler(cancelInvoice));
router.post("/:id/pay", authMiddleware, requireAuth, invoiceStatusRateLimiter, asyncHandler(payInvoice));

export { router as invoiceRoutes };
