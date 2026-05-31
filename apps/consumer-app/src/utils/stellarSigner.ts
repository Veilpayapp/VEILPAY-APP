/**
 * Stellar (XLM) Transaction Signer
 * Signs and submits XLM payment transactions using the stored mnemonic.
 * Follows the same pattern as solanaSigner.ts.
 */

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
  Account,
} from 'stellar-sdk';
import { mnemonicToSeed } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import { getStoredMnemonic, TransactionError } from './transactions';
import { captureError, addBreadcrumb } from './sentry';
import type { SignerParams, SignerResult } from './secureSigner';
import type { GasEstimate } from './gasEstimator';

const STELLAR_FEE_STROOPS = 100; // 0.00001 XLM (1 stroop = 0.0000001 XLM)
const XLM_STROOPS = 10_000_000; // 1 XLM = 10,000,000 stroops
const HORIZON_TIMEOUT_MS = 30_000;

// BIP-44 derivation path for Stellar (SLIP-0010 ed25519)
const STELLAR_DERIVATION_PATH = "m/44'/148'/0'";

function getHorizonUrl(chainKey: string): string {
  return chainKey === 'stellar'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
}

function getStellarNetwork(chainKey: string): string {
  return chainKey === 'stellar' ? Networks.PUBLIC : Networks.TESTNET;
}

async function deriveKeypair(mnemonicPhrase: string): Promise<Keypair> {
  const seed = await mnemonicToSeed(mnemonicPhrase);
  const { key } = derivePath(STELLAR_DERIVATION_PATH, Buffer.from(seed).toString('hex'));
  return Keypair.fromRawEd25519Seed(key as any);
}

async function horizonFetch(url: string, options?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HORIZON_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json();
    if (!res.ok) {
      const detail = data?.extras?.result_codes?.transaction || data?.title || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function signAndSendStellarTransaction(
  params: SignerParams,
  chainKey: string,
  xlmPriceUsd?: number
): Promise<SignerResult> {
  addBreadcrumb('Stellar transaction signing initiated', 'transaction', { chain: chainKey });

  const toAddress = params.to.trim();

  // Validate destination address format (Stellar addresses are 56 chars starting with G)
  if (!/^G[A-Z2-7]{55}$/.test(toAddress)) {
    throw new TransactionError(`Invalid Stellar address: ${toAddress}`, 'INVALID_ADDRESS');
  }

  const parsedAmount = parseFloat(params.value);
  if (!isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new TransactionError('Amount must be greater than zero', 'UNKNOWN');
  }

  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) {
    throw new TransactionError('No wallet found. Please create or import a wallet first.', 'UNKNOWN');
  }

  try {
    const mnemonicPhrase = mnemonicWords.join(' ');
    const keypair = await deriveKeypair(mnemonicPhrase);
    const sourceAddress = keypair.publicKey();
    const horizonUrl = getHorizonUrl(chainKey);
    const networkPassphrase = getStellarNetwork(chainKey);

    // Load source account
    const accountData = await horizonFetch(`${horizonUrl}/accounts/${sourceAddress}`);

    // Check XLM balance
    const nativeBalance = accountData.balances?.find((b: any) => b.asset_type === 'native');
    const balanceXlm = parseFloat(nativeBalance?.balance || '0');
    const feeXlm = STELLAR_FEE_STROOPS / XLM_STROOPS;
    // Stellar requires minimum balance of 1 XLM (base reserve × 2) — keep 1 XLM as reserve
    const reserveXlm = 1;
    const requiredXlm = parsedAmount + feeXlm + reserveXlm;

    if (balanceXlm < requiredXlm) {
      throw new TransactionError(
        `Insufficient XLM. Balance: ${balanceXlm.toFixed(7)} XLM, required: ${requiredXlm.toFixed(7)} XLM (incl. reserve)`,
        'INSUFFICIENT_FUNDS'
      );
    }

    // Build transaction
    const account = new Account(sourceAddress, accountData.sequence);
    const txBuilder = new TransactionBuilder(account, {
      fee: String(STELLAR_FEE_STROOPS),
      networkPassphrase,
    });

    txBuilder.addOperation(
      Operation.payment({
        destination: toAddress,
        asset: Asset.native(),
        amount: parsedAmount.toFixed(7),
      })
    );

    if (params.data) {
      // data field carries optional memo text (max 28 bytes for Stellar text memo)
      const memoText = params.data.slice(0, 28);
      txBuilder.addMemo(Memo.text(memoText));
    }

    txBuilder.setTimeout(180); // 3 minute validity window
    const transaction = txBuilder.build();
    transaction.sign(keypair);

    const xdr = transaction.toXDR();

    // Submit to Horizon
    const submitRes = await horizonFetch(`${horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(xdr)}`,
    });

    const txHash: string = submitRes.hash;

    const estimatedCostXlm = feeXlm;
    const gasEstimate: GasEstimate = {
      gasLimit: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      gasPrice: 0n,
      estimatedCostWei: BigInt(STELLAR_FEE_STROOPS),
      estimatedCostEth: estimatedCostXlm.toFixed(7), // repurposed as XLM cost string
      estimatedCostUsd: xlmPriceUsd
        ? (estimatedCostXlm * xlmPriceUsd).toFixed(6)
        : null,
      isStale: false,
      fetchedAt: Date.now(),
    };

    addBreadcrumb('Stellar transaction submitted', 'transaction', { chain: chainKey, txHash });

    return {
      hash: txHash,
      chainId: chainKey === 'stellar' ? 1 : 0,
      gasEstimate,
    };
  } catch (err) {
    if (err instanceof TransactionError) throw err;
    const message = (err as any)?.message || 'Unknown Stellar signing error';
    captureError(new Error(message), { scope: 'stellar-signer', chain: chainKey });
    throw new TransactionError(message, 'UNKNOWN');
  }
}
