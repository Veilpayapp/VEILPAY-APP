/**
 * Stellar (XLM) Transaction Signer
 * Signs and submits XLM + classic asset (e.g. USDC) payments using the stored mnemonic.
 * Follows the same pattern as solanaSigner.ts.
 */

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
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

// Stellar minimum-balance protocol constants. An account's reserved (un-spendable)
// balance is `(2 + numSubentries) × BASE_RESERVE`, where a subentry is each
// trustline, offer, signer beyond the master key, or data entry on the account.
// See: https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance
const STELLAR_BASE_RESERVE_XLM = 0.5;

/**
 * Computes the minimum XLM balance that must remain in the account, given the
 * number of subentries reported by Horizon. Falls back to the bare-account
 * reserve (2 base reserves) when the count is missing or malformed.
 */
export function computeStellarMinReserveXlm(subentryCount: unknown): number {
  const n =
    typeof subentryCount === 'number' && Number.isFinite(subentryCount)
      ? Math.max(0, Math.floor(subentryCount))
      : 0;
  return (2 + n) * STELLAR_BASE_RESERVE_XLM;
}

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

function buildPaymentAsset(
  params: SignerParams,
  tokenCode?: string
): Asset {
  const issuer = params.tokenAddress?.trim();
  const code = (tokenCode || '').trim().toUpperCase();
  if (!issuer || !code || code === 'XLM') {
    return Asset.native();
  }
  if (!/^G[A-Z2-7]{55}$/.test(issuer)) {
    throw new TransactionError(`Invalid Stellar asset issuer: ${issuer}`, 'UNKNOWN');
  }
  // credit_alphanum4 for codes ≤ 4 chars (USDC); alphanum12 for longer.
  if (code.length <= 4) {
    return new Asset(code, issuer);
  }
  return new Asset(code, issuer);
}

function findAssetBalance(
  balances: Array<{
    balance: string;
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }>,
  asset: Asset
): number {
  if (asset.isNative()) {
    const native = balances.find((b) => b.asset_type === 'native');
    return parseFloat(native?.balance || '0');
  }
  const code = asset.getCode();
  const issuer = asset.getIssuer();
  const row = balances.find(
    (b) =>
      b.asset_type !== 'native' &&
      (b.asset_code || '').toUpperCase() === code.toUpperCase() &&
      b.asset_issuer === issuer
  );
  return parseFloat(row?.balance || '0');
}

/**
 * @param tokenCode - Classic asset code when sending non-native (e.g. "USDC").
 *   Issuer is `params.tokenAddress`. Omit / XLM → native payment.
 */
