import { z } from "zod";
import { isValidTokenAddressForChain } from "../lib/tokenAddress";

export const MerchantStatus = z.enum(["pending", "active", "suspended", "deleted"]);
export type MerchantStatus = z.infer<typeof MerchantStatus>;

export const InvoiceStatus = z.enum(["pending", "paid", "expired", "cancelled"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const ChainType = z.enum(["evm", "svm", "xlm"]);
export type ChainType = z.infer<typeof ChainType>;

export const PrivacyLevel = z.enum(["standard", "max"]);
export type PrivacyLevel = z.infer<typeof PrivacyLevel>;

export const MerchantSchema = z.object({
  id: z.string().uuid(),
  businessName: z.string().min(1).max(100),
  email: z.string().email(),
  webhookUrl: z.string().url().optional(),
  apiKeyHash: z.string(),
  status: MerchantStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const ChainViewingKeySchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  chainType: ChainType,
  chainKey: z.string(),
  viewingKey: z.string(),
  settlementAddress: z.string(),
  createdAt: z.date(),
});

export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  chainKey: z.string(),
  tokenSymbol: z.string(),
  amount: z.string(),
  amountUsd: z.string().optional(),
  memo: z.string().optional(),
  expiresAt: z.date(),
  status: InvoiceStatus,
  privacyLevel: PrivacyLevel,
  paymentAddress: z.string().optional(),
  paymentTxHash: z.string().optional(),
  paidAt: z.date().optional(),
  createdAt: z.date(),
});

export const PaymentSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  merchantId: z.string().uuid(),
  chainKey: z.string(),
  txHash: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  amount: z.string(),
  tokenSymbol: z.string(),
  privacyLevel: PrivacyLevel,
  nullifier: z.string().optional(),
  commitment: z.string().optional(),
  status: z.enum(["pending", "confirmed", "failed"]),
  blockNumber: z.number().optional(),
  timestamp: z.date(),
});

export const CreateInvoiceRequestSchema = z
  .object({
    merchantId: z.string().uuid(),
    chainKey: z.string().trim().min(1).max(50),
    tokenSymbol: z.string().trim().min(1).max(20),
    /**
     * Optional token identity: ERC-20 (0x…), Solana mint (base58), or Stellar
     * issuer (G…). When omitted for non-native tokens, the server resolves from
     * the chain token registry.
     */
    tokenAddress: z.string().trim().min(1).max(100).optional(),
    // BE-H1 fix: strict numeric amount validation — must be positive, numeric, limited precision
    amount: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(
        /^\d+(\.\d{1,18})?$/,
        "Amount must be a positive numeric string with at most 18 decimal places"
      )
      .refine((val) => {
        const num = parseFloat(val);
        return !isNaN(num) && num > 0 && isFinite(num);
      }, "Amount must be greater than 0"),
    memo: z.string().trim().max(2000).optional(),
    expiresInMinutes: z.number().int().min(1).max(43200).default(60),
    privacyLevel: PrivacyLevel.default("standard"),
  })
  .superRefine((data, ctx) => {
    if (!data.tokenAddress) return;
    const check = isValidTokenAddressForChain(data.chainKey, data.tokenAddress);
    if (!check.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokenAddress"],
        message: check.error,
      });
    }
  });

export const CreateInvoiceResponseSchema = z.object({
  invoiceId: z.string().uuid(),
  merchantId: z.string().uuid(),
  status: InvoiceStatus,
  paymentAddress: z.string().optional(),
  paymentTxHash: z.string().optional(),
  paidAt: z.date().optional(),
  expiresAt: z.date(),
  chainKey: z.string().min(1).max(50),
  tokenSymbol: z.string().min(1).max(20),
  amount: z.string().min(1).max(50),
  memo: z.string().optional(),
  privacyLevel: PrivacyLevel,
});

export const InvoiceStatusResponseSchema = z.object({
  invoiceId: z.string().uuid(),
  status: InvoiceStatus,
  // BE-H2 fix: remove paymentAddress and paymentTxHash from public endpoint
  paidAt: z.date().optional(),
  expiresAt: z.date(),
});

// BE-H3 fix: full invoice response schema for authenticated endpoint
export const InvoiceDetailResponseSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  chainKey: z.string(),
  tokenSymbol: z.string(),
  amount: z.string(),
  amountUsd: z.string().optional(),
  memo: z.string().optional(),
  expiresAt: z.date(),
  status: InvoiceStatus,
  privacyLevel: PrivacyLevel,
  paymentAddress: z.string().optional(),
  paymentTxHash: z.string().optional(),
  paidAt: z.date().optional(),
  createdAt: z.date(),
});

