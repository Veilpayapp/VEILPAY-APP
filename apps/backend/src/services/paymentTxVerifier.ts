/**
 * SEC-001 residual: verify caller-reported payment facts against chain data
 * before `confirmInvoicePayment` mutates state.
 *
 * - EVM: viem getTransaction + receipt (success, recipient, native value).
 * - Non-EVM: Goldrush address history must contain a matching txHash with
 *   amount + token that match the invoice (same match helpers as the indexer).
 *
 * On success, returns a PaymentTxInput derived from verified chain facts so the
 * Payment row is not fully attacker-controlled.
 */

import {
  createPublicClient,
  formatEther,
  http,
  parseEther,
  type Chain,
} from 'viem';
import { mainnet, polygon, arbitrum, sepolia } from 'viem/chains';
import { amountsMatch } from '../jobs/chainIndexer';
import { fetchGoldrushTransactions } from './goldrush';
import type { PaymentTxInput } from './paymentProcessor';

const EVM_CHAIN_KEYS = new Set(['ethereum', 'polygon', 'arbitrum', 'sepolia']);

/** Native symbols that use tx.value (not ERC-20 transfer logs). */
const NATIVE_TOKEN_SYMBOLS = new Set([
  'ETH',
  'MATIC',
  'POL',
  'BNB',
  'AVAX',
]);

export interface InvoiceVerifyContext {
  id: string;
  chainKey: string;
  tokenSymbol: string;
  amount: string | number;
  paymentAddress: string | null;
}

export type PaymentTxVerifyResult =
  | { ok: true; tx: PaymentTxInput }
  | { ok: false; status: 400 | 409; error: string };

function getViemChain(chainKey: string): Chain {
  switch (chainKey) {
    case 'ethereum':
      return mainnet;
    case 'polygon':
      return polygon;
    case 'arbitrum':
      return arbitrum;
    case 'sepolia':
      return sepolia;
    default:
      return mainnet;
  }
}

function symbolsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || '').trim().toUpperCase() === (b || '').trim().toUpperCase();
}

function addressesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isNativeToken(symbol: string): boolean {
  return NATIVE_TOKEN_SYMBOLS.has(symbol.trim().toUpperCase());
}

/**
 * Verify a claimed payment against on-chain / indexer data for the invoice.
 *
 * @param invoice Invoice ownership/status already validated by the controller.
 * @param claimed Caller body fields (txHash required; others cross-checked).
 * @param options.minConfirmations Minimum confirmations for EVM receipts (default 0).
 */
export async function verifyPaymentTxOnChain(
  invoice: InvoiceVerifyContext,
  claimed: PaymentTxInput,
  options: { minConfirmations?: number } = {}
): Promise<PaymentTxVerifyResult> {
  const minConfirmations = options.minConfirmations ?? 0;
  const expectedRecipient = invoice.paymentAddress?.trim() || null;

  if (!expectedRecipient) {
    return {
      ok: false,
      status: 400,
      error: 'Invoice has no payment address; cannot verify on-chain payment',
    };
  }

  if (!amountsMatch(claimed.amount, invoice.amount)) {
    return {
      ok: false,
      status: 400,
      error: 'Claimed amount does not match invoice amount',
    };
  }

  if (!symbolsMatch(claimed.tokenSymbol, invoice.tokenSymbol)) {
    return {
      ok: false,
      status: 400,
      error: 'Claimed tokenSymbol does not match invoice',
    };
  }

  if (!addressesEqual(claimed.toAddress, expectedRecipient)) {
    return {
      ok: false,
      status: 400,
      error: 'toAddress does not match invoice payment address',
    };
  }

  if (EVM_CHAIN_KEYS.has(invoice.chainKey)) {
    return verifyEvmPayment(invoice, claimed, expectedRecipient, minConfirmations);
  }

  return verifyNonEvmViaGoldrush(invoice, claimed, expectedRecipient);
}

