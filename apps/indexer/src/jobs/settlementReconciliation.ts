/**
 * One-time settlement reconciliation (round-4 stream C, task (a)).
 *
 * Pre-round-3 settlement code wrote three classes of corrupt rows that
 * round-3 code stopped producing but never repaired:
 *
 *  1. `Payment.tokenSymbol` holding the token ADDRESS (a 42-hex string)
 *     instead of a symbol — that address is the token-registry key.
 *  2. `Payment.amount` holding BASE UNITS (e.g. wei) instead of the human
 *     amount the `Invoice.amount` column uses.
 *  3. `Invoice.paymentTxHash` holding the payment to-address (42-hex /
 *     base58 address) instead of the transaction hash — and invoices the
 *     settlement path never flipped to `paid` even though a matching
 *     confirmed payment exists.
 *
 * The scanner detects all of the above (conservatively — only clear
 * address shapes and only amount matches confirmed against the linked
 * invoice). `runSettlementReconciliation` is DRY-RUN by default: it reports
 * findings without writing anything. With `{ apply: true }` it repairs:
 *  - recompute the payment amount to human units,
 *  - fix the symbol via the token registry,
 *  - write the real txHash from the payment row onto the invoice,
 *  - CAS-flip pending invoices to paid (+ paidAt).
 *
 * `Payment.txHash` is NEVER rewritten — `@@unique([chainKey, txHash])`
 * must not be violated, and the payment row is the source of truth.
 *
 * All prisma access goes through the shared client (../lib/prisma); tests
 * mock it, and the runnable script (scripts/reconcile-settlements.ts) is
 * the only thing that touches a live database.
 */

import { prisma } from "../lib/prisma";
import { getTokenMetadata, baseUnitsToHumanAmount } from "../indexers/tokenMetadata";

// ── shape helpers ───────────────────────────────────────────────────────────

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/** EVM zero address — registry key for a chain's native asset. */
const EVM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * A payment tokenSymbol that is actually a token address (the pre-round-3
 * disease): EVM addresses are 0x + 40 hex; real symbols are short tickers.
 * Type predicate so callers narrow the value for the registry lookup.
 */
export function isEvmAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && EVM_ADDRESS_REGEX.test(value.trim());
}

/**
 * Values that are CLEARLY addresses rather than transaction hashes.
 * Conservative by design (the brief: "flag only clear address-shaped
 * values"):
 *  - EVM: addresses are 0x + 40 hex; tx hashes are 0x + 64 hex.
 *  - Solana: addresses are base58, 32-44 chars; tx signatures are ~88.
 *  - Stellar: hashes are 64 hex; account IDs are 56-char base32 starting
 *    with 'G' — neither shape is matched here, so Stellar is never flagged.
 */
export function isAddressShapedTxHash(value: string | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const v = value.trim();
  if (EVM_ADDRESS_REGEX.test(v)) {
    return true;
  }
  // Solana base58 address (signatures are 87-88 chars, well above this range).
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
    return true;
  }
  return false;
}

// ── token resolution ────────────────────────────────────────────────────────

export interface ResolvedToken {
  symbol: string;
  decimals: number;
  source: "payment-symbol-registry" | "invoice-token-registry" | "chain-native";
}

/**
 * Resolve the token identity for a scanned payment.
 *
 * Priority: the payment's own tokenSymbol when it is an address (the
 * disease shape — that address IS the registry key), then the invoice's
 * tokenAddress (the anti-spoof contract field), then the chain's native
 * asset. Non-EVM chains have no registry entry, so their native fallback
 * resolves to 18 decimals — conversions under that assumption only match
 * by coincidence, which keeps non-EVM scanning conservative.
 */
