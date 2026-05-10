/**
 * Veilpay Wallet Store
 * Manages wallet connection state, addresses, and chain selection
 * 
 * Security: @frontend-security-coder patterns applied
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { TransactionRecord } from '../types/transactions';
import { fetchTransactionHistoryPage } from '../utils/transactionHistory';
import { captureError } from '../utils/sentry';
import type { FiatGatewayProvider as SharedFiatGatewayProvider } from '../utils/fiatGateway';
import { getRpcUrl } from '../utils/rpc';
import { secureStateStorage } from '../utils/secureStateStorage';
import { deriveAddressesForAllChains } from '../utils/multiChainDerivation';
import { getStoredMnemonic } from '../utils/transactions';

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

// Privacy levels
export type PrivacyLevel = 'standard' | 'max';

export type TransakFlow = 'buy' | 'sell';

export type FiatGatewayProvider = SharedFiatGatewayProvider;

export type TransakOrderStatus = 'initiated' | 'processing' | 'success' | 'failed';

export interface TransakOrderRecord {
  provider: FiatGatewayProvider;
  orderId?: string;
  walletAddress: string;
  flow: TransakFlow;
  status: TransakOrderStatus;
  fiatAmount?: string;
  fiatCurrency?: string;
  cryptoAmount?: string;
  cryptoCurrency?: string;
  network?: string;
  updatedAt: number;
}

export type OnrampOrderStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface OnrampOrderRecord {
  provider: FiatGatewayProvider;
  id: string; // Internal UUID
  orderId?: string; // Provider ID
  walletAddress: string;
  userAddress: string;
  flow: 'buy' | 'sell';
  status: OnrampOrderStatus;
  fiatAmount: string;
  fiatCurrency: string;
  cryptoAmount?: string;
  cryptoToken: string;
  chainKey: string;
  txHash?: string;
  updatedAt: number;
}

const dedupeTransactions = (transactions: TransactionRecord[]): TransactionRecord[] => {
  const seen = new Set<string>();

  return transactions.filter((transaction) => {
    const dedupeKey = transaction.id || transaction.hash;
    if (!dedupeKey || seen.has(dedupeKey)) {
      return false;
    }

    seen.add(dedupeKey);
    return true;
  });
};

// Wallet connection state
export interface WalletState {
  // Persist hydration status
  hasHydrated: boolean;

  // Connection status
  isConnected: boolean;
  isConnecting: boolean;

  // Wallet info
  address: string | null; // Current active address
  addresses: Record<string, string | null>; // All chain addresses
  chainType: ChainType | null;
  activeChain: ChainConfig | null;

  // Privacy settings
  defaultPrivacyLevel: PrivacyLevel;
  biometricsEnabled: boolean;
  notificationsEnabled: boolean;
  analyticsEnabled: boolean;
  pushToken: string | null;

  // Appearance
  theme: 'dark' | 'light';

  // Custom chains
  customChains: ChainConfig[];

  // Balance and transactions (dynamic data)
  balance: string | null;
  balanceUsd: string | null;
  transactions: TransactionRecord[];
  transactionsCursor: string | null;
  hasMoreTransactions: boolean;
  isLoadingTransactions: boolean;
  transactionsError: string | null;
  isLoadingBalance: boolean;
  latestTransakOrder: TransakOrderRecord | null;
  latestOnrampOrder: OnrampOrderRecord | null;

  // Actions
  connect: (address: string, chainType: ChainType, chainKey?: string) => Promise<void>;
  disconnect: () => void;
  setActiveChain: (chain: ChainConfig) => void;
  setPrivacyLevel: (level: PrivacyLevel) => void;
  setBiometricsEnabled: (enabled: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setAnalyticsEnabled: (enabled: boolean) => void;
  setPushToken: (token: string | null) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setConnecting: (status: boolean) => void;
  setBalance: (balance: string, balanceUsd: string) => void;
  setTransactions: (transactions: TransactionRecord[]) => void;
  addTransaction: (transaction: TransactionRecord) => void;
  fetchTransactions: (options?: { reset?: boolean; limit?: number }) => Promise<void>;
  refreshTransactions: () => Promise<void>;
  loadMoreTransactions: () => Promise<void>;
  setLatestTransakOrder: (order: TransakOrderRecord) => void;
  clearLatestTransakOrder: () => void;
  setLatestOnrampOrder: (order: OnrampOrderRecord) => void;
  clearLatestOnrampOrder: () => void;
  setLoadingBalance: (loading: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
  addCustomChain: (chain: ChainConfig) => void;
  removeCustomChain: (chainKey: string) => void;
  allChains: () => ChainConfig[];
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      // Initial state
      hasHydrated: false,
      isConnected: false,
      isConnecting: false,
      address: null,
      addresses: {},
      chainType: null,
      activeChain: SUPPORTED_CHAINS[0], // Default to Ethereum
      defaultPrivacyLevel: 'standard',
      biometricsEnabled: false, // Opt-in for privacy-focused app
      notificationsEnabled: false, // Opt-in for privacy-focused app
      analyticsEnabled: false,
      pushToken: null,
      theme: 'dark',
      balance: null,
      balanceUsd: null,
      transactions: [],
      transactionsCursor: null,
      hasMoreTransactions: true,
      isLoadingTransactions: false,
      transactionsError: null,
  isLoadingBalance: false,
  latestTransakOrder: null,
  latestOnrampOrder: null,
  customChains: [],

      // Actions
  connect: async (address: string, chainType: ChainType, chainKey?: string) => {
    set({ isConnecting: true });
    try {
      const normalizedAddress = normalizeAddress(address, chainType);
      if (!normalizedAddress) {
        throw new Error(`Invalid ${chainType.toUpperCase()} address format`);
      }

      const availableChains = [...SUPPORTED_CHAINS, ...(get().customChains || [])];

      let chain: ChainConfig | undefined;
      if (chainKey) {
        chain = availableChains.find(c => c.key === chainKey);
      }
      if (!chain) {
        chain = availableChains.find(c => c.type === chainType);
      }
      if (!chain) {
        throw new Error(`Unsupported chain type: ${chainType}. Supported types: ${availableChains.map(c => c.type).join(', ')}`);
      }

      // If we have a mnemonic stored, derive all addresses
      let allAddresses: Record<string, string | null> = { [chainType]: normalizedAddress };
      try {
        const mnemonic = await getStoredMnemonic();
        if (mnemonic) {
          const derived = await deriveAddressesForAllChains(mnemonic);
          allAddresses = { ...derived };
        }
      } catch (e) {
        console.warn('[walletStore] Multi-chain derivation failed, using single address', e);
      }

          set({
            address: normalizedAddress,
            addresses: allAddresses as any,
            chainType,
            activeChain: chain,
            isConnected: true,
            isConnecting: false,
            transactions: [],
            transactionsCursor: null,
            hasMoreTransactions: true,
            transactionsError: null,
          });
        } catch (error) {
          set({ isConnecting: false });
          throw error;
        }
      },

      disconnect: () => {
        set({
          isConnected: false,
          address: null,
          addresses: {},
          chainType: null,
          activeChain: SUPPORTED_CHAINS[0],
          pushToken: null,
          balance: null,
          balanceUsd: null,
          transactions: [],
          transactionsCursor: null,
          hasMoreTransactions: true,
          transactionsError: null,
        });
      },

      setActiveChain: (chain: ChainConfig) => {
        const addresses = get().addresses;
        // Strictly use the address for the specific chain type
        const newAddress = addresses[chain.type] || null;
        
        set({
          activeChain: chain,
          address: newAddress,
          chainType: chain.type,
          transactions: [],
          transactionsCursor: null,
          hasMoreTransactions: true,
          transactionsError: null,
        });
      },

      setPrivacyLevel: (level: PrivacyLevel) => {
        set({ defaultPrivacyLevel: level });
      },

      setBiometricsEnabled: (enabled: boolean) => {
        set({ biometricsEnabled: enabled });
      },

      setNotificationsEnabled: (enabled: boolean) => {
        set({ notificationsEnabled: enabled });
      },

      setAnalyticsEnabled: (enabled: boolean) => {
        set({ analyticsEnabled: enabled });
      },

      setPushToken: (token: string | null) => {
        set({ pushToken: token });
      },

      setTheme: (theme: 'dark' | 'light') => {
        set({ theme });
      },

      setConnecting: (status: boolean) => {
        set({ isConnecting: status });
      },

      setBalance: (balance: string, balanceUsd: string) => {
        set({ balance, balanceUsd });
      },

      setTransactions: (transactions: TransactionRecord[]) => {
        const uniqueTransactions = dedupeTransactions(transactions).sort(
          (a, b) => b.timestamp - a.timestamp
        );
        set({ transactions: uniqueTransactions });
      },

      addTransaction: (transaction: TransactionRecord) => {
        set((state) => ({
          transactions: dedupeTransactions([transaction, ...state.transactions])
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 50),
        }));
      },

      setLatestTransakOrder: (order: TransakOrderRecord) => {
        set({
          latestTransakOrder: {
            ...order,
            provider: 'transak',
            updatedAt: order.updatedAt ?? Date.now(),
          },
        });
      },

      clearLatestTransakOrder: () => {
        set({ latestTransakOrder: null });
      },
      
      setLatestOnrampOrder: (order: OnrampOrderRecord) => {
        set({
          latestOnrampOrder: {
            ...order,
            provider: 'onramp_money',
            walletAddress: order.walletAddress || order.userAddress,
            userAddress: order.userAddress || order.walletAddress,
            updatedAt: order.updatedAt ?? Date.now(),
          },
        });
      },

      clearLatestOnrampOrder: () => {
        set({ latestOnrampOrder: null });
      },

      fetchTransactions: async ({ reset = false, limit = 20 } = {}) => {
        const {
          address,
          activeChain,
          isLoadingTransactions,
          transactionsCursor,
          transactions,
        } = get();

        if (!address || !activeChain || isLoadingTransactions) {
          return;
        }

        set({ isLoadingTransactions: true, transactionsError: null });

        try {
          const page = await fetchTransactionHistoryPage({
            address,
            chainKey: activeChain.key,
            cursor: reset ? undefined : transactionsCursor || undefined,
            limit,
          });

          const mergedTransactions = reset
            ? page.transactions
            : [...transactions, ...page.transactions];

          const normalizedTransactions = dedupeTransactions(mergedTransactions).sort(
            (a, b) => b.timestamp - a.timestamp
          );

          set({
            transactions: normalizedTransactions,
            transactionsCursor: page.nextCursor,
            hasMoreTransactions: page.hasMore,
            isLoadingTransactions: false,
            transactionsError: null,
          });
        } catch (error) {
          set({
            isLoadingTransactions: false,
            transactionsError:
              error instanceof Error ? error.message : 'Unable to load transaction history.',
          });
        }
      },

      refreshTransactions: async () => {
        await get().fetchTransactions({ reset: true });
      },

      loadMoreTransactions: async () => {
        const { hasMoreTransactions, isLoadingTransactions } = get();
        if (!hasMoreTransactions || isLoadingTransactions) {
          return;
        }

        await get().fetchTransactions({ reset: false });
      },

      setLoadingBalance: (loading: boolean) => {
        set({ isLoadingBalance: loading });
      },

  setHasHydrated: (hydrated: boolean) => {
    set({ hasHydrated: hydrated });
  },

  addCustomChain: (chain: ChainConfig): void => {
    set((state: WalletState) => ({
      customChains: [...state.customChains.filter((c) => c.key !== chain.key), chain],
    }));
  },

  removeCustomChain: (chainKey: string): void => {
    set((state: WalletState) => ({
      customChains: state.customChains.filter((c) => c.key !== chainKey),
      activeChain:
        state.activeChain?.key === chainKey ? SUPPORTED_CHAINS[0] : state.activeChain,
    }));
  },

  allChains: (): ChainConfig[] => {
    const state = get() as WalletState;
    return [...SUPPORTED_CHAINS, ...(state.customChains || [])];
  },
    }),
    {
      name: 'veilpay-wallet-storage',
      version: 1,
      storage: createJSONStorage(() => secureStateStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          captureError(error instanceof Error ? error : new Error('Wallet store hydration failed'), {
            scope: 'wallet-store',
          });
        }
    
        state?.setHasHydrated(true);
      },
      /**
       * State migration: runs when the persisted version is older than `version`.
       * Each case upgrades from the previous version. If the version is missing
       * (pre-versioning state), we treat it as version 0 and clear fields that
       * should not have been persisted (pushToken, latestTransakOrder).
       */
      migrate: (persistedState: unknown, version: number): Partial<WalletState> => {
        if (version < 2) {
          // Version 1 → 2: Keep onramp orders for post-restart sync, but remove
          // stale Transak order persistence.
          const state = persistedState as Record<string, unknown>;
          const cleaned = { ...state };
          delete cleaned.pushToken;
          delete cleaned.latestTransakOrder;
          return cleaned as Partial<WalletState>;
        }
    
        return persistedState as Partial<WalletState>;
      },
  partialize: (state) => ({
    isConnected: state.isConnected,
    address: state.address,
    chainType: state.chainType,
    activeChain: state.activeChain,
    defaultPrivacyLevel: state.defaultPrivacyLevel,
    biometricsEnabled: state.biometricsEnabled,
    notificationsEnabled: state.notificationsEnabled,
    analyticsEnabled: state.analyticsEnabled,
    theme: state.theme,
    customChains: state.customChains,
    transactions: state.transactions.slice(0, 50),
    latestOnrampOrder: state.latestOnrampOrder,
  }),
    }
  )
);

// Helper hooks
export const useWalletAddress = () => useWalletStore((state) => state.address);
export const useIsConnected = () => useWalletStore((state) => state.isConnected);
export const useActiveChain = () => useWalletStore((state) => state.activeChain);
export const useWalletHydrated = () => useWalletStore((state) => state.hasHydrated);
export const usePrivacyLevel = () => useWalletStore((state) => state.defaultPrivacyLevel);
export const useThemeState = () => useWalletStore((state) => state.theme);
export const useBalance = () => useWalletStore(
  useShallow((state) => ({ balance: state.balance, balanceUsd: state.balanceUsd }))
);
export const useTransactions = () => useWalletStore((state) => state.transactions);
