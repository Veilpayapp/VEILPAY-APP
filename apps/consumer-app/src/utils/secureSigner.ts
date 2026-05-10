/**
 * Veilpay Secure Signer
 *
 * Implements the signing closure pattern to eliminate mnemonic memory exposure.
 *
 * SECURITY DESIGN:
 * - The mnemonic is retrieved from SecureStore, used to derive the private key,
 *   sign and broadcast the transaction — all within a single async scope.
 * - The mnemonic string is never returned to the caller.
 * - The derived wallet object is local to the closure and eligible for GC
 *   immediately after the transaction is submitted.
 * - No intermediate variable holds key material across await boundaries
 *   unnecessarily.
 *
 * This eliminates the pattern:
 *   const mnemonic = await getStoredMnemonic();   // ← hangs in heap
 *   await sendTransaction(mnemonic, params, ...);  // ← still there
 *
 * And replaces it with:
 *   await signAndSendTransaction(params, chainKey); // mnemonic scope-local
 */

import { ethers, TransactionRequest, TransactionResponse, Wallet, HDNodeWallet, Mnemonic } from 'ethers';
import { poolCall } from './rpcPool';
import { getStoredMnemonic, TransactionError, NETWORKS } from './transactions';
import { estimateTransactionGas, GasEstimate } from './gasEstimator';
import { captureError, addBreadcrumb } from './sentry';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignerParams {
  /** Recipient address (checksummed or not — validated before use) */
  to: string;
  /** Amount in ETH as a string (e.g. '0.01') */
  value: string;
  /** Optional calldata */
  data?: string;
  /** Override gas estimate (optional) */
  gasOverride?: Pick<GasEstimate, 'gasLimit' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice'>;
}

export interface SignerResult {
  hash: string;
  /** Network chain ID */
  chainId: number;
  /** Gas estimate used for the transaction */
  gasEstimate: GasEstimate;
}

// BIP-44 derivation path for Ethereum (first account)
const ETHEREUM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

// ─── Core Signer ──────────────────────────────────────────────────────────────

/**
 * Retrieves the stored mnemonic, derives the private key, signs the transaction,
 * and broadcasts it — all within a single local scope.
 *
 * The mnemonic is NEVER returned to the caller.
 * Key material is local to this function's stack frame.
 *
 * @param params    - Transaction parameters (to, value, data)
 * @param chainKey  - Chain to send on (e.g. 'ethereum', 'sepolia')
 * @param ethPrice  - Current ETH price for USD gas estimate (optional)
 * @throws TransactionError on validation, signing, or broadcast failure
 */