// BE-M1 fix: UUID path parameter validation
export const uuidParamSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
});

// ST-H3 fix: Zod schema for invoice pay route body
export const PayInvoiceRequestSchema = z.object({
  txHash: z
    .string()
    .trim()
    .min(1, "Transaction hash is required")
    .max(128, "Transaction hash too long")
    .regex(
      /^(0x[0-9a-fA-F]{64}|[A-Za-z0-9]{32,128})$/,
      "Invalid transaction hash format (expected 0x + 64 hex chars for EVM, or 32-128 alphanumeric for other chains)"
    ),
});
export type PayInvoiceRequest = z.infer<typeof PayInvoiceRequestSchema>;

export const MerchantRegistrationRequestSchema = z.object({
  businessName: z.string().min(1).max(100),
  email: z.string().email(),
  webhookUrl: z.string().url().optional(),
});

export const PublishViewingKeyRequestSchema = z.object({
  chainKey: z.string().trim().min(1).max(50),
  viewingKey: z.string().trim().min(1).max(2048),
  settlementAddress: z.string().trim().min(1).max(100),
});

export type Merchant = z.infer<typeof MerchantSchema>;
export type ChainViewingKey = z.infer<typeof ChainViewingKeySchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequestSchema>;
export type CreateInvoiceResponse = z.infer<typeof CreateInvoiceResponseSchema>;
export type InvoiceStatusResponse = z.infer<typeof InvoiceStatusResponseSchema>;
export type InvoiceDetailResponse = z.infer<typeof InvoiceDetailResponseSchema>;
export type MerchantRegistrationRequest = z.infer<typeof MerchantRegistrationRequestSchema>;
export type PublishViewingKeyRequest = z.infer<typeof PublishViewingKeyRequestSchema>;

// ── Invoice List ──────────────────────────────────────────────────────────
export const InvoiceListQuerySchema = z.object({
  status: InvoiceStatus.optional(),
  chainKey: z.string().trim().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "expiresAt", "amount"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

export const InvoiceListItemSchema = z.object({
  id: z.string().uuid(),
  chainKey: z.string(),
  tokenSymbol: z.string(),
  amount: z.string(),
  amountUsd: z.string().optional(),
  memo: z.string().optional(),
  status: InvoiceStatus,
  privacyLevel: PrivacyLevel,
  expiresAt: z.date(),
  paidAt: z.date().optional(),
  createdAt: z.date(),
});

export const InvoiceListResponseSchema = z.object({
  invoices: z.array(InvoiceListItemSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

// ── Payment List ──────────────────────────────────────────────────────────
export const PaymentListQuerySchema = z.object({
  status: z.enum(["pending", "confirmed", "failed"]).optional(),
  chainKey: z.string().trim().min(1).max(50).optional(),
  invoiceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["timestamp", "amount"]).default("timestamp"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export type PaymentListQuery = z.infer<typeof PaymentListQuerySchema>;

export const PaymentListItemSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  chainKey: z.string(),
  txHash: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  amount: z.string(),
  tokenSymbol: z.string(),
  privacyLevel: PrivacyLevel,
  status: z.enum(["pending", "confirmed", "failed"]),
  blockNumber: z.number().optional(),
  timestamp: z.date(),
});

export const PaymentListResponseSchema = z.object({
  payments: z.array(PaymentListItemSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

// ── Merchant Dashboard Stats ──────────────────────────────────────────────
export const MerchantStatsResponseSchema = z.object({
  merchantId: z.string().uuid(),
  totalInvoices: z.number().int(),
  pendingInvoices: z.number().int(),
  paidInvoices: z.number().int(),
  expiredInvoices: z.number().int(),
  cancelledInvoices: z.number().int(),
  totalPayments: z.number().int(),
  confirmedPayments: z.number().int(),
  pendingPayments: z.number().int(),
  failedPayments: z.number().int(),
  totalVolumeByChain: z.record(z.string(), z.number()),
  recentPayments: z.array(PaymentListItemSchema),
});

// ── Merchant Update ───────────────────────────────────────────────────────
export const MerchantUpdateRequestSchema = z.object({
  businessName: z.string().trim().min(1).max(100).optional(),
  webhookUrl: z.string().url().max(500).nullable().optional(),
});
export type MerchantUpdateRequest = z.infer<typeof MerchantUpdateRequestSchema>;

export const MerchantUpdateResponseSchema = z.object({
  id: z.string().uuid(),
  businessName: z.string(),
  email: z.string(),
  webhookUrl: z.string().nullable().optional(),
  status: MerchantStatus,
  tier: z.enum(["basic", "pro", "enterprise"]),
  updatedAt: z.date(),
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}