export function resolveTokenMetadataForPayment(
  chainKey: string,
  paymentTokenSymbol: string,
  invoiceTokenAddress: string | null | undefined
): ResolvedToken {
  if (isEvmAddress(paymentTokenSymbol)) {
    const meta = getTokenMetadata(chainKey, paymentTokenSymbol);
    return { symbol: meta.symbol, decimals: meta.decimals, source: "payment-symbol-registry" };
  }
  if (isEvmAddress(invoiceTokenAddress)) {
    const meta = getTokenMetadata(chainKey, invoiceTokenAddress);
    return { symbol: meta.symbol, decimals: meta.decimals, source: "invoice-token-registry" };
  }
  const meta = getTokenMetadata(chainKey, EVM_ZERO_ADDRESS);
  return { symbol: meta.symbol, decimals: meta.decimals, source: "chain-native" };
}

// ── amount comparison (formatting tolerance) ────────────────────────────────

/**
 * Normalize a plain decimal string: strip a leading +/-, leading zeros of
 * the integer part and trailing zeros of the fraction, so "1000",
 * "1000.0" and "01000.00" all normalize to "1000".
 */
export function normalizeDecimalString(value: string | null | undefined): string {
  const cleaned = String(value ?? "").trim();
  if (cleaned === "" || !/^[+-]?\d+(\.\d+)?$/.test(cleaned)) {
    return cleaned;
  }
  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/^[+-]/, "");
  const [wholeRaw = "0", fracRaw = ""] = unsigned.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const frac = fracRaw.replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : whole;
  return negative && out !== "0" ? `-${out}` : out;
}

/** Numeric equality with formatting tolerance ("1000" == "1000.0"). */
export function amountsEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (a == null || b == null) {
    return false;
  }
  return normalizeDecimalString(a) === normalizeDecimalString(b);
}

/**
 * Minimum digit count before a payment amount is even considered a
 * base-units candidate: 7 digits is ≥1e6, which for a 6-decimal token is
 * ≥1 whole human unit (any real USDC/USDT disease row clears it). This is
 * only a pre-filter — the invoice-match requirement is the actual
 * discriminator, because a healthy pair would need
 * baseUnitsToHumanAmount(x, decimals) === x, which never holds for real
 * token decimals (≥6).
 */
export const MIN_BASE_UNIT_DIGITS = 7;

export interface BaseUnitAmountCheck {
  /** Integer string with enough digits to be a base-units candidate. */
  isLongInteger: boolean;
  /** baseUnitsToHumanAmount(raw, decimals) — the candidate human amount. */
  converted: string;
  /** The conversion matches the linked invoice amount (formatting tolerance). */
  matchesInvoice: boolean;
  /** The disease signature: long integer AND conversion matches the invoice. */
  isBaseUnitsDisease: boolean;
}

/**
 * Detect the "amount stored as base units" disease for one payment.
 * Requires BOTH signals: a long non-zero integer string AND a conversion
 * (with the token's real decimals) that matches the linked invoice's
 * human-unit amount — a coincidental match on an already-human amount
 * would require amount == amount / 10^decimals, which never holds for
 * real decimals.
 */
export function detectBaseUnitAmount(
  paymentAmount: string,
  invoiceAmount: string | null | undefined,
  decimals: number
): BaseUnitAmountCheck {
  const raw = String(paymentAmount ?? "").trim();
  const converted = baseUnitsToHumanAmount(raw, decimals);
  const digits = raw.replace(/^-/, "").replace(/^0+(?=\d)/, "");
  const isLongInteger = /^-?\d+$/.test(raw) && digits.length >= MIN_BASE_UNIT_DIGITS;
  const matchesInvoice =
    invoiceAmount != null &&
    raw !== "0" &&
    raw !== converted &&
    amountsEqual(converted, invoiceAmount);
  return {
    isLongInteger,
    converted,
    matchesInvoice,
    isBaseUnitsDisease: isLongInteger && matchesInvoice,
  };
}

// ── scan ────────────────────────────────────────────────────────────────────

export type ReconciliationFindingKind =
  | "payment-token-symbol-is-address"
  | "payment-amount-base-units"
  | "invoice-payment-tx-hash-is-address"
  | "invoice-stuck-pending";

/** Repairs applied to a Payment row (never txHash — see header). */
export interface PaymentRepairPatch {
  amount?: string;
  tokenSymbol?: string;
}

/** Repairs applied to an Invoice row. */
export interface InvoiceRepairPatch {
  paymentTxHash?: string;
  status?: "paid";
  paidAt?: Date;
}

