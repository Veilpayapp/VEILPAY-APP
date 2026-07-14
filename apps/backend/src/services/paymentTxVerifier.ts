/**
 * SEC-001 residual: verify caller-reported payment facts against chain data
 * before `confirmInvoicePayment` mutates state.
 *
 * - EVM: viem getTransaction + receipt (success, recipient, native value / ERC-20 logs).
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
  parseUnits,
  getAddress,
  type Chain,
} from 'viem';
import {
  mainnet,
  polygon,
  arbitrum,
  sepolia,
  base,
  optimism,
  bsc,
} from 'viem/chains';
import { amountsMatch } from '../jobs/chainIndexer';
import { config } from '../config';
import { getEvmHttpTransportUrl } from '../lib/rpcEndpoints';
import {
  expectedTokenAddressForInvoice,
  isNativeTokenSymbol,
} from '../lib/tokenRegistry';
import { fetchGoldrushTransactions, GoldrushError } from './goldrush';
import { verifyStellarPayment, StellarHorizonError } from './stellarHorizon';
import type { PaymentTxInput } from './paymentProcessor';

/** Product EVM chains — must stay aligned with packages/shared SUPPORTED_CHAINS. */
const EVM_CHAIN_KEYS = new Set([
  'ethereum',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'bsc',
  'sepolia',
]);

/** keccak256("Transfer(address,address,uint256)") */
const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const ERC20_META_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

export interface InvoiceVerifyContext {
  id: string;
  chainKey: string;
  tokenSymbol: string;
  amount: string | number;
  paymentAddress: string | null;
  /** Expected ERC-20 contract; when set, log.address must match (anti spoof-symbol). */
  tokenAddress?: string | null;
}

export type PaymentTxVerifyResult =
  | { ok: true; tx: PaymentTxInput }
  | { ok: false; status: 400 | 409; error: string };

function getViemChain(chainKey: string): Chain | null {
  switch (chainKey) {
    case 'ethereum':
      return mainnet;
    case 'polygon':
      return polygon;
    case 'arbitrum':
      return arbitrum;
    case 'optimism':
      return optimism;
    case 'base':
      return base;
    case 'bsc':
      return bsc;
    case 'sepolia':
      return sepolia;
    default:
      return null;
  }
}

function symbolsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || '').trim().toUpperCase() === (b || '').trim().toUpperCase();
}

function addressesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Verify a claimed payment against on-chain / indexer data for the invoice.
 *
 * @param invoice Invoice ownership/status already validated by the controller.
 * @param claimed Caller body fields (txHash required; others cross-checked).
 * @param options.minConfirmations Minimum confirmations for EVM receipts
 *   (default: config.paymentMinConfirmations).
 */
