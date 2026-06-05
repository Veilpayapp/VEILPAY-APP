import { parseEther, formatEther } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { captureError } from './sentry';
import { getRpcUrl } from './rpc';
import { getPoolProvider, poolCall } from './rpcPool';

type SecureStoreModule = typeof import('expo-secure-store');

let cachedSecureStoreModule: SecureStoreModule | null | undefined;
const warnedSecureStoreUnavailable = false;

function getSecureStoreModule(): SecureStoreModule | null {
  if (cachedSecureStoreModule !== undefined) {
    return cachedSecureStoreModule;
  }
  try {
    cachedSecureStoreModule = require('expo-secure-store') as SecureStoreModule;
  } catch {
    cachedSecureStoreModule = null;
  }
  return cachedSecureStoreModule;
}

function getSecureStoreOptions(
  secureStore: SecureStoreModule
): Parameters<SecureStoreModule['setItemAsync']>[2] {
  return {
    keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

export const MNEMONIC_STORAGE_KEY = 'veilpay-wallet-mnemonic';

const normalizeStorageError = (error: unknown, operation: string): Error => {
  const normalized = error instanceof Error ? error : new Error('Unknown mnemonic storage error');
  captureError(normalized, { scope: 'mnemonic-storage', operation });
  return normalized;
};

const isSecureStoreAvailable = (
  secureStore: SecureStoreModule | null
): secureStore is SecureStoreModule => {
  try {
    return Boolean(
      secureStore
      && typeof secureStore.setItemAsync === 'function'
      && typeof secureStore.getItemAsync === 'function'
      && typeof secureStore.deleteItemAsync === 'function'
    );
  } catch {
    return false;
  }
};

export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  symbol: string;
  isTestnet: boolean;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  sepolia: {
    name: 'Sepolia Testnet',
    chainId: 11155111,
    rpcUrl: getRpcUrl('sepolia'),
    explorerUrl: 'https://sepolia.etherscan.io',
    symbol: 'ETH',
    isTestnet: true,
  },
  'solana-devnet': {
    name: 'Solana Devnet',
    chainId: -101,
    rpcUrl: getRpcUrl('solana-devnet'),
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
    symbol: 'SOL',
    isTestnet: true,
  },
  stellar: {
    name: 'Stellar',
    chainId: -200,
    rpcUrl: 'https://horizon.stellar.org',
    explorerUrl: 'https://stellarchain.io',
    symbol: 'XLM',
    isTestnet: false,
  },
  'stellar-testnet': {
    name: 'Stellar Testnet',
    chainId: -201,
    rpcUrl: 'https://horizon-testnet.stellar.org',
    explorerUrl: 'https://testnet.stellarchain.io',
    symbol: 'XLM',
    isTestnet: true,
  },
  ethereum: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: getRpcUrl('ethereum'),
    explorerUrl: 'https://etherscan.io',
    symbol: 'ETH',
    isTestnet: false,
  },
  polygon: {
    name: 'Polygon Mainnet',
    chainId: 137,
    rpcUrl: getRpcUrl('polygon'),
    explorerUrl: 'https://polygonscan.com',
    symbol: 'MATIC',
    isTestnet: false,
  },
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrl: getRpcUrl('arbitrum'),
    explorerUrl: 'https://arbiscan.io',
    symbol: 'ETH',
    isTestnet: false,
  },
  bsc: {
    name: 'BSC',
    chainId: 56,
    rpcUrl: getRpcUrl('bsc'),
    explorerUrl: 'https://bscscan.com',
    symbol: 'BNB',
    isTestnet: false,
  },
  base: {
    name: 'Base',
    chainId: 8453,
    rpcUrl: getRpcUrl('base'),
    explorerUrl: 'https://basescan.org',
    symbol: 'ETH',
    isTestnet: false,
  },
  solana: {
    name: 'Solana',
    chainId: 101, // Arbitrary for non-EVM
    rpcUrl: getRpcUrl('solana'),
    explorerUrl: 'https://explorer.solana.com',
    symbol: 'SOL',
    isTestnet: false,
  },
  aptos: {
    name: 'Aptos',
    chainId: 1, // Arbitrary for non-EVM
    rpcUrl: getRpcUrl('aptos'),
    explorerUrl: 'https://explorer.aptoslabs.com',
    symbol: 'APT',
    isTestnet: false,
  },
};