export async function signAndSendTransaction(
  params: SignerParams,
  chainKey: string,
  ethPrice?: number
): Promise<SignerResult> {
  // ── 1. Validate recipient ─────────────────────────────────────────────────
  addBreadcrumb('Transaction signing initiated', 'transaction', { chain: chainKey });

  const toAddress = params.to.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
    throw new TransactionError(
      `Invalid recipient address: ${toAddress}`,
      'INVALID_ADDRESS'
    );
  }

  // ── 2. Validate network ───────────────────────────────────────────────────
  const network = NETWORKS[chainKey];
  if (!network) {
    throw new TransactionError(
      `Unsupported network: ${chainKey}. Did you add it to NETWORKS in transactions.ts?`,
      'UNKNOWN'
    );
  }

  // ── 3. Parse and validate amount ──────────────────────────────────────────
  let valueWei: bigint;
  try {
    valueWei = ethers.parseEther(params.value);
  } catch {
    throw new TransactionError(
      `Invalid ETH amount: ${params.value}`,
      'UNKNOWN'
    );
  }

  if (valueWei <= 0n) {
    throw new TransactionError('Transaction value must be greater than zero', 'UNKNOWN');
  }

  // ── 4. Retrieve mnemonic (scope-local — never returned) ───────────────────
  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) {
    throw new TransactionError(
      'No wallet found. Please create or import a wallet first.',
      'UNKNOWN'
    );
  }

  // ── 5. Derive wallet (scope-local — never returned) ───────────────────────
  // The HDNodeWallet is created here and goes out of scope when the tx resolves.
  let txResult: SignerResult;
  try {
    const mnemonicPhrase = mnemonicWords.join(' ');
    const mnemonicObj = Mnemonic.fromPhrase(mnemonicPhrase);
    const wallet: HDNodeWallet = HDNodeWallet.fromMnemonic(mnemonicObj, ETHEREUM_DERIVATION_PATH);

    // ── 6. Gas estimation ─────────────────────────────────────────────────
    const gasEstimate = params.gasOverride
      ? {
          gasLimit: params.gasOverride.gasLimit,
          maxFeePerGas: params.gasOverride.maxFeePerGas,
          maxPriorityFeePerGas: params.gasOverride.maxPriorityFeePerGas,
          gasPrice: params.gasOverride.gasPrice,
          estimatedCostWei: params.gasOverride.gasLimit * params.gasOverride.maxFeePerGas,
          estimatedCostEth: '0',
          estimatedCostUsd: null,
          isStale: true,
          fetchedAt: Date.now(),
        }
      : await estimateTransactionGas(
          { to: toAddress, value: valueWei, data: params.data, from: wallet.address },
          chainKey,
          ethPrice
        );

    // ── 7. Balance check ──────────────────────────────────────────────────
    const balance = await poolCall(chainKey, (p) => p.getBalance(wallet.address));
    const requiredWei = valueWei + gasEstimate.estimatedCostWei;

    if (balance < requiredWei) {
      throw new TransactionError(
        `Insufficient funds. ` +
        `Balance: ${ethers.formatEther(balance)} ETH, ` +
        `Required: ${ethers.formatEther(requiredWei)} ETH ` +
        `(${params.value} ETH + ~${gasEstimate.estimatedCostEth} ETH gas)`,
        'INSUFFICIENT_FUNDS'
      );
    }

    // ── 8. Build and sign transaction ─────────────────────────────────────
    const txRequest: TransactionRequest = {
      to: toAddress,
      value: valueWei,
      chainId: network.chainId,
      gasLimit: gasEstimate.gasLimit,
      // Prefer EIP-1559 fields; fall back to legacy gasPrice
      ...(gasEstimate.maxFeePerGas > 0n
        ? {
            maxFeePerGas: gasEstimate.maxFeePerGas,
            maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
          }
        : {
            gasPrice: gasEstimate.gasPrice,
          }),
    };

    if (params.data) {
      txRequest.data = params.data;
    }

    // ── 9. Connect wallet and broadcast ───────────────────────────────────
    const txResponse: TransactionResponse = await poolCall(chainKey, async (provider) => {
      const connectedWallet = wallet.connect(provider);
      return connectedWallet.sendTransaction(txRequest);
    });

  txResult = {
    hash: txResponse.hash,
    chainId: network.chainId,
    gasEstimate,
  };

  addBreadcrumb('Transaction broadcast successful', 'transaction', {
    chain: chainKey,
    txHash: txResponse.hash,
  });
  } catch (err) {
    if (err instanceof TransactionError) throw err;

    // Normalise ethers.js error codes
    const anyErr = err as any;
    if (anyErr?.code === 'INSUFFICIENT_FUNDS') {
      throw new TransactionError('Insufficient funds for gas or value', 'INSUFFICIENT_FUNDS');
    }
    if (anyErr?.code === 'NETWORK_ERROR') {
      throw new TransactionError('Network error. Please check your connection.', 'NETWORK_ERROR');
    }
    if (anyErr?.code === 'ACTION_REJECTED') {
      throw new TransactionError('Transaction rejected by user', 'USER_REJECTED');
    }

    const message = anyErr?.message || 'Unknown signing error';
    captureError(new Error(message), { scope: 'secure-signer', chain: chainKey });
    throw new TransactionError(message, 'UNKNOWN');
  }

  return txResult;
}

/**
 * Derives the public wallet address from the stored mnemonic WITHOUT
 * exposing the mnemonic or private key to the caller.
 *
 * Safe to call for display/verification purposes.
 *
 * @returns Checksummed EVM address, or null if no wallet is stored
 */
export async function deriveAddressFromStoredMnemonic(): Promise<string | null> {
  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) return null;

  try {
    const mnemonicPhrase = mnemonicWords.join(' ');
    const mnemonicObj = Mnemonic.fromPhrase(mnemonicPhrase);
    const wallet: HDNodeWallet = HDNodeWallet.fromMnemonic(mnemonicObj, ETHEREUM_DERIVATION_PATH);
    return wallet.address;
  } catch {
    return null;
  }
}

export interface ReplaceTransactionParams {
  originalTxHash: string;
  chainKey: string;
  mode: 'speedup' | 'cancel';
  ethPrice?: number;
}

