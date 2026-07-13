/**
 * Shared RPC URL resolution for the backend (RPC proxy + payment verify).
 * Priority: Alchemy → Infura → public fallback. Keys stay server-side only.
 */

import { config } from '../config';

const PUBLIC_FALLBACKS: Record<string, string> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  bsc: 'https://bsc-dataseed.binance.org',
  polygon: 'https://polygon-rpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  base: 'https://mainnet.base.org',
  sepolia: 'https://rpc.sepolia.org',
  solana: 'https://api.mainnet-beta.solana.com',
  'solana-devnet': 'https://api.devnet.solana.com',
  stellar: 'https://horizon.stellar.org',
  'stellar-testnet': 'https://horizon-testnet.stellar.org',
};

function buildAlchemyUrl(chainKey: string): string | null {
  const apiKey = config.rpc.alchemyApiKey?.trim();
  if (!apiKey) return null;

  const slugs: Record<string, string> = {
    ethereum: 'eth-mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arb-mainnet',
    optimism: 'opt-mainnet',
    base: 'base-mainnet',
    sepolia: 'eth-sepolia',
    solana: 'solana-mainnet',
    bsc: 'bnb-mainnet',
  };

  const slug = slugs[chainKey];
  if (!slug) return null;

  return chainKey === 'solana'
    ? `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`
    : `https://${slug}.g.alchemy.com/v2/${apiKey}`;
}

function buildInfuraUrl(chainKey: string): string | null {
  const apiKey = config.rpc.infuraApiKey?.trim();
  if (!apiKey) return null;

  const slugs: Record<string, string> = {
    ethereum: 'mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arbitrum-mainnet',
    optimism: 'optimism-mainnet',
    base: 'base-mainnet',
    sepolia: 'sepolia',
  };

  const slug = slugs[chainKey];
  if (!slug) return null;

  return `https://${slug}.infura.io/v3/${apiKey}`;
}

/**
 * Resolve HTTP JSON-RPC (or Horizon) URL for a product chainKey.
 * Empty string when no fallback exists (caller should fail closed).
 */
export function getRpcUrl(chainKey: string): string {
  const key = chainKey.trim().toLowerCase();
  const alchemyUrl = buildAlchemyUrl(key);
  if (alchemyUrl) return alchemyUrl;

  const infuraUrl = buildInfuraUrl(key);
  if (infuraUrl) return infuraUrl;

  return PUBLIC_FALLBACKS[key] || '';
}

/** Horizon base URL for Stellar (testnet / public). */
export function getHorizonUrl(chainKey: string): string | null {
  const key = chainKey.trim().toLowerCase();
  if (key === 'stellar' || key === 'stellar-testnet') {
    return PUBLIC_FALLBACKS[key] ?? null;
  }
  return null;
}

/** Whether this chain is EVM and has a usable HTTP transport URL. */
export function getEvmHttpTransportUrl(chainKey: string): string | null {
  const key = chainKey.trim().toLowerCase();
  const evm = new Set([
    'ethereum',
    'polygon',
    'arbitrum',
    'optimism',
    'base',
    'bsc',
    'sepolia',
  ]);
  if (!evm.has(key)) return null;
  const url = getRpcUrl(key);
  return url || null;
}
