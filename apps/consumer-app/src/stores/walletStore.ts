/**
 * Veilpay Wallet Store
 * Manages wallet connection state, addresses, and chain selection
 * 
 * Security: @frontend-security-coder patterns applied
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { captureError } from '../utils/sentry';
import { getRpcUrl } from '../utils/rpc';
import { secureStateStorage } from '../utils/secureStateStorage';
import { deriveAddressesForAllChains } from '../utils/multiChainDerivation';
import { getStoredMnemonic } from '../utils/transactions';
import { useTransactionStore } from './transactionStore';
import {
  validateAddress as validateAddressImpl,
  normalizeAddress as normalizeAddressImpl,
  type SupportedChainType,
} from '../utils/validation';

// Supported chain types.
//
// NOTE: this is the same union as `SupportedChainType` in `utils/validation.ts`.
// We keep the `ChainType` alias here because many call sites import it from the
// store, but the address-validation *logic* now has a single source of truth in
// `utils/validation.ts` — see `validateAddress`/`normalizeAddress` below.
export type ChainType = 'evm' | 'svm' | 'mvm' | 'xlm';

// Compile-time assertion that the two unions stay in lock-step. If either side
// gains/loses a member, this line stops type-checking.
type _AssertChainTypeParity = ChainType extends SupportedChainType
  ? SupportedChainType extends ChainType
    ? true
    : never
  : never;

/**
 * Validates wallet address format based on chain type.
 *
 * Thin delegate to the canonical implementation in `utils/validation.ts` so
 * there is exactly one address-format source of truth in the app. Kept as a
 * named export here because many screens/stores import it from the store.
 */
export const validateAddress = (address: string, chainType: ChainType): boolean =>
  validateAddressImpl(address, chainType);

/**
 * Validates and normalizes address format. Delegates to `utils/validation.ts`.
 */
export const normalizeAddress = (
  address: string,
  chainType: ChainType
): string | null => normalizeAddressImpl(address, chainType);

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

export interface WalletAccount {
  id: string;
  name: string;
  index: number;
  addresses?: Record<string, string | null>;
}

// Wallet connection state
export interface WalletState {
  hasHydrated: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  addresses: Record<string, string | null>;
  chainType: ChainType | null;
  activeChain: ChainConfig | null;
  customChains: ChainConfig[];
  
  accounts: WalletAccount[];
  activeAccountId: string | null;

  balance: string | null;
  balanceUsd: string | null;
  isLoadingBalance: boolean;
  isProving: boolean;

  connect: (address: string, chainType: ChainType, chainKey?: string) => Promise<void>;
  disconnect: () => void;
  clearWallet: () => void;
  setIsProving: (isProving: boolean) => void;
  setActiveChain: (chain: ChainConfig) => void;
  setConnecting: (status: boolean) => void;
  setBalance: (balance: string, balanceUsd: string) => void;
  setLoadingBalance: (loading: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
  addCustomChain: (chain: ChainConfig) => void;
  removeCustomChain: (chainKey: string) => void;
  allChains: () => ChainConfig[];
  
  addAccount: (name?: string) => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  updateAccountName: (accountId: string, newName: string) => void;
  deleteAccount: (accountId: string) => Promise<void>;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      isConnected: false,
      isConnecting: false,
      isProving: false,
      address: null,
      addresses: {},
      chainType: null,
      activeChain: SUPPORTED_CHAINS[0],
      accounts: [],
      activeAccountId: null,
      balance: null,
      balanceUsd: null,
      isLoadingBalance: false,
      customChains: [],

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

          let allAddresses: Record<string, string | null> = { [chainType]: normalizedAddress };
          let accounts = get().accounts;
          let activeAccountId = get().activeAccountId;
          
          if (accounts.length === 0) {
            accounts = [{ id: '0', name: 'Account 1', index: 0 }];
            activeAccountId = '0';
          }
          
          try {
            const mnemonic = await getStoredMnemonic();
            if (mnemonic) {
              const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];
              if (activeAccount.addresses) {
                allAddresses = activeAccount.addresses;
              } else {
                const derived = await deriveAddressesForAllChains(mnemonic, activeAccount.index);
                allAddresses = { ...derived };
                accounts = accounts.map(a => a.id === activeAccount.id ? { ...a, addresses: derived } : a);
              }
            }
          } catch (e) {
            console.warn('[walletStore] Multi-chain derivation failed, using single address', e);
          }

          useTransactionStore.getState().clearTransactions();

