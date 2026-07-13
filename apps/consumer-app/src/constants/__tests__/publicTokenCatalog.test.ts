import { SUPPORTED_CHAINS } from '../../stores/walletStore';
import {
  expectedNativeSymbol,
  hasCatalogEntryForChainKey,
  listPublicTokensForChain,
} from '../publicTokenCatalog';

/** Natives that must never appear as the default on the wrong family of chains. */
const WRONG_FOR_BSC = ['ETH', 'MATIC', 'SOL', 'XLM'];
const WRONG_FOR_ETH_FAMILY = ['BNB', 'MATIC', 'SOL', 'XLM'];
const WRONG_FOR_POLYGON = ['BNB', 'SOL', 'XLM'];
const WRONG_FOR_SOL = ['ETH', 'BNB', 'MATIC', 'XLM'];
const WRONG_FOR_XLM = ['ETH', 'BNB', 'MATIC', 'SOL'];

describe('listPublicTokensForChain — all product chains', () => {
  it('has a catalog key for every SUPPORTED_CHAINS entry', () => {
    for (const chain of SUPPORTED_CHAINS) {
      expect(hasCatalogEntryForChainKey(chain.key)).toBe(true);
    }
  });

  it.each(SUPPORTED_CHAINS.map((c) => [c.key, c] as const))(
    '%s: native is first and matches chain.nativeToken',
    (key, chain) => {
      const tokens = listPublicTokensForChain(key, chain);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens[0]!.symbol).toBe(chain.nativeToken.symbol);
      expect(tokens[0]!.symbol).toBe(expectedNativeSymbol(key, chain));
      // No duplicate symbols
      const symbols = tokens.map((t) => t.symbol);
      expect(new Set(symbols).size).toBe(symbols.length);
    }
  );

  it('bsc lists BNB + stables, not ETH/MATIC', () => {
    const chain = SUPPORTED_CHAINS.find((c) => c.key === 'bsc')!;
    const symbols = listPublicTokensForChain('bsc', chain).map((t) => t.symbol);
    expect(symbols[0]).toBe('BNB');
    expect(symbols).toEqual(expect.arrayContaining(['USDT', 'USDC']));
    for (const bad of WRONG_FOR_BSC) {
      expect(symbols).not.toContain(bad);
    }
  });

  it('ethereum lists ETH + stables, not BNB/MATIC', () => {
    const chain = SUPPORTED_CHAINS.find((c) => c.key === 'ethereum')!;
    const symbols = listPublicTokensForChain('ethereum', chain).map((t) => t.symbol);
    expect(symbols[0]).toBe('ETH');
    expect(symbols).toEqual(expect.arrayContaining(['USDT', 'USDC', 'DAI']));
    for (const bad of WRONG_FOR_ETH_FAMILY) {
      expect(symbols).not.toContain(bad);
    }
  });

  it.each(['arbitrum', 'base', 'sepolia'] as const)(
    '%s lists ETH native, not BNB/MATIC',
    (key) => {
      const chain = SUPPORTED_CHAINS.find((c) => c.key === key)!;
      const symbols = listPublicTokensForChain(key, chain).map((t) => t.symbol);
      expect(symbols[0]).toBe('ETH');
      for (const bad of ['BNB', 'MATIC', 'SOL', 'XLM']) {
        expect(symbols).not.toContain(bad);
      }
    }
  );

  it('polygon lists MATIC, not BNB/ETH as native', () => {
    const chain = SUPPORTED_CHAINS.find((c) => c.key === 'polygon')!;
    const symbols = listPublicTokensForChain('polygon', chain).map((t) => t.symbol);
    expect(symbols[0]).toBe('MATIC');
    for (const bad of WRONG_FOR_POLYGON) {
      expect(symbols).not.toContain(bad);
    }
  });

  it.each(['solana', 'solana-devnet'] as const)('%s lists SOL native', (key) => {
    const chain = SUPPORTED_CHAINS.find((c) => c.key === key)!;
    const symbols = listPublicTokensForChain(key, chain).map((t) => t.symbol);
    expect(symbols[0]).toBe('SOL');
    for (const bad of WRONG_FOR_SOL) {
      expect(symbols).not.toContain(bad);
    }
  });

  it.each(['stellar', 'stellar-testnet'] as const)(
    '%s lists XLM + USDC (no EVM natives)',
    (key) => {
      const chain = SUPPORTED_CHAINS.find((c) => c.key === key)!;
      const tokens = listPublicTokensForChain(key, chain);
      const symbols = tokens.map((t) => t.symbol);
      expect(symbols[0]).toBe('XLM');
      expect(symbols).toContain('USDC');
      const usdc = tokens.find((t) => t.symbol === 'USDC');
      expect(usdc?.address).toMatch(/^G[A-Z2-7]{55}$/);
      for (const bad of ['ETH', 'BNB', 'MATIC', 'SOL']) {
        expect(symbols).not.toContain(bad);
      }
    }
  );

  it('custom chain still gets native-only from config when no stables map', () => {
    const tokens = listPublicTokensForChain('my-l2', {
      key: 'my-l2',
      type: 'evm',
      symbol: 'MYT',
      nativeToken: { name: 'My Token', symbol: 'MYT', decimals: 18 },
    });
    expect(tokens.map((t) => t.symbol)).toEqual(['MYT']);
  });

  it('optimism (optional) uses ETH + OP stables when chain config provided', () => {
    const symbols = listPublicTokensForChain('optimism', {
      key: 'optimism',
      type: 'evm',
      symbol: 'ETH',
      nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    }).map((t) => t.symbol);
    expect(symbols[0]).toBe('ETH');
    expect(symbols).toEqual(expect.arrayContaining(['USDT', 'USDC']));
    expect(symbols).not.toContain('BNB');
  });
});
