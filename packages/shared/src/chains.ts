export type ChainType = "evm" | "svm" | "mvm" | "xlm";

/**
 * Optional Stellar Private Payments (SPP) contract set for a chain.
 * Absent / undefined = SPP disabled (mainnet fail-closed until audit/ceremony).
 * Consumer app also mirrors these IDs in `apps/consumer-app/src/constants/spp.ts`.
 */
export interface SppChainConfig {
  poolId: string;
  verifierId: string;
  aspMembershipId: string;
  aspNonMembershipId: string;
  registryId: string;
  sorobanRpcUrl?: string;
}

export interface ChainConfig {
  key: string;
  name: string;
  type: ChainType;
  chainId: number | null;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** Present only when SPP is product-enabled for this chain (testnet today). */
  spp?: SppChainConfig;
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    key: "ethereum",
    name: "Ethereum",
    type: "evm",
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  {
    key: "polygon",
    name: "Polygon",
    type: "evm",
    chainId: 137,
    rpcUrl: "https://polygon.llamarpc.com",
    explorerUrl: "https://polygonscan.com",
    // SC-M fix: Polygon native currency is POL (EIP-2063/PIP-17)
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  },
  {
    key: "arbitrum",
    name: "Arbitrum One",
    type: "evm",
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  {
    key: "optimism",
    name: "Optimism",
    type: "evm",
    chainId: 10,
    rpcUrl: "https://mainnet.optimism.io",
    explorerUrl: "https://optimistic.etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  {
    key: "base",
    name: "Base",
    type: "evm",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  {
    key: "bsc",
    name: "BSC",
    type: "evm",
    chainId: 56,
    rpcUrl: "https://bsc-dataseed1.binance.org",
    explorerUrl: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  },
  {
    key: "solana",
    name: "Solana",
    type: "svm",
    chainId: null,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    explorerUrl: "https://explorer.solana.com",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  },
  {
    key: "aptos",
    name: "Aptos",
    type: "mvm",
    chainId: null,
    rpcUrl: "https://fullnode.mainnet.aptoslabs.com",
    explorerUrl: "https://explorer.aptoslabs.com",
    nativeCurrency: { name: "Aptos", symbol: "APT", decimals: 8 },
  },
  {
    key: "stellar",
    name: "Stellar",
    type: "xlm",
    chainId: null,
    rpcUrl: "https://horizon.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/public",
    nativeCurrency: { name: "Stellar Lumens", symbol: "XLM", decimals: 7 },
    // Mainnet: no `spp` — fail-closed until audit + ceremony.
  },
  // Testnet chains for development
  {
    key: "sepolia",
    name: "Sepolia Testnet",
    type: "evm",
    chainId: 11155111,
    rpcUrl: "https://rpc.sepolia.org",
    explorerUrl: "https://sepolia.etherscan.io",
    nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  },
  {
    key: "solana-devnet",
    name: "Solana Devnet",
    type: "svm",
    chainId: null,
    rpcUrl: "https://api.devnet.solana.com",
    explorerUrl: "https://explorer.solana.com",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  },
  {
    key: "stellar-testnet",
    name: "Stellar Testnet",
    type: "xlm",
    chainId: null,
    rpcUrl: "https://horizon-testnet.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/testnet",
    nativeCurrency: { name: "Stellar Lumens", symbol: "XLM", decimals: 7 },
    spp: {
      poolId: "CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH",
      verifierId: "CCKNCZXDGM7Z7EHL7PVQEYRDK636TZJIDODO5TSAS5BME2JYGMFR3MU3",
      aspMembershipId: "CDSJXWV5JITIQLXNM4AEI53RY2UQLOQBCG6WKYCFPWS5AHBAD3FWAVNH",
      aspNonMembershipId: "CBG3BT6KHJM3UQGSUP2GHPQE5FLPEYBFVF47DCDHH6UOYQ6KDT5URJTI",
      registryId: "CB3IAFWZPU5H5MQ4NEMQCWLZJ6PAYZWLAA4DZIRZZCWXSI2WV6C7L556",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    },
  },
];

export function getChainByKey(key: string): ChainConfig | undefined {
  return SUPPORTED_CHAINS.find((chain) => chain.key === key);
}

export function getChainByChainId(chainId: number): ChainConfig | undefined {
  return SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId);
}

export function getChainsByType(type: ChainType): ChainConfig[] {
  return SUPPORTED_CHAINS.filter((chain) => chain.type === type);
}

export { SUPPORTED_CHAINS as supportedChains };