async function verifyEvmPayment(
  invoice: InvoiceVerifyContext,
  claimed: PaymentTxInput,
  expectedRecipient: string,
  minConfirmations: number
): Promise<PaymentTxVerifyResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(claimed.txHash)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid EVM transaction hash format',
    };
  }

  try {
    const publicClient = createPublicClient({
      chain: getViemChain(invoice.chainKey),
      transport: http(),
    });

    const txHash = claimed.txHash as `0x${string}`;
    const [tx, receipt, headBlock] = await Promise.all([
      publicClient.getTransaction({ hash: txHash }),
      publicClient.getTransactionReceipt({ hash: txHash }),
      publicClient.getBlockNumber(),
    ]);

    if (!receipt || receipt.status !== 'success') {
      return {
        ok: false,
        status: 400,
        error: 'Transaction failed or not found on-chain',
      };
    }

    if (!tx.to || !addressesEqual(tx.to, expectedRecipient)) {
      return {
        ok: false,
        status: 400,
        error: 'Transaction recipient does not match invoice payment address',
      };
    }

    const blockNumber = Number(receipt.blockNumber);
    if (minConfirmations > 0) {
      const confirmations = Number(headBlock - receipt.blockNumber) + 1;
      if (confirmations < minConfirmations) {
        return {
          ok: false,
          status: 400,
          error: `Transaction has ${confirmations} confirmation(s); need ${minConfirmations}`,
        };
      }
    }

    // Native transfers: enforce value from chain. ERC-20 paths still require a
    // successful receipt + recipient match; amount is cross-checked vs invoice
    // via the claimed amount gate above until log decoding ships.
    if (isNativeToken(invoice.tokenSymbol)) {
      const invoiceValue = parseEther(String(invoice.amount));
      if (tx.value < invoiceValue) {
        return {
          ok: false,
          status: 400,
          error: 'Transaction value is less than invoice amount',
        };
      }
    }

    const chainAmount = isNativeToken(invoice.tokenSymbol)
      ? formatEther(tx.value)
      : String(invoice.amount);

    return {
      ok: true,
      tx: {
        txHash: claimed.txHash,
        fromAddress: tx.from,
        toAddress: tx.to,
        amount: chainAmount,
        tokenSymbol: invoice.tokenSymbol,
        blockNumber,
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[paymentTxVerifier] EVM verify failed:', err);
    return {
      ok: false,
      status: 400,
      error: 'Failed to verify transaction on-chain',
    };
  }
}

async function verifyNonEvmViaGoldrush(
  invoice: InvoiceVerifyContext,
  claimed: PaymentTxInput,
  expectedRecipient: string
): Promise<PaymentTxVerifyResult> {
  try {
    const txs = await fetchGoldrushTransactions(invoice.chainKey, expectedRecipient);
    const match = txs.find(
      (t) => t.txHash.toLowerCase() === claimed.txHash.toLowerCase()
    );

    if (!match) {
      return {
        ok: false,
        status: 400,
        error:
          'Transaction not found for invoice payment address (indexer/Goldrush verify failed)',
      };
    }

    if (!addressesEqual(match.toAddress, expectedRecipient)) {
      return {
        ok: false,
        status: 400,
        error: 'Transaction recipient does not match invoice payment address',
      };
    }

    if (!amountsMatch(match.amount, invoice.amount)) {
      return {
        ok: false,
        status: 400,
        error: 'On-chain amount does not match invoice amount',
      };
    }

    if (!symbolsMatch(match.tokenSymbol, invoice.tokenSymbol)) {
      return {
        ok: false,
        status: 400,
        error: 'On-chain token does not match invoice tokenSymbol',
      };
    }

    return {
      ok: true,
      tx: {
        txHash: match.txHash,
        fromAddress: match.fromAddress,
        toAddress: match.toAddress,
        amount: match.amount,
        tokenSymbol: match.tokenSymbol,
        blockNumber: match.blockNumber,
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[paymentTxVerifier] Non-EVM verify failed:', err);
    return {
      ok: false,
      status: 400,
      error: 'Failed to verify transaction via indexer',
    };
  }
}
