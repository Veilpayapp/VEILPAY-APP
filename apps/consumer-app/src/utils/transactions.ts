/**
 * Ethereum Transaction Utility
 *
 * Provides real blockchain transaction functionality using ethers.js
 * - Creates and signs transactions with user's private key
 * - Broadcasts to Ethereum testnet (Sepolia)
 * - Returns actual transaction hashes from the network
 *
 * @see https://docs.ethers.org/v6/
 */

import { JsonRpcProvider, Wallet, TransactionResponse, FeeData, ethers, TransactionRequest } from 'ethers';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { captureError } from './sentry';
import { getRpcUrl } from './rpc';
import { getPoolProvider, poolCall } from './rpcPool';

type SecureStoreModule = typeof import('expo-secure-store');

let cachedSecureStoreModule: SecureStoreModule | null | undefined;
let warnedSecureStoreUnavailable = false;

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

// Storage key for mnemonic
export const MNEMONIC_STORAGE_KEY = 'veilpay-wallet-mnemonic';

const normalizeStorageError = (error: unknown, operation: string): Error => {
  const normalized = error instanceof Error ? error : new Error('Unknown mnemonic storage error');
  captureError(normalized, {
    scope: 'mnemonic-storage',
    operation,
  });
  return normalized;
};

/**
 * Check if SecureStore is available (iOS/Android)
 * In Expo Go, SecureStore is not available - we fall back to AsyncStorage for development
 */
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

// Note: AsyncStorage fallback removed for security.
// SecureStore must be available for mnemonic operations.
// In Expo Go, SecureStore is unavailable - use a development build instead.
const warnSecureStoreUnavailable = () => {
  if (!warnedSecureStoreUnavailable) {
    warnedSecureStoreUnavailable = true;
    console.warn(
      '[transactions] SecureStore unavailable. ' +
      'Mnemonic operations require a development build with expo-secure-store. ' +
      'Expo Go does not support secure storage.'
    );
  }
};

// Network configuration
export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  symbol: string;
  isTestnet: boolean;
}

// Supported networks
// Note: Goerli testnet was deprecated in early 2024. Use Sepolia instead.
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
    chainId: -101, // Solana doesn't use EVM chain IDs; sentinel value
    rpcUrl: getRpcUrl('solana-devnet'),
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
    symbol: 'SOL',
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
};

// Transaction result types
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
  value: string; // in ETH
  data?: string;
  gasLimit?: string;
  gasPrice?: string;
}

export interface GasEstimate {
  gasLimit: string;
  gasPrice: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  estimatedCost: string; // in ETH
}

/**
 * Error types for transaction operations
 */
export class TransactionError extends Error {
  constructor(
    message: string,
    public code: 'INSUFFICIENT_FUNDS' | 'INVALID_ADDRESS' | 'NETWORK_ERROR' | 'USER_REJECTED' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

/**
 * Stores the mnemonic phrase securely using hardware-backed encryption
 * Uses expo-secure-store on iOS/Android (Keychain/Keystore)
 *
 * SECURITY: If SecureStore is unavailable, the mnemonic is NOT stored.
 * Never fall back to AsyncStorage for mnemonic storage - plaintext storage
 * of seed phrases is a critical security vulnerability.
 *
 * @param mnemonic - Array of mnemonic words
 * @throws TransactionError if storage fails or SecureStore unavailable
 */
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
      // CRITICAL: Never fall back to AsyncStorage for mnemonic storage.
      // If SecureStore is unavailable, the mnemonic must NOT be stored.
      throw new TransactionError(
        'Secure storage is not available on this device. Cannot safely store mnemonic. ' +
        'Please use a development build with expo-secure-store support.',
        'UNKNOWN'
      );
    }

    await secureStore.setItemAsync(MNEMONIC_STORAGE_KEY, mnemonicPhrase, getSecureStoreOptions(secureStore));
  } catch (error: unknown) {
    if (error instanceof TransactionError) {
      throw error;
    }
    normalizeStorageError(error, 'store');
    throw new TransactionError(
      'Failed to store mnemonic securely',
      'UNKNOWN'
    );
  }
}

