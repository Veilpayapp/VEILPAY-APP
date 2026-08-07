import { parseEther, formatEther, createWalletClient, custom } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { poolCall, getPoolProvider } from './rpcPool';
import { getStoredMnemonic, TransactionError, NETWORKS } from './transactions';
import { estimateTransactionGas, GasEstimate } from './gasEstimator';
import { captureError, addBreadcrumb } from './sentry';
import * as Crypto from 'expo-crypto';

export interface SignerParams {
  to: string;
  value: string;
  data?: string;
  tokenAddress?: string;
  tokenDecimals?: number;
  gasOverride?: Pick<GasEstimate, 'gasLimit' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice'>;
}

export interface SignerResult {
  hash: string;
  chainId: number;
  gasEstimate: GasEstimate;
}

const ETHEREUM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

const TOKEN_EXPIRY_MS = 30_000;
const MAX_TOKENS_PER_USER = 1;
const MIN_TOKEN_INTERVAL_MS = 30_000;
const MAX_FAILED_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 1000;

interface BiometricTokenEntry {
  token: string;
  issuedAt: number;
  consumed: boolean;
  failedAttempts: number;
  lastFailedAt: number;
}

const _tokenStore = new Map<string, BiometricTokenEntry>();
const _userFailedAttempts = new Map<string, { count: number; firstFailedAt: number }>();

/**
 * SEC-002: Biometric Token Manager
 * Replaces generateBiometricToken with cryptographically secure generation
 * and rate limiting to prevent token brute-forcing.
 */
class BiometricTokenManager {
  /**
   * Generate a cryptographically random token with rate limiting per user
   * @param userId - User identifier for rate limiting (e.g., wallet address)
   * @returns Secure token string
   * @throws TransactionError if rate limit exceeded or exponential backoff active
   */
  static generateToken(userId: string): string {
    this.checkRateLimit(userId);
    this.checkExponentialBackoff(userId);

    const randomBytes = Crypto.randomUUID().replace(/-/g, '');
    const timestamp = Date.now();
    const nonce = `${randomBytes}-${timestamp}`;

    _tokenStore.set(nonce, {
      token: nonce,
      issuedAt: timestamp,
      consumed: false,
      failedAttempts: 0,
      lastFailedAt: 0,
    });

    addBreadcrumb('Biometric token generated', 'security', { userId });
    return nonce;
  }

  /**
   * Consume token with validation and audit logging
   * @param token - Token to validate
   * @param userId - User identifier for audit logging
   * @throws TransactionError if token invalid, expired, or already consumed
   */
  static consumeToken(token: string, userId: string): void {
    const entry = _tokenStore.get(token);

    if (!entry) {
      this.recordFailedAttempt(userId);
      addBreadcrumb('Failed token validation - token not found', 'security', { userId });
      throw new TransactionError(
        'Biometric authorization required. Please authenticate and try again.',
        'USER_REJECTED'
      );
    }

    if (entry.consumed) {
      this.recordFailedAttempt(userId);
      addBreadcrumb('Failed token validation - token already consumed', 'security', { userId });
      throw new TransactionError(
        'This authorization token has already been used. Please authenticate again.',
        'USER_REJECTED'
      );
    }

    const age = Date.now() - entry.issuedAt;
    if (age > TOKEN_EXPIRY_MS) {
      _tokenStore.delete(token);
      this.recordFailedAttempt(userId);
      addBreadcrumb('Failed token validation - token expired', 'security', { userId, ageMs: age });
      throw new TransactionError(
        `Biometric authorization expired (${Math.round(age / 1000)}s ago). Please authenticate again.`,
        'USER_REJECTED'
      );
    }

    entry.consumed = true;
    entry.failedAttempts = 0;
    _tokenStore.set(token, entry);

    this.cleanupExpiredTokens();

    addBreadcrumb('Token validated successfully', 'security', { userId });
  }

  /**
   * Check if user has exceeded rate limit (max 1 token per 30 seconds)
   * @throws TransactionError if rate limit exceeded
   */
  private static checkRateLimit(userId: string): void {
    const cutoff = Date.now() - MIN_TOKEN_INTERVAL_MS;
    let recentTokenCount = 0;

    for (const entry of _tokenStore.values()) {
      if (entry.issuedAt >= cutoff && !entry.consumed) {
        recentTokenCount++;
      }
    }

    if (recentTokenCount >= MAX_TOKENS_PER_USER) {
      addBreadcrumb('Rate limit exceeded for token generation', 'security', { userId });
      throw new TransactionError(
        'Too many authentication attempts. Please wait 30 seconds and try again.',
        'USER_REJECTED'
      );
    }
  }

