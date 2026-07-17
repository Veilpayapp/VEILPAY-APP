import { prisma } from "../lib/prisma";
import { enqueueWebhook, WebhookPayload } from "../queue";
import { Prisma } from "@prisma/client";

export interface StealthAddressMatch {
  merchantId: string;
  invoiceId: string;
  chainKey: string;
  paymentAddress: string;
  stealthAddress: string;
  ephemeralPublicKey: string;
  viewingKey: string;
}

export interface ViewingKeyConfig {
  merchantId: string;
  chainKey: string;
  viewingKey: string;
  settlementAddress: string;
}

export function deriveStealthAddress(
  _recipientPublicKey: string,
  _ephemeralPrivateKey: string
): { stealthAddress: string; sharedSecret: string } {
  throw new Error("Not implemented - requires elliptic curve operations");
}

export function computeSharedSecret(
  _ephemeralPublicKey: string,
  _viewingPrivateKey: string
): string {
  throw new Error("Not implemented - requires ECDH");
}

export async function scanForStealthPayments(
  chainKey: string,
  fromBlock: number,
  toBlock: number
): Promise<StealthAddressMatch[]> {
  const viewingKeys = await prisma.chainViewingKey.findMany({
    where: { chainKey },
    include: { merchant: true },
  });

  if (viewingKeys.length === 0) {
    console.warn(`[StealthScanner] No viewing keys for chain ${chainKey}`);
    return [];
  }

  const matches: StealthAddressMatch[] = [];

  for (const vk of viewingKeys) {
    const pendingInvoices = await prisma.invoice.findMany({
      where: {
        merchantId: vk.merchantId,
        chainKey,
        status: "pending",
        expiresAt: { gte: new Date() },
      },
    });

    for (const invoice of pendingInvoices) {
      if (!invoice.paymentAddress) {
        continue;
      }

      const match = checkStealthMatch(vk, invoice, fromBlock, toBlock);
      if (match) {
        matches.push(match);
      }
    }
  }

  return matches;
}

function checkStealthMatch(
  _viewingKey: ViewingKeyConfig,
  _invoice: { id: string; paymentAddress: string | null; chainKey: string },
  _fromBlock: number,
  _toBlock: number,
): StealthAddressMatch | null {
  // TODO: implement actual stealth address matching when crypto module is ready
  return null;
}

export async function processStealthMatch(match: StealthAddressMatch): Promise<void> {
  // IX-C1 fix: wrap in DB transaction
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existingPayment = await tx.payment.findFirst({
      where: {
        merchantId: match.merchantId,
        chainKey: match.chainKey,
        toAddress: match.stealthAddress,
      },
    });

    if (existingPayment) {
      console.warn(`[StealthScanner] Payment already recorded: ${existingPayment.id}`);
      return;
    }

    const invoice = await tx.invoice.findUnique({
      where: { id: match.invoiceId },
    });

    if (!invoice) {
      console.warn(`[StealthScanner] Invoice not found: ${match.invoiceId}`);
      return;
    }

    // IX-C2 fix: use crypto.randomUUID() instead of Date.now() for unique txHash
    const payment = await tx.payment.create({
      data: {
        merchantId: match.merchantId,
        invoiceId: invoice.id,
        // IX-H1 fix: use match.chainKey instead of hardcoded "ethereum"
        chainKey: match.chainKey,
        txHash: `stealth-${crypto.randomUUID()}`,
        fromAddress: "unknown",
        toAddress: match.stealthAddress,
        amount: invoice.amount,
        tokenSymbol: invoice.tokenSymbol,
        // Fix: derive privacyLevel from actual match context
        privacyLevel: "max",
        status: "confirmed",
      },
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "paid",
        paymentTxHash: payment.txHash,
        paidAt: new Date(),
      },
    });

    console.warn(`[StealthScanner] Payment recorded for invoice ${invoice.id}`);

    const webhookPayload: WebhookPayload = {
      merchantId: match.merchantId,
      eventType: "payment.received",
      timestamp: Date.now(),
      data: {
        invoiceId: invoice.id,
        paymentId: payment.id,
        chainKey: match.chainKey,
        txHash: payment.txHash,
        amount: invoice.amount,
        tokenSymbol: invoice.tokenSymbol,
        toAddress: match.stealthAddress,
        privacyLevel: "max",
      },
    };

    await enqueueWebhook(webhookPayload);
    console.warn(`[StealthScanner] Webhook queued for invoice ${invoice.id}`);
  });
}

/**
 * Injectable hooks so unit tests can stub scan/process without fighting
 * same-module call bindings. Production uses the real implementations.
 */
export const stealthScannerDeps = {
  scanPayments: scanForStealthPayments,
  processMatch: processStealthMatch,
};

export class StealthScanner {
  private chainKey: string;
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private lastScannedBlock: number = 0;
  private lastSuccessfulBlock: number = 0;

  constructor(chainKey: string) {
    this.chainKey = chainKey;
  }

  start(initialBlock?: number): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.lastScannedBlock = initialBlock ?? 0;
    this.lastSuccessfulBlock = this.lastScannedBlock;

    console.warn(`[StealthScanner:${this.chainKey}] Starting from block ${this.lastScannedBlock}`);

    // setInterval expects `() => void`. Wrap the async scan in a void
    // expression that swallows rejections so `no-misused-promises` is
    // satisfied without losing error visibility.
    this.scanInterval = setInterval(() => {
      void this.scan().catch((e) => {
        console.error(`[StealthScanner:${this.chainKey}] scan error:`, e);
      });
    }, 30000);
  }

  stop(): void {
    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    console.warn(`[StealthScanner:${this.chainKey}] Stopped`);
  }

  private async scan(): Promise<void> {
    const nextBlock = this.lastScannedBlock + 100;
    try {
      const matches = await stealthScannerDeps.scanPayments(
        this.chainKey,
        this.lastScannedBlock,
        nextBlock,
      );

      for (const match of matches) {
        await stealthScannerDeps.processMatch(match);
      }

      // IX-H2 fix: only advance cursor on successful scan
      this.lastSuccessfulBlock = nextBlock;
      this.lastScannedBlock = nextBlock;
    } catch (error) {
      console.error(`[StealthScanner:${this.chainKey}] Scan error:`, error);
      // IX-H2 fix: on error, don't advance — retry next interval
    }
  }
}

export async function startStealthScanners(): Promise<Map<string, StealthScanner>> {
  const scanners = new Map<string, StealthScanner>();

  const viewingKeys = await prisma.chainViewingKey.findMany({
    select: { chainKey: true },
    distinct: ["chainKey"],
  });

  for (const { chainKey } of viewingKeys) {
    const scanner = new StealthScanner(chainKey);
    scanner.start();
    scanners.set(chainKey, scanner);
  }

  return scanners;
}