/**
 * Retrieves the stored mnemonic phrase from secure storage
 *
 * SECURITY: If SecureStore is unavailable, returns null.
 * Never fall back to AsyncStorage - any data stored there is potentially compromised.
 *
 * @returns Array of mnemonic words or null if not stored or SecureStore unavailable
 */
export async function getStoredMnemonic(): Promise<string[] | null> {
  try {
    const secureStore = getSecureStoreModule();

    if (!isSecureStoreAvailable(secureStore)) {
      // CRITICAL: Do NOT fall back to AsyncStorage for mnemonic retrieval.
      // If SecureStore is unavailable, any stored mnemonic is potentially compromised.
      console.warn(
        '[transactions] SecureStore unavailable. Cannot retrieve mnemonic safely. ' +
        'Please use a development build with expo-secure-store support.'
      );
      return null;
    }

    const mnemonicPhrase = await secureStore.getItemAsync(MNEMONIC_STORAGE_KEY, getSecureStoreOptions(secureStore));

    if (!mnemonicPhrase) {
      return null;
    }

    const words = mnemonicPhrase
      .split(' ')
      .map((word) => word.trim())
      .filter(Boolean);

    if (words.length !== 12 && words.length !== 24) {
      return null;
    }

    return words;
  } catch (error: unknown) {
    if (error instanceof TransactionError) {
      throw error;
    }
    normalizeStorageError(error, 'read');
    return null;
  }
}

/**
 * Checks whether a wallet mnemonic is present in secure storage.
 *
 * SECURITY: If SecureStore is unavailable, returns false.
 * Never fall back to AsyncStorage for security checks.
 */
export async function isWalletInitialized(): Promise<boolean> {
  try {
    const secureStore = getSecureStoreModule();

    if (!isSecureStoreAvailable(secureStore)) {
      // CRITICAL: Do NOT fall back to AsyncStorage.
      // If SecureStore is unavailable, treat as not initialized.
      return false;
    }

    const mnemonicPhrase = await secureStore.getItemAsync(MNEMONIC_STORAGE_KEY, getSecureStoreOptions(secureStore));
    return Boolean(mnemonicPhrase && mnemonicPhrase.trim().length > 0);
  } catch (error: unknown) {
    if (error instanceof TransactionError) {
      throw error;
    }
    normalizeStorageError(error, 'check-initialized');
    return false;
  }
}

/**
 * Clears the stored mnemonic from secure storage
 *
 * SECURITY: If SecureStore is unavailable, throws an error.
 * Never fall back to AsyncStorage - if SecureStore is unavailable,
 * we cannot securely clear the mnemonic anyway.
 */
export async function clearStoredMnemonic(): Promise<void> {
  try {
    const secureStore = getSecureStoreModule();

    if (!isSecureStoreAvailable(secureStore)) {
      throw new TransactionError(
        'Secure storage is not available. Cannot securely clear mnemonic.',
        'UNKNOWN'
      );
    }

    await secureStore.deleteItemAsync(MNEMONIC_STORAGE_KEY, getSecureStoreOptions(secureStore));
  } catch (error: unknown) {
    if (error instanceof TransactionError) {
      throw error;
    }
    normalizeStorageError(error, 'clear');
    throw new TransactionError(
      'Failed to clear mnemonic securely',
      'UNKNOWN'
    );
  }
}

/**
 * Derives a wallet from the stored mnemonic
 * @param mnemonic - Array of mnemonic words
 * @param derivationPath - BIP-44 derivation path (default: Ethereum first account)
 * @returns HDNodeWallet instance
 */
export function deriveWalletFromMnemonic(
  mnemonic: string[],
  derivationPath: string = "m/44'/60'/0'/0/0"
): HDNodeWallet {
  const mnemonicPhrase = mnemonic.join(' ');
  const mnemonicObj = Mnemonic.fromPhrase(mnemonicPhrase);
  return HDNodeWallet.fromMnemonic(mnemonicObj, derivationPath);
}