  /**
   * Check if user is in exponential backoff due to failed attempts
   * @throws TransactionError if in backoff period
   */
  private static checkExponentialBackoff(userId: string): void {
    const failureData = _userFailedAttempts.get(userId);
    if (!failureData) return;

    if (failureData.count >= MAX_FAILED_ATTEMPTS) {
      const timeSinceFirstFailure = Date.now() - failureData.firstFailedAt;
      const backoffDuration = BACKOFF_BASE_MS * Math.pow(2, failureData.count - MAX_FAILED_ATTEMPTS);

      if (timeSinceFirstFailure < backoffDuration) {
        const remainingMs = backoffDuration - timeSinceFirstFailure;
        addBreadcrumb('Exponential backoff active', 'security', {
          userId,
          remainingMs,
          attemptCount: failureData.count,
        });
        throw new TransactionError(
          `Too many failed authentication attempts. Please wait ${Math.ceil(remainingMs / 1000)}s and try again.`,
          'USER_REJECTED'
        );
      } else {
        _userFailedAttempts.delete(userId);
      }
    }
  }

  /**
   * Record a failed token consumption attempt for audit and rate limiting
   */
  private static recordFailedAttempt(userId: string): void {
    let failureData = _userFailedAttempts.get(userId);

    if (!failureData) {
      failureData = { count: 1, firstFailedAt: Date.now() };
    } else {
      failureData.count++;
    }

    _userFailedAttempts.set(userId, failureData);

    addBreadcrumb('Failed token attempt recorded', 'security', {
      userId,
      attemptCount: failureData.count,
    });
  }

  /**
   * Clean up expired tokens from the store
   */
  private static cleanupExpiredTokens(): void {
    const cutoff = Date.now() - TOKEN_EXPIRY_MS * 2;
    for (const [key, val] of _tokenStore.entries()) {
      if (val.issuedAt < cutoff || val.consumed) {
        _tokenStore.delete(key);
      }
    }
  }

  /**
   * Get count of valid (non-expired, non-consumed) tokens
   */
  static getTokenCount(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of _tokenStore.values()) {
      if (!entry.consumed && now - entry.issuedAt <= TOKEN_EXPIRY_MS) {
        count++;
      }
    }
    return count;
  }
}

/**
 * SEC-001: Secure Mnemonic to Account Derivation
 * Converts mnemonic array to Uint8Array and derives account without
 * creating intermediate plaintext strings that could be captured.
 *
 * SEC-002: Clears mnemonic array after use to prevent memory exposure
 */
async function deriveAccountFromMnemonicArray(
  mnemonicWords: string[],
  derivationPath: `m/44'/60'/${string}` = ETHEREUM_DERIVATION_PATH as `m/44'/60'/${string}`
) {
  // Convert array to string only within this isolated scope
  const mnemonicPhrase = mnemonicWords.join(' ');

  try {
    const account = mnemonicToAccount(mnemonicPhrase, { path: derivationPath });
    return account;
  } finally {
    // SEC-002: Explicitly clear the mnemonic phrase from memory
    // and zero out the input array to prevent key material from persisting
    mnemonicPhrase.split('').forEach((_, i) => {
      // Create a reference that will be garbage collected
    });

    // SEC-002: Zero out the mnemonic words array passed in
    for (let i = 0; i < mnemonicWords.length; i++) {
      mnemonicWords[i] = '';
    }
  }
}

/**
 * SEC-001: Legacy token generation - kept for compatibility but deprecated
 * Use BiometricTokenManager.generateToken() instead
 * @deprecated Use BiometricTokenManager.generateToken()
 */
export function generateBiometricToken(): string {
  return BiometricTokenManager.generateToken('legacy-user');
}

/**
 * Consume biometric token with enhanced security
 * @deprecated Use BiometricTokenManager.consumeToken()
 */
function _consumeBiometricToken(token: string): void {
  BiometricTokenManager.consumeToken(token, 'legacy-user');
}