export async function signAndSendStellarTransaction(
  params: SignerParams & { tokenCode?: string },
  chainKey: string,
  xlmPriceUsd?: number
): Promise<SignerResult> {
  addBreadcrumb('Stellar transaction signing initiated', 'transaction', {
    chain: chainKey,
    asset: params.tokenCode || 'XLM',
  });

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
    const asset = buildPaymentAsset(params, params.tokenCode);
    const isNative = asset.isNative();

    // Load source account
    const accountData = await horizonFetch(`${horizonUrl}/accounts/${sourceAddress}`);
    const balances = accountData.balances || [];

    const feeXlm = STELLAR_FEE_STROOPS / XLM_STROOPS;
    const reserveXlm = computeStellarMinReserveXlm(accountData.subentry_count);
    const nativeBal = findAssetBalance(balances, Asset.native());

    // When sending native, include amount in the XLM requirement.
    // Classic assets (USDC) only need fee + reserve in XLM.
    const requiredXlm = isNative
      ? parsedAmount + feeXlm + reserveXlm
      : feeXlm + reserveXlm;

    if (nativeBal < requiredXlm) {
      throw new TransactionError(
        `Insufficient XLM for ${isNative ? 'payment' : 'fees/reserve'}. Balance: ${nativeBal.toFixed(7)} XLM, required: ${requiredXlm.toFixed(7)} XLM`,
        'INSUFFICIENT_FUNDS'
      );
    }

    if (!isNative) {
      const assetBal = findAssetBalance(balances, asset);
      if (assetBal < parsedAmount) {
        throw new TransactionError(
          `Insufficient ${asset.getCode()}. Balance: ${assetBal}, required: ${parsedAmount}. Ensure you have a trustline and funds.`,
          'INSUFFICIENT_FUNDS'
        );
      }
    }

    // Build transaction
    const account = new Account(sourceAddress, accountData.sequence);
    const txBuilder = new TransactionBuilder(account, {
      fee: String(STELLAR_FEE_STROOPS),
      networkPassphrase,
    });

    // Stellar amounts are decimal strings; 7 dp is the protocol max for payments.
    const amountStr = parsedAmount.toFixed(7).replace(/\.?0+$/, '') || '0';

    txBuilder.addOperation(
      Operation.payment({
        destination: toAddress,
        asset,
        amount: amountStr,
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

const STELLAR_CODE_RE = /^[A-Z0-9]{1,12}$/;
const STELLAR_G_RE = /^G[A-Z2-7]{55}$/;

/**
 * Establish (or raise) a trustline for a classic asset (code + issuer).
 * Required before the account can hold or receive that asset (e.g. custom USDC).
 */
export async function establishStellarTrustline(args: {
  chainKey: string;
  assetCode: string;
  assetIssuer: string;
  /** Max credit limit; default unlimited (MAX). */
  limit?: string;
  xlmPriceUsd?: number;
}): Promise<SignerResult> {
  const chainKey = args.chainKey;
  const code = args.assetCode.trim().toUpperCase();
  const issuer = args.assetIssuer.trim();

  if (!STELLAR_CODE_RE.test(code) || code === 'XLM') {
    throw new TransactionError(
      'Asset code must be 1–12 A–Z / 0–9 characters (not XLM)',
      'UNKNOWN'
    );
  }
  if (!STELLAR_G_RE.test(issuer)) {
    throw new TransactionError(`Invalid Stellar issuer address: ${issuer}`, 'INVALID_ADDRESS');
  }

  addBreadcrumb('Stellar changeTrust initiated', 'transaction', {
    chain: chainKey,
    code,
    issuer: `${issuer.slice(0, 4)}…${issuer.slice(-4)}`,
  });

  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) {
    throw new TransactionError('No wallet found. Please create or import a wallet first.', 'UNKNOWN');
  }

  try {
    const keypair = await deriveKeypair(mnemonicWords.join(' '));
    const sourceAddress = keypair.publicKey();
    const horizonUrl = getHorizonUrl(chainKey);
    const networkPassphrase = getStellarNetwork(chainKey);

    const accountData = await horizonFetch(`${horizonUrl}/accounts/${sourceAddress}`);
    const balances = accountData.balances || [];
    const nativeBal = findAssetBalance(balances, Asset.native());
    const feeXlm = STELLAR_FEE_STROOPS / XLM_STROOPS;
    // changeTrust adds a subentry → reserve rises by 0.5 XLM after success.
    const reserveNow = computeStellarMinReserveXlm(accountData.subentry_count);
    const reserveAfter = reserveNow + STELLAR_BASE_RESERVE_XLM;
    const requiredXlm = feeXlm + reserveAfter;
    if (nativeBal < requiredXlm) {
      throw new TransactionError(
        `Insufficient XLM to open a trustline. Need ~${requiredXlm.toFixed(2)} XLM (fee + reserve), have ${nativeBal.toFixed(7)} XLM.`,
        'INSUFFICIENT_FUNDS'
      );
    }

    const asset = new Asset(code, issuer);
    const account = new Account(sourceAddress, accountData.sequence);
    const txBuilder = new TransactionBuilder(account, {
      fee: String(STELLAR_FEE_STROOPS),
      networkPassphrase,
    });

    txBuilder.addOperation(
      Operation.changeTrust({
        asset,
        limit: args.limit, // undefined → max
      })
    );
    txBuilder.setTimeout(180);
    const transaction = txBuilder.build();
    transaction.sign(keypair);

    const submitRes = await horizonFetch(`${horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(transaction.toXDR())}`,
    });

    const txHash: string = submitRes.hash;
    const feeXlmCost = feeXlm;
    return {
      hash: txHash,
      chainId: chainKey === 'stellar' ? 1 : 0,
      gasEstimate: {
        gasLimit: 0n,
        maxFeePerGas: 0n,
        maxPriorityFeePerGas: 0n,
        gasPrice: 0n,
        estimatedCostWei: BigInt(STELLAR_FEE_STROOPS),
        estimatedCostEth: feeXlmCost.toFixed(7),
        estimatedCostUsd: args.xlmPriceUsd
          ? (feeXlmCost * args.xlmPriceUsd).toFixed(6)
          : null,
        isStale: false,
        fetchedAt: Date.now(),
      },
    };
  } catch (err) {
    if (err instanceof TransactionError) throw err;
    const message = (err as any)?.message || 'Unknown Stellar trustline error';
    captureError(new Error(message), { scope: 'stellar-signer-trustline', chain: chainKey });
    throw new TransactionError(message, 'UNKNOWN');
  }
}

/** Short issuer label for UI (GABC…WXYZ). */
export function formatStellarIssuerShort(issuer: string, head = 4, tail = 4): string {
  const s = issuer.trim();
  if (s.length < head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