/**
 * Creates a JSON-RPC provider for the specified network using the RPC pool.
 * @param networkKey - Network identifier (e.g., 'sepolia', 'ethereum')
 * @returns JsonRpcProvider instance from the pool
 */
export function createProvider(networkKey: string = 'sepolia'): JsonRpcProvider {
  const network = NETWORKS[networkKey];
  if (!network) {
    throw new TransactionError(
      `Unsupported network: ${networkKey}`,
      'UNKNOWN'
    );
  }
  
  return getPoolProvider(networkKey);
}

/**
 * Gets the current balance of an address
 * @param address - Ethereum address
 * @param networkKey - Network to query
 * @returns Balance in ETH as a string
 */
export async function getBalance(
  address: string,
  networkKey: string = 'sepolia'
): Promise<string> {
  const balance = await poolCall(networkKey, (p) => p.getBalance(address));
  return ethers.formatEther(balance);
}

/**
 * Estimates gas for a transaction
 * @param params - Transaction parameters
 * @param networkKey - Network to use
 * @returns GasEstimate object
 */
export async function estimateGas(
  params: TransactionParams,
  networkKey: string = 'sepolia'
): Promise<GasEstimate> {
  const provider = createProvider(networkKey);
  
  // Get fee data
  const feeData: FeeData = await provider.getFeeData();
  
  // Estimate gas limit
  const gasLimit = params.gasLimit || '21000'; // Default for simple ETH transfer
  
  // Calculate gas price (use legacy gasPrice for testnets)
  const gasPrice = params.gasPrice || feeData.gasPrice?.toString() || '1000000000'; // 1 Gwei default
  
  // Calculate estimated cost
  const estimatedCost = (BigInt(gasLimit) * BigInt(gasPrice)).toString();
  
  return {
    gasLimit,
    gasPrice: gasPrice.toString(),
    maxFeePerGas: feeData.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
    estimatedCost: ethers.formatEther(estimatedCost),
  };
}

/**
 * Validates an Ethereum address
 * @param address - Address to validate
 * @returns true if valid, false otherwise
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Sends a real Ethereum transaction
 * 
 * @param mnemonic - User's mnemonic phrase (12 or 24 words)
 * @param params - Transaction parameters
 * @param networkKey - Network to use (default: 'sepolia' for testnet)
 * @param onConfirmation - Optional callback for confirmation updates
 * @returns TransactionResult with hash and status
 */