export interface ReconciliationFinding {
  kind: ReconciliationFindingKind;
  paymentId: string;
  invoiceId: string | null;
  chainKey: string;
  txHash: string;
  description: string;
  paymentPatch?: PaymentRepairPatch;
  invoicePatch?: InvoiceRepairPatch;
}

/** Minimal row shapes the scanner reads (keeps tests decoupled from prisma types). */
export interface ScannedPayment {
  id: string;
  invoiceId: string | null;
  merchantId: string;
  chainKey: string;
  txHash: string;
  toAddress: string;
  amount: string;
  tokenSymbol: string;
  status: string;
  timestamp: Date;
}

export interface ScannedInvoice {
  id: string;
  merchantId: string;
  chainKey: string;
  tokenSymbol: string;
  tokenAddress: string | null;
  amount: string;
  status: string;
  paymentTxHash: string | null;
}

export interface ScanResult {
  scannedPayments: number;
  scannedInvoices: number;
  findings: ReconciliationFinding[];
  /** Payments whose invoiceId points at a missing invoice (drift, not repairable). */
  orphanPayments: Array<{ paymentId: string; invoiceId: string }>;
}

const PAYMENT_SCAN_SELECT = {
  id: true,
  invoiceId: true,
  merchantId: true,
  chainKey: true,
  txHash: true,
  toAddress: true,
  amount: true,
  tokenSymbol: true,
  status: true,
  timestamp: true,
} as const;

const INVOICE_SCAN_SELECT = {
  id: true,
  merchantId: true,
  chainKey: true,
  tokenSymbol: true,
  tokenAddress: true,
  amount: true,
  status: true,
  paymentTxHash: true,
} as const;

/**
 * Scan payments (and their linked invoices) for the pre-round-3 disease.
 * Read-only: never writes.
 */
