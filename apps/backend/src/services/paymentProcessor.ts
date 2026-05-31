import { prisma } from '../lib/prisma';
import type { PrivacyLevel } from '@prisma/client';
import { enqueueWebhook } from '../jobs/webhookQueue';
import type { GoldrushTxResponse } from './goldrush';

interface InvoiceContext {
  id: string;
  merchantId: string;
  chainKey: string;
  tokenSymbol: string;
  amount: number | string;
  privacyLevel: PrivacyLevel;
}

export async function processPaymentMatch(
  invoice: InvoiceContext,
  tx: GoldrushTxResponse
): Promise<void> {
  // 1. Create Payment record
  await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      merchantId: invoice.merchantId,
      chainKey: invoice.chainKey,
      txHash: tx.txHash,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      amount: tx.amount,
      tokenSymbol: tx.tokenSymbol,
      privacyLevel: invoice.privacyLevel,
      status: 'confirmed',
      blockNumber: tx.blockNumber,
    },
  });

  // 2. Update Invoice
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: 'paid',
      paidAt: new Date(),
      paymentTxHash: tx.txHash,
    },
  });

  // 3. Fire Webhook
  await enqueueWebhook({
    eventType: 'payment.received',
    merchantId: invoice.merchantId,
    invoiceId: invoice.id,
    chainKey: invoice.chainKey,
    tokenSymbol: tx.tokenSymbol,
    amount: tx.amount,
    privacyLevel: invoice.privacyLevel,
    timestamp: Date.now(),
  });
}