export async function verifyPaymentTxOnChain(
  invoice: InvoiceVerifyContext,
  claimed: PaymentTxInput,
  options: { minConfirmations?: number } = {}
): Promise<PaymentTxVerifyResult> {
  const minConfirmations = options.minConfirmations ?? config.paymentMinConfirmations;
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

  const chain = invoice.chainKey.trim().toLowerCase();
  if (chain === 'stellar' || chain === 'stellar-testnet') {
    return verifyNonEvmViaStellar(invoice, claimed, expectedRecipient);
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

  const chain = getViemChain(invoice.chainKey);
  if (!chain) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported EVM chainKey: ${invoice.chainKey}`,
    };
  }

  const rpcUrl = getEvmHttpTransportUrl(invoice.chainKey);
  if (!rpcUrl) {
    return {
      ok: false,
      status: 400,
      error: `No RPC URL configured for chainKey: ${invoice.chainKey}`,
    };
  }

  try {
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
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

    if (isNativeTokenSymbol(invoice.tokenSymbol)) {
      if (!tx.to || !addressesEqual(tx.to, expectedRecipient)) {
        return {
          ok: false,
          status: 400,
          error: 'Transaction recipient does not match invoice payment address',
        };
      }

      const invoiceValue = parseEther(String(invoice.amount));
      if (tx.value < invoiceValue) {
        return {
          ok: false,
          status: 400,
          error: 'Transaction value is less than invoice amount',
        };
      }

      return {
        ok: true,
        tx: {
          txHash: claimed.txHash,
          fromAddress: tx.from,
          toAddress: tx.to,
          amount: formatEther(tx.value),
          tokenSymbol: invoice.tokenSymbol,
          blockNumber,
        },
      };
    }

    // ERC-20: require a known/configured token contract; match log.address to it.
    return verifyErc20Payment(
      publicClient,
      invoice,
      claimed,
      expectedRecipient,
      receipt.logs,
      tx.from,
      blockNumber,
    );
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

function topicToAddress(topic: string): string | null {
  if (typeof topic !== 'string' || topic.length !== 66) return null;
  try {
    return getAddress('0x' + topic.slice(26));
  } catch {
    return null;
  }
}

async function verifyErc20Payment(
  publicClient: ReturnType<typeof createPublicClient>,
  invoice: InvoiceVerifyContext,
  claimed: PaymentTxInput,
  expectedRecipient: string,
  logs: readonly { address: string; topics: readonly string[] | string[]; data: string }[],
  fromAddress: string,
  blockNumber: number,
): Promise<PaymentTxVerifyResult> {
  const expectedToken = expectedTokenAddressForInvoice({
    chainKey: invoice.chainKey,
    tokenSymbol: invoice.tokenSymbol,
    tokenAddress: invoice.tokenAddress,
  });

  if (!expectedToken) {
    return {
      ok: false,
      status: 400,
      error:
        'Invoice ERC-20 has no configured tokenAddress (and symbol is not in the chain token registry); cannot verify without contract identity',
    };
  }

  let expectedTokenChecksum: string;
  try {
    expectedTokenChecksum = getAddress(expectedToken);
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Invoice tokenAddress is not a valid EVM address',
    };
  }

  // Credits to the payment address from the expected token contract only.
  const credits = logs.filter((log) => {
    const topics = log.topics as string[];
    if (!topics || topics.length < 3) return false;
    if (topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) return false;
    if (!addressesEqual(log.address, expectedTokenChecksum)) return false;
    const to = topicToAddress(topics[2]);
    return !!to && addressesEqual(to, expectedRecipient);
  });

  if (credits.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No ERC-20 transfer from the expected token contract to the invoice payment address found in transaction',
    };
  }

  let decimals: number;
  let symbol: string;
  try {
    const [d, s] = await Promise.all([
      publicClient.readContract({
        address: expectedTokenChecksum as `0x${string}`,
        abi: ERC20_META_ABI,
        functionName: 'decimals',
      }),
      publicClient.readContract({
        address: expectedTokenChecksum as `0x${string}`,
        abi: ERC20_META_ABI,
        functionName: 'symbol',
      }),
    ]);
    decimals = Number(d);
    symbol = String(s);
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Failed to read token metadata for expected token contract',
    };
  }

  // Symbol is UX only — still cross-check but contract address is authoritative.
  if (!symbolsMatch(symbol, invoice.tokenSymbol)) {
    return {
      ok: false,
      status: 400,
      error: 'On-chain token symbol does not match invoice tokenSymbol for the configured contract',
    };
  }

  let expected: bigint;
  try {
    expected = parseUnits(String(invoice.amount), decimals);
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Invoice amount is not representable for the token decimals',
    };
  }

  // Sum all matching credits (router / multi-hop txs may split transfers).
  let totalTransferred = 0n;
  for (const log of credits) {
    try {
      const transferred = BigInt(log.data && log.data !== '0x' ? log.data : '0x0');
      totalTransferred += transferred;
    } catch {
      // skip malformed log data
    }
  }

  if (totalTransferred < expected) {
    return {
      ok: false,
      status: 400,
      error: 'ERC-20 transfer amount is less than invoice amount',
    };
  }

  const human = formatUnitsSafe(totalTransferred, decimals);
  return {
    ok: true,
    tx: {
      txHash: claimed.txHash,
      fromAddress,
      toAddress: expectedRecipient,
      amount: human,
      tokenSymbol: invoice.tokenSymbol,
      blockNumber,
    },
  };
}

function formatUnitsSafe(value: bigint, decimals: number): string {
  if (decimals <= 0) return value.toString();
  const negative = value < 0n;
  const s = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

async function verifyNonEvmViaStellar(
  invoice: InvoiceVerifyContext,
  claimed: PaymentTxInput,
  expectedRecipient: string
): Promise<PaymentTxVerifyResult> {
  const expectedToken = expectedTokenAddressForInvoice({
    chainKey: invoice.chainKey,
    tokenSymbol: invoice.tokenSymbol,
    tokenAddress: invoice.tokenAddress,
  });

  try {
    const result = await verifyStellarPayment({
      chainKey: invoice.chainKey,
      txHash: claimed.txHash,
      paymentAddress: expectedRecipient,
      amount: String(invoice.amount),
      tokenSymbol: invoice.tokenSymbol,
      tokenAddress: expectedToken,
    });

    if (!result.ok) {
      return { ok: false, status: 400, error: result.error };
    }

    return {
      ok: true,
      tx: {
        txHash: result.tx.txHash,
        fromAddress: result.tx.fromAddress,
        toAddress: result.tx.toAddress,
        amount: result.tx.amount,
        tokenSymbol: result.tx.tokenSymbol,
        blockNumber: result.tx.blockNumber,
      },
    };
  } catch (err) {
    if (err instanceof StellarHorizonError) {
      return { ok: false, status: 400, error: err.message };
    }
    // eslint-disable-next-line no-console
    console.error('[paymentTxVerifier] Stellar verify failed:', err);
    return {
      ok: false,
      status: 400,
      error: 'Failed to verify Stellar transaction via Horizon',
    };
  }
}

async function verifyNonEvmViaGoldrush(
  invoice: InvoiceVerifyContext,
  claimed: PaymentTxInput,
  expectedRecipient: string
): Promise<PaymentTxVerifyResult> {
  if (!config.rpc.goldrushApiKey) {
    return {
      ok: false,
      status: 400,
      error: 'Indexer verification unavailable (GOLDRUSH_API_KEY not configured)',
    };
  }

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

    // Optional mint binding for SPL when invoice carries tokenAddress.
    const expectedMint = expectedTokenAddressForInvoice({
      chainKey: invoice.chainKey,
      tokenSymbol: invoice.tokenSymbol,
      tokenAddress: invoice.tokenAddress,
    });
    if (
      expectedMint &&
      match.tokenAddress &&
      !addressesEqual(match.tokenAddress, expectedMint)
    ) {
      return {
        ok: false,
        status: 400,
        error: 'On-chain token mint does not match invoice tokenAddress',
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
    if (err instanceof GoldrushError) {
      return {
        ok: false,
        status: 400,
        error: err.message,
      };
    }
    // eslint-disable-next-line no-console
    console.error('[paymentTxVerifier] Non-EVM verify failed:', err);
    return {
      ok: false,
      status: 400,
      error: 'Failed to verify transaction via indexer',
    };
  }
}