export async function scanSettlements(): Promise<ScanResult> {
  const payments = (await prisma.payment.findMany({
    select: PAYMENT_SCAN_SELECT,
    orderBy: { id: "asc" },
  })) as ScannedPayment[];

  const invoiceIds = Array.from(
    new Set(
      payments
        .map((p) => p.invoiceId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  const invoices =
    invoiceIds.length === 0
      ? []
      : ((await prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: INVOICE_SCAN_SELECT,
        })) as ScannedInvoice[]);

  const invoiceById = new Map<string, ScannedInvoice>(
    invoices.map((invoice) => [invoice.id, invoice])
  );

  const findings: ReconciliationFinding[] = [];
  const orphanPayments: ScanResult["orphanPayments"] = [];

  for (const payment of payments) {
    const invoice = payment.invoiceId ? invoiceById.get(payment.invoiceId) ?? null : null;

    if (payment.invoiceId && !invoice) {
      orphanPayments.push({ paymentId: payment.id, invoiceId: payment.invoiceId });
    }

    const token = resolveTokenMetadataForPayment(
      payment.chainKey,
      payment.tokenSymbol,
      invoice?.tokenAddress ?? null
    );

    // Disease: tokenSymbol column holds the token address (registry key).
    if (isEvmAddress(payment.tokenSymbol)) {
      findings.push({
        kind: "payment-token-symbol-is-address",
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        chainKey: payment.chainKey,
        txHash: payment.txHash,
        description: `payment.tokenSymbol '${payment.tokenSymbol}' is a token address; registry symbol is '${token.symbol}'`,
        paymentPatch: { tokenSymbol: token.symbol },
      });
    }

    // Disease: amount stored in base units, confirmed against the invoice.
    const amountCheck = detectBaseUnitAmount(payment.amount, invoice?.amount, token.decimals);
    if (amountCheck.isBaseUnitsDisease) {
      findings.push({
        kind: "payment-amount-base-units",
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        chainKey: payment.chainKey,
        txHash: payment.txHash,
        description: `payment.amount '${payment.amount}' is base units; human amount is '${amountCheck.converted}' (${token.decimals} decimals via ${token.source})`,
        paymentPatch: { amount: amountCheck.converted },
      });
    }

    if (invoice) {
      // Disease: invoice.paymentTxHash holds an address (old code wrote the
      // to-address). Only CLEAR address shapes are flagged.
      if (isAddressShapedTxHash(invoice.paymentTxHash)) {
        findings.push({
          kind: "invoice-payment-tx-hash-is-address",
          paymentId: payment.id,
          invoiceId: invoice.id,
          chainKey: payment.chainKey,
          txHash: payment.txHash,
          description: `invoice.paymentTxHash '${invoice.paymentTxHash}' is address-shaped; real payment txHash is '${payment.txHash}'`,
          invoicePatch: { paymentTxHash: payment.txHash },
        });
      }

      // Disease: invoice stuck pending although a confirmed payment matches
      // its amount (directly, or once the base-units amount is converted).
      if (invoice.status === "pending" && payment.status === "confirmed") {
        const paymentMatchesInvoice =
          amountsEqual(payment.amount, invoice.amount) || amountCheck.matchesInvoice;
        if (paymentMatchesInvoice) {
          findings.push({
            kind: "invoice-stuck-pending",
            paymentId: payment.id,
            invoiceId: invoice.id,
            chainKey: payment.chainKey,
            txHash: payment.txHash,
            description: `invoice is pending but confirmed payment ${payment.id} matches its amount '${invoice.amount}'`,
            invoicePatch: { status: "paid", paidAt: payment.timestamp },
          });
        }
      }
    }
  }

  return {
    scannedPayments: payments.length,
    scannedInvoices: invoices.length,
    findings,
    orphanPayments,
  };
}

// ── repair ──────────────────────────────────────────────────────────────────

export interface ReconciliationReport extends ScanResult {
  dryRun: boolean;
  applied: { paymentsUpdated: number; invoicesUpdated: number } | null;
}

export interface ReconciliationOptions {
  /** Dry-run (report only) unless this is explicitly true. */
  apply?: boolean;
}

/**
 * Scan + (optionally) repair. DRY-RUN BY DEFAULT: without `apply: true`
 * nothing is written — no prisma update call is made at all.
 */
export async function runSettlementReconciliation(
  options: ReconciliationOptions = {}
): Promise<ReconciliationReport> {
  const scan = await scanSettlements();
  const apply = options.apply === true;
  if (!apply) {
    return { ...scan, dryRun: true, applied: null };
  }

  // Merge per-row patches (a single payment can carry both the amount and
  // symbol disease; a single invoice can carry both the txHash and
  // stuck-pending disease).
  const paymentPatches = new Map<string, PaymentRepairPatch>();
  const invoicePatches = new Map<string, InvoiceRepairPatch>();
  for (const finding of scan.findings) {
    if (finding.paymentPatch) {
      const prev = paymentPatches.get(finding.paymentId) ?? {};
      paymentPatches.set(finding.paymentId, { ...prev, ...finding.paymentPatch });
    }
    if (finding.invoicePatch && finding.invoiceId) {
      const prev = invoicePatches.get(finding.invoiceId) ?? {};
      invoicePatches.set(finding.invoiceId, { ...prev, ...finding.invoicePatch });
    }
  }

  let paymentsUpdated = 0;
  for (const [id, patch] of paymentPatches) {
    // Payment.txHash is deliberately absent from every patch — the
    // @@unique([chainKey, txHash]) constraint and the on-chain truth it
    // records must never be rewritten by reconciliation.
    await prisma.payment.update({ where: { id }, data: patch });
    paymentsUpdated += 1;
  }

  let invoicesUpdated = 0;
  for (const [id, patch] of invoicePatches) {
    if (patch.status === "paid") {
      // CAS-flip: only a still-pending invoice is paid; if a concurrent
      // settlement already flipped it, this updateMany matches 0 rows.
      const result = await prisma.invoice.updateMany({
        where: { id, status: "pending" },
        data: patch,
      });
      invoicesUpdated += result.count;
    } else {
      await prisma.invoice.update({ where: { id }, data: patch });
      invoicesUpdated += 1;
    }
  }

  return { ...scan, dryRun: false, applied: { paymentsUpdated, invoicesUpdated } };
}