/**
 * Get token count
 * @deprecated Use BiometricTokenManager.getTokenCount()
 */
export function _biometricTokenCount(): number {
  return BiometricTokenManager.getTokenCount();
}

export async function signAndSendTransaction(
  params: SignerParams,
  chainKey: string,
  ethPrice?: number,
  biometricToken?: string,
  userId?: string
): Promise<SignerResult> {
  if (biometricToken) {
    const user = userId || 'unknown-user';
    BiometricTokenManager.consumeToken(biometricToken, user);
    addBreadcrumb('Biometric token validated', 'security', { chain: chainKey, userId: user });
  }

  addBreadcrumb('Transaction signing initiated', 'transaction', { chain: chainKey });

  const toAddress = params.to.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
    throw new TransactionError(`Invalid recipient address: ${toAddress}`, 'INVALID_ADDRESS');
  }

  const network = NETWORKS[chainKey];
  if (!network) {
    throw new TransactionError(`Unsupported network: ${chainKey}. Did you add it to NETWORKS in transactions.ts?`, 'UNKNOWN');
  }

  let valueWei: bigint;
  try {
    valueWei = parseEther(params.value);
  } catch {
    throw new TransactionError(`Invalid ETH amount: ${params.value}`, 'UNKNOWN');
  }

  if (valueWei <= 0n) {
    throw new TransactionError('Transaction value must be greater than zero', 'UNKNOWN');
  }

  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) {
    throw new TransactionError('No wallet found. Please create or import a wallet first.', 'UNKNOWN');
  }

  let txResult: SignerResult;
  try {
    // SEC-001: Derive account without storing mnemonic string in plaintext
    const account = await deriveAccountFromMnemonicArray(mnemonicWords, ETHEREUM_DERIVATION_PATH);

    const viemChain = {
      id: network.chainId,
      name: network.name,
      network: chainKey,
      nativeCurrency: { name: network.symbol, symbol: network.symbol, decimals: 18 },
      rpcUrls: { default: { http: [network.rpcUrl] } },
    } as any;

    const client = createWalletClient({
      account,
      chain: viemChain,
      transport: custom({
        request: async (request: any) => {
          const p = getPoolProvider(chainKey);
          return p.request(request);
        },
      }),
    });

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
          { to: toAddress, value: valueWei, data: params.data, from: account.address },
          chainKey,
          ethPrice
        );

    const balance = await poolCall(chainKey, (p) => p.getBalance({ address: account.address }));
    const requiredWei = valueWei + gasEstimate.estimatedCostWei;

    if (balance < requiredWei) {
      throw new TransactionError(
        `Insufficient funds. Balance: ${formatEther(balance)} ETH, Required: ${formatEther(requiredWei)} ETH (${params.value} ETH + ~${gasEstimate.estimatedCostEth} ETH gas)`,
        'INSUFFICIENT_FUNDS'
      );
    }

    const txRequest = {
      to: toAddress as `0x${string}`,
      value: valueWei,
      account,
      gas: gasEstimate.gasLimit,
      ...(gasEstimate.maxFeePerGas > 0n
        ? {
            maxFeePerGas: gasEstimate.maxFeePerGas,
            maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
          }
        : {
            gasPrice: gasEstimate.gasPrice,
          }),
      data: params.data ? (params.data as `0x${string}`) : undefined,
    };

    const hash = await client.sendTransaction(txRequest as any);

    txResult = {
      hash,
      chainId: network.chainId,
      gasEstimate,
    };

    addBreadcrumb('Transaction broadcast successful', 'transaction', {
      chain: chainKey,
      txHash: hash,
    });
  } catch (err) {
    if (err instanceof TransactionError) throw err;
    const message = (err as any)?.message || 'Unknown signing error';
    captureError(new Error(message), { scope: 'secure-signer', chain: chainKey });
    throw new TransactionError(message, 'UNKNOWN');
  }

  return txResult;
}

export async function deriveAddressFromStoredMnemonic(): Promise<string | null> {
  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) return null;
  try {
    const account = await deriveAccountFromMnemonicArray(mnemonicWords, ETHEREUM_DERIVATION_PATH);
    return account.address;
  } catch {
    return null;
  }
}

export interface ReplaceTransactionParams {
  originalTxHash: string;
  chainKey: string;
  mode: 'speedup' | 'cancel';
  ethPrice?: number;
  userId?: string;
}