export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface TransactionResult {
  hash: string;
  status: TransactionStatus;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
}

export interface TransactionParams {
  to: string;
  value: string;
  data?: string;
  gasLimit?: string;
  gasPrice?: string;
}

export class TransactionError extends Error {
  constructor(
    message: string,
    public code: 'INSUFFICIENT_FUNDS' | 'INVALID_ADDRESS' | 'NETWORK_ERROR' | 'USER_REJECTED' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, operationName: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TransactionError(`SecureStore operation '${operationName}' timed out after ${ms}ms`, 'UNKNOWN'));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

export async function storeMnemonic(mnemonic: string[]): Promise<void> {
  try {
    if (!Array.isArray(mnemonic) || (mnemonic.length !== 12 && mnemonic.length !== 24)) {
      throw new Error('Mnemonic must contain 12 or 24 words');
    }
    const mnemonicPhrase = mnemonic.join(' ');
    if (!mnemonicPhrase.trim()) {
      throw new Error('Mnemonic cannot be empty');
    }
    const secureStore = getSecureStoreModule();
    if (!isSecureStoreAvailable(secureStore)) {
      throw new TransactionError(
        'Secure storage is not available on this device. Cannot safely store mnemonic. Please use a development build with expo-secure-store support.',
        'UNKNOWN'
      );
    }
    await withTimeout(
      secureStore.setItemAsync(MNEMONIC_STORAGE_KEY, mnemonicPhrase, getSecureStoreOptions(secureStore)),
      3000,
      'storeMnemonic'
    );
  } catch (error: unknown) {
    if (error instanceof TransactionError) throw error;
    normalizeStorageError(error, 'store');
    throw new TransactionError('Failed to store mnemonic securely', 'UNKNOWN');
  }
}

export async function getStoredMnemonic(): Promise<string[] | null> {
  try {
    const secureStore = getSecureStoreModule();
    if (!isSecureStoreAvailable(secureStore)) {
      console.warn('[transactions] SecureStore unavailable. Cannot retrieve mnemonic safely.');
      return null;
    }
    const mnemonicPhrase = await withTimeout(
      secureStore.getItemAsync(MNEMONIC_STORAGE_KEY, getSecureStoreOptions(secureStore)),
      3000,
      'getStoredMnemonic'
    );
    if (!mnemonicPhrase) return null;
    const words = mnemonicPhrase.split(' ').map((word) => word.trim()).filter(Boolean);
    if (words.length !== 12 && words.length !== 24) return null;
    return words;
  } catch (error: unknown) {
    if (error instanceof TransactionError) throw error;
    normalizeStorageError(error, 'read');
    return null;
  }
}

export async function isWalletInitialized(): Promise<boolean> {
  try {
    const secureStore = getSecureStoreModule();
    if (!isSecureStoreAvailable(secureStore)) return false;
    const mnemonicPhrase = await withTimeout(
      secureStore.getItemAsync(MNEMONIC_STORAGE_KEY, getSecureStoreOptions(secureStore)),
      3000,
      'isWalletInitialized'
    );
    return Boolean(mnemonicPhrase && mnemonicPhrase.trim().length > 0);
  } catch (error: unknown) {
    if (error instanceof TransactionError) throw error;
    normalizeStorageError(error, 'check-initialized');
    return false;
  }
}

export async function clearStoredMnemonic(): Promise<void> {
  try {
    const secureStore = getSecureStoreModule();
    if (!isSecureStoreAvailable(secureStore)) {
      throw new TransactionError('Secure storage is not available. Cannot securely clear mnemonic.', 'UNKNOWN');
    }
    await withTimeout(
      secureStore.deleteItemAsync(MNEMONIC_STORAGE_KEY, getSecureStoreOptions(secureStore)),
      3000,
      'clearStoredMnemonic'
    );
  } catch (error: unknown) {
    if (error instanceof TransactionError) throw error;
    normalizeStorageError(error, 'clear');
    throw new TransactionError('Failed to clear mnemonic securely', 'UNKNOWN');
  }
}

export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function waitForTransaction(
  txHash: string,
  networkKey: string = 'sepolia',
  confirmations: number = 1
): Promise<TransactionResult> {
  try {
    if (networkKey === 'stellar' || networkKey === 'stellar-testnet') {
      const horizonUrl = networkKey === 'stellar' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
      const res = await fetch(`${horizonUrl}/transactions/${txHash}`);
      if (res.status === 404) {
        throw new Error('Transaction not found');
      }
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const data = await res.json();
      if (data.successful) {
        return {
          hash: txHash,
          status: 'confirmed',
          blockNumber: data.ledger,
          gasUsed: data.fee_charged,
        };
      } else {
        return { hash: txHash, status: 'failed', error: 'Stellar transaction failed' };
      }
    }

    if (networkKey === 'solana' || networkKey === 'solana-devnet') {
      const solRpc = networkKey === 'solana' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com';
      const res = await fetch(solRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignatureStatuses',
          params: [[txHash], { searchTransactionHistory: true }]
        })
      });
      const data = await res.json();
      const status = data?.result?.value?.[0];
      if (!status) throw new Error('Transaction not found');
      if (status.err) return { hash: txHash, status: 'failed', error: JSON.stringify(status.err) };
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return { hash: txHash, status: 'confirmed', blockNumber: status.slot };
      }
      throw new Error('Still pending');
    }

    if (networkKey === 'aptos') {
      const aptosRpc = 'https://fullnode.mainnet.aptoslabs.com/v1';
      const res = await fetch(`${aptosRpc}/transactions/by_hash/${txHash}`);
      if (res.status === 404) {
        throw new Error('Transaction not found');
      }
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const data = await res.json();
      if (data.type === 'pending_transaction') {
        throw new Error('Still pending');
      }
      if (data.success) {
        return {
          hash: txHash,
          status: 'confirmed',
          blockNumber: Number(data.version),
          gasUsed: data.gas_used,
        };
      } else {
        return { hash: txHash, status: 'failed', error: data.vm_status || 'Aptos transaction failed' };
      }
    }

    const receipt = await poolCall(networkKey, (p) => p.waitForTransactionReceipt({ hash: txHash as `0x${string}`, confirmations }));
    
    if (!receipt) {
      return { hash: txHash, status: 'failed', error: 'Transaction not found' };
    }

    return {
      hash: txHash,
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error: any) {
    if (
      error.message === 'Transaction not found' ||
      error.message === 'Still pending' ||
      error.name === 'TransactionReceiptNotFoundError' ||
      error.name === 'TimeoutError'
    ) {
      throw error;
    }
    return {
      hash: txHash,
      status: 'failed',
      error: error.message || 'Unknown error waiting for transaction',
    };
  }
}

export async function getTransaction(
  txHash: string,
  networkKey: string = 'sepolia'
): Promise<any> {
  try {
    return await poolCall(networkKey, (p) => p.getTransaction({ hash: txHash as `0x${string}` }));
  } catch {
    return null;
  }
}

export function getExplorerUrl(txHash: string, networkKey: string = 'sepolia'): string {
  const network = NETWORKS[networkKey];
  if (!network) return '';
  return `${network.explorerUrl}/tx/${txHash}`;
}

export function getFaucetUrl(networkKey: string): string {
  const faucets: Record<string, string> = {
    sepolia: 'https://sepoliafaucet.com/',
  };
  return faucets[networkKey] || '';
}
