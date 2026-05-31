import { getRpcUrl } from './rpc';

// Supported chain types
export type ChainType = 'evm' | 'svm' | 'mvm' | 'xlm';

/**
 * Validates wallet address format based on chain type
 * @param address - The wallet address to validate
 * @param chainType - The blockchain type
 * @returns true if address format is valid
 */
export const validateAddress = (address: string, chainType: ChainType): boolean => {
  if (!address || typeof address !== 'string') {
    return false;
  }

  switch (chainType) {
    case 'evm':
      // EVM addresses: 0x prefix + 40 hex characters
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    
    case 'svm':
      // Solana addresses: Base58 encoded, 32-44 characters
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    
    case 'mvm':
      // Aptos addresses: 0x prefix + 64 hex characters (with or without leading zeros)
      return /^0x[a-fA-F0-9]{1,64}$/.test(address) && address.length <= 66;
    
    case 'xlm':
      // Stellar addresses: 56 characters starting with G
      return /^G[A-Z2-7]{55}$/.test(address);
    
    default:
      return false;
  }
};

/**
 * Validates and normalizes address format
 * @param address - The wallet address to validate
 * @param chainType - The blockchain type
 * @returns normalized address or null if invalid
 */
export const normalizeAddress = (address: string, chainType: ChainType): string | null => {
  if (!validateAddress(address, chainType)) {
    return null;
  }

  // Normalize to lowercase for EVM and Aptos
  if (chainType === 'evm' || chainType === 'mvm') {
    return address.toLowerCase();
  }

  // Solana and Stellar addresses are case-sensitive (Stellar is technically uppercase base32)
  return address;
};

// Supported chains configuration
export interface ChainConfig {
  id: number | string;
  key: string;
  name: string;
  type: ChainType;
  symbol: string;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet?: boolean;
  nativeToken: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

// Supported chains with configurable RPC endpoints
export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    type: 'evm',
    symbol: 'ETH',
    get rpcUrl() { return getRpcUrl('ethereum'); },
    explorerUrl: 'https://etherscan.io',
    nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    id: 56,
    key: 'bsc',
    name: 'BSC',
    type: 'evm',
    symbol: 'BNB',
    get rpcUrl() { return getRpcUrl('bsc'); },
    explorerUrl: 'https://bscscan.com',
    nativeToken: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
  {
    id: 137,
    key: 'polygon',
    name: 'Polygon',
    type: 'evm',
    symbol: 'MATIC',
    get rpcUrl() { return getRpcUrl('polygon'); },
    explorerUrl: 'https://polygonscan.com',
    nativeToken: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  },
  {
    id: 42161,
    key: 'arbitrum',
    name: 'Arbitrum',
    type: 'evm',
    symbol: 'ETH',
    get rpcUrl() { return getRpcUrl('arbitrum'); },
    explorerUrl: 'https://arbiscan.io',
    nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    id: 8453,
    key: 'base',
    name: 'Base',
    type: 'evm',
    symbol: 'ETH',
    get rpcUrl() { return getRpcUrl('base'); },
    explorerUrl: 'https://basescan.org',
    nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    id: 11155111,
    key: 'sepolia',
    name: 'Sepolia Testnet',
    type: 'evm',
    symbol: 'ETH',
    isTestnet: true,
    get rpcUrl() { return getRpcUrl('sepolia'); },
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    id: 'solana-mainnet',
    key: 'solana',
    name: 'Solana',
    type: 'svm',
    symbol: 'SOL',
    get rpcUrl() { return getRpcUrl('solana'); },
    explorerUrl: 'https://explorer.solana.com',
    nativeToken: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  },
  {
    id: 'solana-devnet',
    key: 'solana-devnet',
    name: 'Solana Devnet',
    type: 'svm',
    symbol: 'SOL',
    isTestnet: true,
    get rpcUrl() { return getRpcUrl('solana-devnet'); },
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
    nativeToken: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  },
  {
    id: 'aptos-mainnet',
    key: 'aptos',
    name: 'Aptos',
    type: 'mvm',
    symbol: 'APT',
    get rpcUrl() { return getRpcUrl('aptos'); },
    explorerUrl: 'https://explorer.aptoslabs.com',
    nativeToken: { name: 'Aptos', symbol: 'APT', decimals: 8 },
  },
  {
    id: 'stellar-mainnet',
    key: 'stellar',
    name: 'Stellar',
    type: 'xlm',
    symbol: 'XLM',
    get rpcUrl() { return getRpcUrl('stellar'); },
    explorerUrl: 'https://stellar.expert/explorer/public',
    nativeToken: { name: 'Stellar Lumens', symbol: 'XLM', decimals: 7 },
  },
  {
    id: 'stellar-testnet',
    key: 'stellar-testnet',
    name: 'Stellar Testnet',
    type: 'xlm',
    symbol: 'XLM',
    isTestnet: true,
    get rpcUrl() { return getRpcUrl('stellar-testnet'); },
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    nativeToken: { name: 'Stellar Lumens', symbol: 'XLM', decimals: 7 },
  },
];