export async function sendTransaction(
  mnemonic: string[],
  params: TransactionParams,
  networkKey: string = 'sepolia',
  onConfirmation?: (confirmations: number) => void
): Promise<TransactionResult> {
  // Validate recipient address
  if (!isValidAddress(params.to)) {
    throw new TransactionError(
      `Invalid recipient address: ${params.to}`,
      'INVALID_ADDRESS'
    );
  }

  // Get network config
  const network = NETWORKS[networkKey];
  if (!network) {
    throw new TransactionError(
      `Unsupported network: ${networkKey}`,
      'UNKNOWN'
    );
  }

  // Create provider and wallet
  const provider = createProvider(networkKey);
  const wallet = deriveWalletFromMnemonic(mnemonic);
  const connectedWallet = wallet.connect(provider);

  // Get gas estimate first (needed for balance check)
  const gasEstimate = await estimateGas(params, networkKey);

  // Check balance (including estimated gas cost)
  const balance = await provider.getBalance(wallet.address);
  const valueWei = ethers.parseEther(params.value);
  
  // Calculate estimated gas cost
  const gasLimit = BigInt(gasEstimate.gasLimit);
  const gasPrice = BigInt(gasEstimate.gasPrice);
  const estimatedGasCost = gasLimit * gasPrice;
  
  // Check if user has enough for value + gas
  if (balance < valueWei + estimatedGasCost) {
    throw new TransactionError(
      `Insufficient funds. Balance: ${ethers.formatEther(balance)} ETH, Required: ${ethers.formatEther(valueWei + estimatedGasCost)} ETH (${params.value} ETH + ~${ethers.formatEther(estimatedGasCost)} ETH for gas)`,
      'INSUFFICIENT_FUNDS'
    );
  }
  
  // Build transaction object
  const txRequest: TransactionRequest = {
    to: params.to,
    value: valueWei,
    gasLimit: gasEstimate.gasLimit,
    gasPrice: gasEstimate.gasPrice,
    chainId: network.chainId,
  };

  // Add data if provided
  if (params.data) {
    txRequest.data = params.data;
  }

  try {
    // Send transaction
    const txResponse: TransactionResponse = await connectedWallet.sendTransaction(txRequest);
    
    // Return pending result immediately
    const pendingResult: TransactionResult = {
      hash: txResponse.hash,
      status: 'pending',
    };

    if (onConfirmation) {
      // Keep callback support for callers that only need "submitted" signal.
      onConfirmation(0);
    }

    return pendingResult;
  } catch (error: any) {
    // Handle specific error types
    if (error.code === 'INSUFFICIENT_FUNDS') {
      throw new TransactionError(
        'Insufficient funds for gas or value',
        'INSUFFICIENT_FUNDS'
      );
    }
    
    if (error.code === 'NETWORK_ERROR') {
      throw new TransactionError(
        'Network error. Please check your connection.',
        'NETWORK_ERROR'
      );
    }
    
    if (error.code === 'ACTION_REJECTED') {
      throw new TransactionError(
        'Transaction rejected by user',
        'USER_REJECTED'
      );
    }

    // Generic error
    throw new TransactionError(
      error.message || 'Unknown transaction error',
      'UNKNOWN'
    );
  }
}

/**
 * Waits for a transaction to be confirmed
 * 
 * @param txHash - Transaction hash to wait for
 * @param networkKey - Network to query
 * @param confirmations - Number of confirmations to wait for (default: 1)
 * @returns TransactionResult with confirmation details
 */
export async function waitForTransaction(
  txHash: string,
  networkKey: string = 'sepolia',
  confirmations: number = 1
): Promise<TransactionResult> {
  try {
    const receipt = await poolCall(networkKey, (p) => p.waitForTransaction(txHash, confirmations));
    
    if (!receipt) {
      return { hash: txHash, status: 'failed', error: 'Transaction not found' };
    }

    return {
      hash: txHash,
      status: receipt.status === 1 ? 'confirmed' : 'failed',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error: any) {
    return {
      hash: txHash,
      status: 'failed',
      error: error.message || 'Unknown error waiting for transaction',
    };
  }
}

/**
 * Gets transaction details by hash
 * 
 * @param txHash - Transaction hash
 * @param networkKey - Network to query
 * @returns Transaction details or null if not found
 */
export async function getTransaction(
  txHash: string,
  networkKey: string = 'sepolia'
): Promise<any> {
  try {
    return await poolCall(networkKey, (p) => p.getTransaction(txHash));
  } catch {
    return null;
  }
}

/**
 * Gets the explorer URL for a transaction
 * 
 * @param txHash - Transaction hash
 * @param networkKey - Network identifier
 * @returns Full URL to view transaction on block explorer
 */
export function getExplorerUrl(txHash: string, networkKey: string = 'sepolia'): string {
  const network = NETWORKS[networkKey];
  if (!network) return '';
  return `${network.explorerUrl}/tx/${txHash}`;
}

/**
 * Gets faucet URLs for testnets
 * @param networkKey - Network identifier
 * @returns Faucet URL or empty string
 */
export function getFaucetUrl(networkKey: string): string {
  const faucets: Record<string, string> = {
    sepolia: 'https://sepoliafaucet.com/',
  };
  return faucets[networkKey] || '';
}

// Re-export ethers utilities for convenience
export { ethers };