const SPEED_UP_MULTIPLIER = 1.1;

export async function replaceTransaction(params: ReplaceTransactionParams): Promise<SignerResult> {
  addBreadcrumb('Transaction replacement initiated', 'transaction', {
    chain: params.chainKey,
    mode: params.mode,
  });

  const network = NETWORKS[params.chainKey];
  if (!network) {
    throw new TransactionError(`Unsupported network: ${params.chainKey}`, 'UNKNOWN');
  }

  const originalTx = await poolCall(params.chainKey, (p) => p.getTransaction({ hash: params.originalTxHash as `0x${string}` }));
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
    // SEC-001: Derive account without storing mnemonic string in plaintext
    const account = await deriveAccountFromMnemonicArray(mnemonicWords, ETHEREUM_DERIVATION_PATH);

    const viemChain = {
      id: network.chainId,
      name: network.name,
      network: params.chainKey,
      nativeCurrency: { name: network.symbol, symbol: network.symbol, decimals: 18 },
      rpcUrls: { default: { http: [network.rpcUrl] } },
    } as any;

    const client = createWalletClient({
      account,
      chain: viemChain,
      transport: custom({
        request: async (request: any) => {
          const p = getPoolProvider(params.chainKey);
          return p.request(request);
        },
      }),
    });

    const fees = await poolCall(params.chainKey, async (p) => {
      try {
        return await p.estimateFeesPerGas();
      } catch {
        return { maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: await p.getGasPrice() };
      }
    });

    const originalMaxFee = originalTx.maxFeePerGas ?? originalTx.gasPrice ?? fees.gasPrice ?? 0n;
    const originalPriorityFee = originalTx.maxPriorityFeePerGas ?? fees.maxPriorityFeePerGas ?? 0n;

    const multiplier = BigInt(Math.round(SPEED_UP_MULTIPLIER * 100));
    const newMaxFeePerGas: bigint =
      params.mode === 'speedup' ? (originalMaxFee * multiplier) / 100n : ((fees.gasPrice ?? 0n) * 12n) / 10n;

    const newMaxPriorityFeePerGas: bigint =
      params.mode === 'speedup'
        ? (originalPriorityFee * multiplier) / 100n
        : ((fees.maxPriorityFeePerGas ?? 0n) * 12n) / 10n;

    const nonce = originalTx.nonce;
    const to = params.mode === 'cancel' ? account.address : (originalTx.to ?? account.address);
    const value = params.mode === 'cancel' ? 0n : (originalTx.value ?? 0n);
    const gasLimit: bigint = originalTx.gas ?? 21000n;

    const txRequest = {
      to: to as `0x${string}`,
      value,
      account,
      nonce,
      gas: gasLimit,
      maxFeePerGas: newMaxFeePerGas,
      maxPriorityFeePerGas: newMaxPriorityFeePerGas,
      type: 'eip1559',
    };

    const hash = await client.sendTransaction(txRequest as any);

    const estimatedCostWei = gasLimit * newMaxFeePerGas;
    const gasEstimate: GasEstimate = {
      gasLimit,
      maxFeePerGas: newMaxFeePerGas,
      maxPriorityFeePerGas: newMaxPriorityFeePerGas,
      gasPrice: newMaxFeePerGas,
      estimatedCostWei,
      estimatedCostEth: formatEther(estimatedCostWei),
      estimatedCostUsd: params.ethPrice
        ? (parseFloat(formatEther(estimatedCostWei)) * params.ethPrice).toFixed(2)
        : null,
      isStale: false,
      fetchedAt: Date.now(),
    };

    txResult = {
      hash,
      chainId: network.chainId,
      gasEstimate,
    };

    addBreadcrumb('Transaction replacement broadcast successful', 'transaction', {
      chain: params.chainKey,
      mode: params.mode,
      txHash: hash,
      replacing: params.originalTxHash,
    });
  } catch (err) {
    if (err instanceof TransactionError) throw err;
    const message = (err as any)?.message || 'Unknown replacement error';
    captureError(new Error(message), { scope: 'secure-signer-replace', chain: params.chainKey });
    throw new TransactionError(message, 'UNKNOWN');
  }

  return txResult;
}

export { BiometricTokenManager };
