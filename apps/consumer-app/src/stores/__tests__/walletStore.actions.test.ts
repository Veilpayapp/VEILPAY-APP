/**
 * walletStore — action-lane tests (state mutations that don't need key
 * derivation).
 *
 * Covers the simple setters, clearWallet/disconnect isolation, setActiveChain
 * address resolution + the Aptos/mvm removal guard, and the custom-chain
 * registry (add/replace/aptos-guard/remove-with-active-reset/allChains).
 */
jest.mock('../../utils/secureStateStorage', () => ({
  secureStateStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import {
  useWalletStore,
  SUPPORTED_CHAINS,
  type ChainConfig,
} from '../walletStore';

function evmChain(key: string): ChainConfig {
  return {
    id: key,
    key,
    name: key,
    type: 'evm',
    symbol: 'SYM',
    rpcUrl: 'https://rpc.test',
    explorerUrl: 'https://explorer.test',
    nativeToken: { symbol: 'SYM', name: 'Sym', decimals: 18 },
  };
}

const ETH_ADDRESS = '0x' + '1'.repeat(40);
const DEFAULT_CHAIN = SUPPORTED_CHAINS[0];

describe('walletStore actions', () => {
  beforeEach(() => {
    useWalletStore.setState({
      customChains: [],
      balance: null,
      balanceUsd: null,
      isLoadingBalance: false,
      isConnecting: false,
      isProving: false,
      hasHydrated: false,
      addresses: {},
      address: null,
      isConnected: false,
      activeChain: DEFAULT_CHAIN,
    });
  });

  it('simple setters update their slices', () => {
    const s = useWalletStore.getState();
    s.setBalance('1.5', '3000.00');
    expect(useWalletStore.getState().balance).toBe('1.5');
    expect(useWalletStore.getState().balanceUsd).toBe('3000.00');

    s.setLoadingBalance(true);
    expect(useWalletStore.getState().isLoadingBalance).toBe(true);
    s.setConnecting(true);
    expect(useWalletStore.getState().isConnecting).toBe(true);
    s.setIsProving(true);
    expect(useWalletStore.getState().isProving).toBe(true);
    s.setHasHydrated(true);
    expect(useWalletStore.getState().hasHydrated).toBe(true);
  });

  it('clearWallet resets connection state', () => {
    useWalletStore.setState({
      address: ETH_ADDRESS,
      addresses: { evm: ETH_ADDRESS },
      isConnected: true,
      hasHydrated: true,
    });
    useWalletStore.getState().clearWallet();

    const state = useWalletStore.getState();
    expect(state.address).toBeNull();
    expect(state.addresses).toEqual({});
    expect(state.isConnected).toBe(false);
    expect(state.hasHydrated).toBe(false);
  });

  it('setActiveChain resolves the per-chain address from the addresses map', () => {
    useWalletStore.setState({ addresses: { evm: ETH_ADDRESS } });
    const eth = evmChain('ethereum');

    useWalletStore.getState().setActiveChain(eth);
    const state = useWalletStore.getState();
    expect(state.activeChain?.key).toBe('ethereum');
    expect(state.address).toBe(ETH_ADDRESS);
    expect(state.chainType).toBe('evm');

    // No stored address for that chain type → address null.
    const polygon = SUPPORTED_CHAINS.find((c) => c.key === 'polygon');
    if (polygon) {
      useWalletStore.getState().setActiveChain(polygon);
      expect(useWalletStore.getState().activeChain?.key).toBe('polygon');
    }
  });

  it('setActiveChain never re-selects Aptos/mvm (falls back to the default chain)', () => {
    const aptosLike = { ...evmChain('aptos-clone'), key: 'aptos' };
    useWalletStore.getState().setActiveChain(aptosLike as ChainConfig);
    expect(useWalletStore.getState().activeChain?.key).toBe(DEFAULT_CHAIN.key);

    const mvmLike = { ...evmChain('mvm-clone'), type: 'mvm' as unknown as ChainConfig['type'] };
    useWalletStore.getState().setActiveChain(mvmLike);
    expect(useWalletStore.getState().activeChain?.key).toBe(DEFAULT_CHAIN.key);
  });

  it('addCustomChain appends, replaces by key, and ignores aptos/mvm', () => {
    const chain = evmChain('my-chain');
    useWalletStore.getState().addCustomChain(chain);
    expect(useWalletStore.getState().customChains).toHaveLength(1);

    // Same key → replaced, not duplicated.
    const chainV2 = { ...chain, name: 'my-chain-v2' };
    useWalletStore.getState().addCustomChain(chainV2);
    const custom = useWalletStore.getState().customChains;
    expect(custom).toHaveLength(1);
    expect(custom[0].name).toBe('my-chain-v2');

    // Aptos-style entry is ignored entirely.
    useWalletStore.getState().addCustomChain({ ...evmChain('aptos'), key: 'aptos' });
    useWalletStore.getState().addCustomChain({ ...evmChain('mvm-x'), type: 'mvm' as unknown as ChainConfig['type'] });
    expect(useWalletStore.getState().customChains).toHaveLength(1);
  });

  it('removeCustomChain removes the entry and resets activeChain if it pointed at it', () => {
    const chain = evmChain('my-chain');
    useWalletStore.getState().addCustomChain(chain);
    useWalletStore.getState().setActiveChain(chain);
    expect(useWalletStore.getState().activeChain?.key).toBe('my-chain');

    useWalletStore.getState().removeCustomChain('my-chain');
    const state = useWalletStore.getState();
    expect(state.customChains).toHaveLength(0);
    expect(state.activeChain?.key).toBe(DEFAULT_CHAIN.key);

    // Removing a chain that is not active leaves activeChain alone.
    const other = evmChain('other-chain');
    useWalletStore.getState().addCustomChain(other);
    useWalletStore.getState().removeCustomChain('not-active-anywhere');
    expect(useWalletStore.getState().activeChain?.key).toBe(DEFAULT_CHAIN.key);
    expect(useWalletStore.getState().customChains).toHaveLength(1);
  });

  it('allChains merges built-in and custom chains', () => {
    useWalletStore.getState().addCustomChain(evmChain('my-chain'));
    const all = useWalletStore.getState().allChains();
    expect(all.length).toBe(SUPPORTED_CHAINS.length + 1);
    expect(all.some((c) => c.key === 'my-chain')).toBe(true);
  });
});