const SPEED_UP_MULTIPLIER = 1.1;
const CANCEL_VALUE = '0';

export async function replaceTransaction(
  params: ReplaceTransactionParams
): Promise<SignerResult> {
  addBreadcrumb('Transaction replacement initiated', 'transaction', {
    chain: params.chainKey,
    mode: params.mode,
  });

  const network = NETWORKS[params.chainKey];
  if (!network) {
    throw new TransactionError(`Unsupported network: ${params.chainKey}`, 'UNKNOWN');
  }

  const originalTx = await poolCall(params.chainKey, (p) => p.getTransaction(params.originalTxHash));
  if (!originalTx) {
    throw new TransactionError('Original transaction not found', 'UNKNOWN');
  }

  if (originalTx.blockNumber !== null) {
    throw new TransactionError('Original transaction already confirmed — cannot replace', 'UNKNOWN');
  }

  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) {
    throw new TransactionError('No wallet found. Please create or import a wallet first.', 'UNKNOWN');
  }

  let txResult: SignerResult;
  try {
    const mnemonicPhrase = mnemonicWords.join(' ');
    const mnemonicObj = Mnemonic.fromPhrase(mnemonicPhrase);
    const wallet: HDNodeWallet = HDNodeWallet.fromMnemonic(mnemonicObj, ETHEREUM_DERIVATION_PATH);

    const baseFeeData = await poolCall(params.chainKey, (p) => p.getFeeData());

    const originalMaxFee = originalTx.maxFeePerGas ?? originalTx.gasPrice ?? baseFeeData.gasPrice ?? 0n;
    const originalPriorityFee = originalTx.maxPriorityFeePerGas ?? baseFeeData.maxPriorityFeePerGas ?? 0n;

    const multiplier = BigInt(Math.round(SPEED_UP_MULTIPLIER * 100));
    const newMaxFeePerGas: bigint = params.mode === 'speedup'
      ? (originalMaxFee * multiplier) / 100n
      : ((baseFeeData.gasPrice ?? 0n) * 12n) / 10n;

    const newMaxPriorityFeePerGas: bigint = params.mode === 'speedup'
      ? (originalPriorityFee * multiplier) / 100n
      : ((baseFeeData.maxPriorityFeePerGas ?? 0n) * 12n) / 10n;

    const nonce = originalTx.nonce;
    const to = params.mode === 'cancel' ? wallet.address : (originalTx.to ?? wallet.address);
    const value = params.mode === 'cancel' ? 0n : (originalTx.value ?? 0n);
    const gasLimit: bigint = originalTx.gasLimit ?? 21000n;

    const txRequest: TransactionRequest = {
      to,
      value,
      chainId: network.chainId,
      nonce,
      gasLimit,
      maxFeePerGas: newMaxFeePerGas,
      maxPriorityFeePerGas: newMaxPriorityFeePerGas,
      type: 2,
    };

    const txResponse: TransactionResponse = await poolCall(params.chainKey, async (provider) => {
      const connectedWallet = wallet.connect(provider);
      return connectedWallet.sendTransaction(txRequest);
    });

    const estimatedCostWei = gasLimit * newMaxFeePerGas;
    const gasEstimate: GasEstimate = {
      gasLimit,
      maxFeePerGas: newMaxFeePerGas,
      maxPriorityFeePerGas: newMaxPriorityFeePerGas,
      gasPrice: newMaxFeePerGas,
      estimatedCostWei,
      estimatedCostEth: ethers.formatEther(estimatedCostWei),
      estimatedCostUsd: params.ethPrice
        ? (parseFloat(ethers.formatEther(estimatedCostWei)) * params.ethPrice).toFixed(2)
        : null,
      isStale: false,
      fetchedAt: Date.now(),
    };

    txResult = {
      hash: txResponse.hash,
      chainId: network.chainId,
      gasEstimate,
    };

    addBreadcrumb('Transaction replacement broadcast successful', 'transaction', {
      chain: params.chainKey,
      mode: params.mode,
      txHash: txResponse.hash,
      replacing: params.originalTxHash,
    });
  } catch (err) {
    if (err instanceof TransactionError) throw err;

    const anyErr = err as any;
    const message = anyErr?.message || 'Unknown replacement error';
    captureError(new Error(message), { scope: 'secure-signer-replace', chain: params.chainKey });
    throw new TransactionError(message, 'UNKNOWN');
  }

  return txResult;
}
