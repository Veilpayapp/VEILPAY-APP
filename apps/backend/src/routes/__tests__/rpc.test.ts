import { rpcRoutes } from '../rpc';
import { __test } from '../rpc';

describe('RPC Proxy Routes', () => {
  it('registers the JSON-RPC POST route', () => {
    const routes = rpcRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/:chainKey', method: 'post' });
    // REST GET passthrough for Stellar Horizon
    expect(routes).toContainEqual({ path: '/:chainKey/*', method: 'get' });
  });

  describe('method allowlist (S2)', () => {
    it('allows standard read-only EVM methods', () => {
      const { allowed, disallowed } = __test.checkMethodAllowlist({
        jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [],
      });
      expect(allowed).toBe(true);
      expect(disallowed).toBeUndefined();
    });

    it('allows Alchemy-enhanced read methods', () => {
      const { allowed } = __test.checkMethodAllowlist({
        jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenBalances', params: [],
      });
      expect(allowed).toBe(true);
    });

    it('allows Solana read methods', () => {
      const { allowed } = __test.checkMethodAllowlist({
        jsonrpc: '2.0', id: 1, method: 'getBalance', params: [],
      });
      expect(allowed).toBe(true);
    });

    it('rejects signing methods', () => {
      const { allowed, disallowed } = __test.checkMethodAllowlist({
        jsonrpc: '2.0', id: 1, method: 'eth_sign', params: [],
      });
      expect(allowed).toBe(false);
      expect(disallowed).toEqual(['eth_sign']);
    });

    it('rejects debug/trace methods that burn provider credits', () => {
      const { allowed, disallowed } = __test.checkMethodAllowlist({
        jsonrpc: '2.0', id: 1, method: 'trace_transaction', params: [],
      });
      expect(allowed).toBe(false);
      expect(disallowed).toEqual(['trace_transaction']);
    });

    it('rejects write methods', () => {
      const { allowed } = __test.checkMethodAllowlist({
        jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction', params: [],
      });
      expect(allowed).toBe(false);
    });

    it('validates every method in a batch request', () => {
      const { allowed, disallowed } = __test.checkMethodAllowlist([
        { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [] },
        { jsonrpc: '2.0', id: 3, method: 'admin_nodeInfo', params: [] },
      ]);
      expect(allowed).toBe(false);
      expect(disallowed).toEqual(['admin_nodeInfo']);
    });

    it('passes through non-JSON-RPC bodies (relies on upstream)', () => {
      const { allowed } = __test.checkMethodAllowlist({ foo: 'bar' });
      expect(allowed).toBe(true);
    });
  });

  describe('URL redaction (S3)', () => {
    it('strips Alchemy API keys from URLs', () => {
      const redacted = __test.redactUrl('https://eth-mainnet.g.alchemy.com/v2/SECRETKEY123');
      expect(redacted).toBe('https://eth-mainnet.g.alchemy.com/v2/[REDACTED]');
      expect(redacted).not.toContain('SECRETKEY123');
    });

    it('strips Infura API keys from URLs', () => {
      const redacted = __test.redactUrl('https://mainnet.infura.io/v3/INFURA_SECRET');
      expect(redacted).toBe('https://mainnet.infura.io/v3/[REDACTED]');
      expect(redacted).not.toContain('INFURA_SECRET');
    });

    it('leaves public URLs intact', () => {
      const redacted = __test.redactUrl('https://ethereum-rpc.publicnode.com');
      expect(redacted).toBe('https://ethereum-rpc.publicnode.com/');
    });
  });

  describe('chain support (C2)', () => {
    it('resolves upstream URLs for REST chains (Stellar)', () => {
      expect(__test.isChainSupported('stellar')).toBe(true);
      expect(__test.isChainSupported('stellar-testnet')).toBe(true);
    });

    it('rejects unknown chains and removed Aptos', () => {
      expect(__test.isChainSupported('dogechain')).toBe(false);
      expect(__test.isChainSupported('aptos')).toBe(false);
    });
  });

  describe('SEC-004 complexity caps', () => {
    it('rejects oversized JSON-RPC batches', () => {
      const batch = Array.from({ length: __test.MAX_BATCH_SIZE + 1 }, (_, i) => ({
        jsonrpc: '2.0',
        id: i,
        method: 'eth_blockNumber',
        params: [],
      }));
      const check = __test.checkRequestComplexity(batch);
      expect(check.ok).toBe(false);
      expect(check.code).toBe('RPC_BATCH_TOO_LARGE');
    });

    it('rejects eth_getLogs with oversized block range', () => {
      const from = 0;
      const to = __test.MAX_ETH_GETLOGS_BLOCK_RANGE + 1;
      const check = __test.checkRequestComplexity({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [
          {
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${to.toString(16)}`,
          },
        ],
      });
      expect(check.ok).toBe(false);
      expect(check.code).toBe('RPC_LOGS_RANGE_TOO_LARGE');
    });

    it('allows a normal eth_getBalance call', () => {
      const check = __test.checkRequestComplexity({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: ['0x0', 'latest'],
      });
      expect(check.ok).toBe(true);
    });
  });
});