          set({
            address: normalizedAddress,
            addresses: allAddresses as any,
            chainType,
            activeChain: chain,
            isConnected: true,
            isConnecting: false,
            accounts,
            activeAccountId,
          });
        } catch (error) {
          set({ isConnecting: false });
          throw error;
        }
      },

      setIsProving: (isProving: boolean) => set({ isProving }),

      clearWallet: () => {
        useTransactionStore.getState().clearTransactions();
        set({
          address: null,
          addresses: {},
          isConnected: false,
          hasHydrated: false,
        });
      },

      disconnect: () => {
        useTransactionStore.getState().clearTransactions();
        set({
          isConnected: false,
          address: null,
          addresses: {},
          chainType: null,
          activeChain: SUPPORTED_CHAINS[0],
          balance: null,
          balanceUsd: null,
        });
      },

      setActiveChain: (chain: ChainConfig) => {
        const addresses = get().addresses;
        const newAddress = addresses[chain.type] || null;
        
        useTransactionStore.getState().clearTransactions();
        
        set({
          activeChain: chain,
          address: newAddress,
          chainType: chain.type,
        });
      },

      setConnecting: (status: boolean) => {
        set({ isConnecting: status });
      },

      setBalance: (balance: string, balanceUsd: string) => {
        set({ balance, balanceUsd });
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
      
      addAccount: async (name?: string) => {
        const state = get() as WalletState;
        const newIndex = state.accounts.length > 0 ? Math.max(...state.accounts.map(a => a.index)) + 1 : 0;
        const newAccount: WalletAccount = {
          id: Date.now().toString(),
          name: name || `Account ${newIndex + 1}`,
          index: newIndex,
        };
        
        set({
          accounts: [...state.accounts, newAccount],
        });
        
        // Immediately switch to the new account
        await get().switchAccount(newAccount.id);
      },
      
      switchAccount: async (accountId: string) => {
        const state = get() as WalletState;
        const account = state.accounts.find(a => a.id === accountId);
        if (!account) return;
        
        // If we already have the derived addresses cached, switching is INSTANT
        if (account.addresses) {
          const activeChain = state.activeChain || SUPPORTED_CHAINS[0];
          const newAddress = account.addresses[activeChain.type];
          useTransactionStore.getState().clearTransactions();
          
          set({
            activeAccountId: account.id,
            addresses: account.addresses as any,
            address: newAddress,
            balance: null,
            balanceUsd: null,
            isConnecting: false,
          });
          return;
        }

        set({ isConnecting: true });
        
        // Yield to the UI thread so the loading state can render before heavy derivation
        await new Promise(resolve => setTimeout(resolve, 50));
        
        try {
          const mnemonic = await getStoredMnemonic();
          if (mnemonic) {
            const derived = await deriveAddressesForAllChains(mnemonic, account.index);
            const activeChain = get().activeChain || SUPPORTED_CHAINS[0];
            const newAddress = derived[activeChain.type];
            
            // Clear transactions when switching accounts
            useTransactionStore.getState().clearTransactions();
            
            // Cache the derived addresses so future switches to this account are instant
            const updatedAccounts = get().accounts.map(a => a.id === account.id ? { ...a, addresses: derived } : a);
            
            set({
              accounts: updatedAccounts,
              activeAccountId: account.id,
              addresses: derived as any,
              address: newAddress,
              balance: null,
              balanceUsd: null,
              isConnecting: false,
            });
          } else {
            set({ isConnecting: false });
          }
        } catch (error) {
          console.error('Failed to switch account:', error);
          set({ isConnecting: false });
        }
      },

      updateAccountName: (accountId: string, newName: string) => {
        set((state) => ({
          accounts: state.accounts.map(a => a.id === accountId ? { ...a, name: newName } : a)
        }));
      },

      deleteAccount: async (accountId: string) => {
        const state = get() as WalletState;
        if (state.accounts.length <= 1) return; // Cannot delete the last account
        
        const newAccounts = state.accounts.filter(a => a.id !== accountId);
        set({ accounts: newAccounts });
        
        if (state.activeAccountId === accountId) {
          // If we deleted the active account, switch to the first available one
          await get().switchAccount(newAccounts[0].id);
        }
      },
    }),
    {
      name: 'veilpay-wallet-storage',
      version: 2,
      storage: createJSONStorage(() => secureStateStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          captureError(error instanceof Error ? error : new Error('Wallet store hydration failed'), {
            scope: 'wallet-store',
          });
        }
        state?.setHasHydrated(true);
      },
      migrate: (persistedState: unknown, version: number): Partial<WalletState> => {
        if (version < 2) {
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
        addresses: state.addresses,
        chainType: state.chainType,
        activeChain: state.activeChain,
        customChains: state.customChains,
        accounts: state.accounts,
        activeAccountId: state.activeAccountId,
      }),
    }
  )
);

// Helper hooks
export const useWalletAddress = () => useWalletStore((state) => state.address);
export const useIsConnected = () => useWalletStore((state) => state.isConnected);
export const useActiveChain = () => useWalletStore((state) => state.activeChain);
export const useWalletHydrated = () => useWalletStore((state) => state.hasHydrated);
export const useBalance = () => useWalletStore(
  useShallow((state) => ({ balance: state.balance, balanceUsd: state.balanceUsd }))
);
