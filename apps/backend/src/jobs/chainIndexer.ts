/**
 * VeilPay Multi-Chain Indexer (Solana & Aptos)
 * 
 * Periodically polls the Goldrush API for incoming transactions matching 
 * pending invoices on SVM and MVM chains.
 */

import { prisma } from '../lib/prisma';
import { fetchGoldrushTransactions } from '../services/goldrush';
import { processPaymentMatch } from '../services/paymentProcessor';
import { withRedisLock } from '../lib/redisLock';

let indexerInterval: NodeJS.Timeout | null = null;
const POLL_INTERVAL_MS = 15000; // 15 seconds

export async function sweepPendingInvoices(): Promise<void> {
  try {
    const pendingInvoices = await prisma.invoice.findMany({
      where: {
        status: 'pending',
        chainKey: { in: ['solana', 'aptos', 'solana-devnet', 'aptos-mainnet', 'stellar', 'stellar-testnet'] },
        paymentAddress: { not: null },
      },
      include: {
        merchant: true,
      }
    });

    if (pendingInvoices.length === 0) return;

    for (const invoice of pendingInvoices) {
      if (!invoice.paymentAddress) continue;

      const txs = await fetchGoldrushTransactions(invoice.chainKey, invoice.paymentAddress);
      
      for (const tx of txs) {
        // Simple heuristic: amount must match exactly (or be slightly greater for fuzziness)
        // In production, we'd handle decimals properly.
        if (tx.amount === invoice.amount.toString() && tx.tokenSymbol === invoice.tokenSymbol) {
          // eslint-disable-next-line no-console
          console.log(`[ChainIndexer] Found matching payment for invoice ${invoice.id} on ${invoice.chainKey}`);
          
          await processPaymentMatch({
            id: invoice.id,
            merchantId: invoice.merchantId,
            chainKey: invoice.chainKey,
            tokenSymbol: invoice.tokenSymbol,
            amount: invoice.amount.toString(),
            privacyLevel: invoice.privacyLevel,
          }, tx);
        }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[ChainIndexer] Error sweeping invoices:`, error);
  }
}

export function startChainIndexer(): void {
  if (indexerInterval) return;
  // eslint-disable-next-line no-console
  console.log(`[ChainIndexer] Starting Goldrush polling worker...`);
  indexerInterval = setInterval(() => {
    withRedisLock('chain_indexer', 10000, async () => {
      await sweepPendingInvoices();
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[ChainIndexer] Unhandled sweep error:', err);
    });
  }, POLL_INTERVAL_MS);
}

export function stopChainIndexer(): void {
  if (indexerInterval) {
    clearInterval(indexerInterval);
    indexerInterval = null;
    // eslint-disable-next-line no-console
    console.log(`[ChainIndexer] Polling worker stopped.`);
  }
}
