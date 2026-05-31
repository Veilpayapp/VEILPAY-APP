export type SupportedChainType = 'evm' | 'svm' | 'mvm' | 'xlm';

const ADDRESS_PATTERNS: Record<SupportedChainType, RegExp> = {
  evm: /^0x[a-fA-F0-9]{40}$/,
  svm: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  mvm: /^0x[a-fA-F0-9]{1,64}$/,
  xlm: /^G[A-Z2-7]{55}$/,
};

const CHAIN_TYPES_BY_KEY: Record<string, SupportedChainType> = {
  ethereum: 'evm',
  bsc: 'evm',
  polygon: 'evm',
  arbitrum: 'evm',
  sepolia: 'evm',
  solana: 'svm',
  'solana-devnet': 'svm',
  aptos: 'mvm',
  stellar: 'xlm',
  'stellar-testnet': 'xlm',
};

export function getChainTypeFromKey(key: string): SupportedChainType | null {
  return CHAIN_TYPES_BY_KEY[key] ?? null;
}

export function validateAddress(address: string, chainType?: SupportedChainType): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  if (chainType) {
    return ADDRESS_PATTERNS[chainType].test(address);
  }

  return Object.values(ADDRESS_PATTERNS).some((pattern) => pattern.test(address));
}

export function normalizeAddress(address: string, chainType?: SupportedChainType): string | null {
  if (!validateAddress(address, chainType)) {
    return null;
  }

  if (chainType === 'evm' || chainType === 'mvm') {
    return address.toLowerCase();
  }

  return address;
}