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

interface BiometricTokenEntry {
  token: string;
  issuedAt: number;
  consumed: boolean;
}

const _tokenStore = new Map<string, BiometricTokenEntry>();

export function generateBiometricToken(): string {
  const nonce = `${Date.now()}-${Crypto.randomUUID()}-${Crypto.randomUUID()}`;
  _tokenStore.set(nonce, { token: nonce, issuedAt: Date.now(), consumed: false });
  return nonce;
}

function _consumeBiometricToken(token: string): void {
  const entry = _tokenStore.get(token);
  if (!entry) throw new TransactionError('Biometric authorization required. Please authenticate and try again.', 'USER_REJECTED');
  if (entry.consumed) throw new TransactionError('This authorization token has already been used. Please authenticate again.', 'USER_REJECTED');
  const age = Date.now() - entry.issuedAt;
  if (age > TOKEN_EXPIRY_MS) {
    _tokenStore.delete(token);
    throw new TransactionError(`Biometric authorization expired (${Math.round(age / 1000)}s ago). Please authenticate again.`, 'USER_REJECTED');
  }
  entry.consumed = true;
  _tokenStore.set(token, entry);
  const cutoff = Date.now() - TOKEN_EXPIRY_MS * 2;
  for (const [key, val] of _tokenStore.entries()) {
    if (val.issuedAt < cutoff || val.consumed) _tokenStore.delete(key);
  }
}

export function _biometricTokenCount(): number {
  const now = Date.now();
  let count = 0;
  for (const entry of _tokenStore.values()) {
    if (!entry.consumed && now - entry.issuedAt <= TOKEN_EXPIRY_MS) count++;
  }
  return count;
}

export async function signAndSendTransaction(
  params: SignerParams,
  chainKey: string,
  ethPrice?: number,
  biometricToken?: string
): Promise<SignerResult> {
  if (biometricToken) {
    _consumeBiometricToken(biometricToken);
    addBreadcrumb('Biometric token validated', 'security', { chain: chainKey });
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
    const mnemonicPhrase = mnemonicWords.join(' ');
    const account = mnemonicToAccount(mnemonicPhrase, { path: ETHEREUM_DERIVATION_PATH });
    
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
        }
      })
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
    const mnemonicPhrase = mnemonicWords.join(' ');
    const account = mnemonicToAccount(mnemonicPhrase, { path: ETHEREUM_DERIVATION_PATH });
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
}

const SPEED_UP_MULTIPLIER = 1.1;

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
    const mnemonicPhrase = mnemonicWords.join(' ');
    const account = mnemonicToAccount(mnemonicPhrase, { path: ETHEREUM_DERIVATION_PATH });

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
        }
      })
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
    const newMaxFeePerGas: bigint = params.mode === 'speedup'
      ? (originalMaxFee * multiplier) / 100n
      : ((fees.gasPrice ?? 0n) * 12n) / 10n;

    const newMaxPriorityFeePerGas: bigint = params.mode === 'speedup'
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
