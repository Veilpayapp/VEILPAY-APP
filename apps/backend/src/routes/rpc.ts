import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config';

const router = Router();

// ─── Upstream configuration ────────────────────────────────────────────────
// Provider priority: Alchemy → Infura → public fallback (read-only).
// Keys are never sent to the client; the proxy injects them server-side.

const PUBLIC_FALLBACKS: Record<string, string> = {
  ethereum:       'https://ethereum-rpc.publicnode.com',
  bsc:            'https://bsc-dataseed.binance.org',
  polygon:        'https://polygon-rpc.com',
  arbitrum:       'https://arb1.arbitrum.io/rpc',
  base:           'https://mainnet.base.org',
  sepolia:        'https://rpc.sepolia.org',
  solana:         'https://api.mainnet-beta.solana.com',
  'solana-devnet': 'https://api.devnet.solana.com',
  aptos:          'https://fullnode.mainnet.aptoslabs.com',
  stellar:        'https://horizon.stellar.org',
  'stellar-testnet': 'https://horizon-testnet.stellar.org',
};

function buildAlchemyUrl(chainKey: string): string | null {
  const apiKey = config.rpc.alchemyApiKey?.trim();
  if (!apiKey) return null;

  const slugs: Record<string, string> = {
    ethereum:  'eth-mainnet',
    polygon:   'polygon-mainnet',
    arbitrum:  'arb-mainnet',
    base:      'base-mainnet',
    sepolia:   'eth-sepolia',
    solana:    'solana-mainnet',
    bsc:       'bnb-mainnet',
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
    polygon:  'polygon-mainnet',
    arbitrum: 'arbitrum-mainnet',
    base:     'base-mainnet',
    sepolia:  'sepolia',
  };

  const slug = slugs[chainKey];
  if (!slug) return null;

  return `https://${slug}.infura.io/v3/${apiKey}`;
}

function getRpcUrl(chainKey: string): string {
  const alchemyUrl = buildAlchemyUrl(chainKey);
  if (alchemyUrl) return alchemyUrl;

  const infuraUrl = buildInfuraUrl(chainKey);
  if (infuraUrl) return infuraUrl;

  return PUBLIC_FALLBACKS[chainKey] || '';
}

// ─── JSON-RPC method allowlist (S2) ────────────────────────────────────────
// Read-only methods only. Signing/admin/debug/trace methods are rejected so an
// attacker who discovers the endpoint cannot burn provider credits on
// expensive calls or attempt write operations through our key.

const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  // EVM — standard read
  'eth_getBalance', 'eth_call', 'eth_blockNumber', 'eth_chainId',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_getLogs', 'eth_getCode', 'eth_getStorageAt',
  'eth_gasPrice', 'eth_estimateGas', 'eth_getTransactionCount',
  'eth_feeHistory', 'eth_maxPriorityFeePerGas',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBlockReceipts',
  'eth_getBlockTransactionCountByNumber', 'eth_getBlockTransactionCountByHash',
  'eth_getUncleByBlockNumberAndIndex', 'eth_getUncleCountByBlockNumber',
  'net_version', 'net_listening', 'net_peerCount',
  'web3_clientVersion',
  // Alchemy-enhanced read
  'alchemy_getTokenBalances', 'alchemy_getTokenMetadata',
  'alchemy_getAssetTransfers', 'alchemy_getTokenAllowance',
  // Solana JSON-RPC read
  'getBalance', 'getTokenAccountsByOwner', 'getAccountInfo',
  'getSlot', 'getSlotLeader', 'getLatestBlockhash', 'getBlock',
  'getSignatureStatuses', 'getTransaction', 'getSignaturesForAddress',
  'getTokenAccountBalance', 'getEpochInfo', 'getHealth', 'getVersion',
  'getInflationGovernor', 'getInflationRate', 'getSupply',
  'getMinimumBalanceForRentExemption', 'getRecentPerformanceSamples',
]);

function extractMethods(body: unknown): string[] {
  if (Array.isArray(body)) {
    return body
      .map((item) => (item && typeof item === 'object' && 'method' in item ? (item as { method?: unknown }).method : undefined))
      .filter((m): m is string => typeof m === 'string');
  }
  if (body && typeof body === 'object' && 'method' in body) {
    const m = (body as { method?: unknown }).method;
    return typeof m === 'string' ? [m] : [];
  }
  return [];
}

function checkMethodAllowlist(body: unknown): { allowed: boolean; disallowed?: string[] } {
  const methods = extractMethods(body);
  if (methods.length === 0) {
    // Not a recognizable JSON-RPC envelope (e.g. raw REST body). Allow and rely
    // on the chain allowlist + upstream to reject malformed requests.
    return { allowed: true };
  }
  const disallowed = methods.filter((m) => !ALLOWED_RPC_METHODS.has(m));
  return disallowed.length > 0 ? { allowed: false, disallowed } : { allowed: true };
}

// Exported for unit testing of the allowlist logic.
export const __test = { checkMethodAllowlist, extractMethods, redactUrl, isChainSupported: (k: string) => !!getRpcUrl(k) };

// ─── Safe upstream fetch (S3 redaction, S4 timeout, S5 non-JSON, B7 headers) ──

const UPSTREAM_TIMEOUT_MS = 8_000;

interface UpstreamResult {
  status: number;
  body: unknown;
  contentType: string;
}

/** Strips embedded API keys (Alchemy `/v2/<key>`, Infura `/v3/<key>`) from a URL. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/(v2|v3)\/[A-Za-z0-9_-]+/i, '/$1/[REDACTED]');
    return parsed.origin + parsed.pathname;
  } catch {
    return '[invalid-url]';
  }
}

async function fetchUpstream(
  targetUrl: string,
  init: RequestInit,
  chainKey: string
): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      ...init,
      signal: controller.signal,
    });

    // B7: surface upstream throttling signals for ops visibility (server-side only).
    const retryAfter = response.headers.get('retry-after');
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (retryAfter || remaining !== null) {
      console.warn(
        `[RPC Proxy] Upstream throttling signal chain=${chainKey} retry-after=${retryAfter || 'none'} remaining=${remaining ?? 'n/a'} url=${redactUrl(targetUrl)}`
      );
    }

    const contentType = response.headers.get('content-type') || '';
    let body: unknown;
    if (contentType.includes('application/json')) {
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
    } else {
      body = await response.text();
    }

    return { status: response.status, body, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

function handleUpstreamError(error: unknown, chainKey: string, res: Response): Response {
  const name = error instanceof Error ? error.name : 'Unknown';
  // AbortError / TimeoutError → 504
  if (name === 'AbortError' || name === 'TimeoutError') {
    console.warn(`[RPC Proxy] Upstream timeout chain=${chainKey}`);
    return res.status(504).json({ error: 'Upstream RPC timeout' });
  }
  // S3: never log the raw error object — Node fetch errors can include the
  // request URL (and therefore the embedded API key). Log only a sanitized name.
  console.warn(`[RPC Proxy] Upstream fetch failed chain=${chainKey} error=${name}`);
  return res.status(502).json({ error: 'Bad Gateway: Failed to reach RPC provider' });
}

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

function asyncRoute(fn: AsyncHandler): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────

// JSON-RPC POST proxy — used by EVM (viem) and Solana JSON-RPC clients.
router.post('/:chainKey', asyncRoute(async (req: Request, res: Response) => {
  const { chainKey } = req.params;

  const targetUrl = getRpcUrl(chainKey);
  if (!targetUrl) {
    return res.status(400).json({ error: `Unsupported or unconfigured chain: ${chainKey}` });
  }

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON-RPC envelope' });
  }

  const methodCheck = checkMethodAllowlist(req.body);
  if (!methodCheck.allowed) {
    return res.status(403).json({
      error: 'RPC method not allowed',
      code: 'RPC_METHOD_FORBIDDEN',
      disallowed: methodCheck.disallowed,
    });
  }

  try {
    const result = await fetchUpstream(
      targetUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      },
      chainKey
    );

    if (typeof result.body === 'string') {
      return res.status(result.status).type(result.contentType || 'text/plain').send(result.body);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    return handleUpstreamError(error, chainKey, res);
  }
}));

// REST GET passthrough — used by Aptos (`/v1/accounts/...`) and Stellar
// (`/accounts/...`) which expose HTTP REST APIs rather than JSON-RPC. (C2 fix)
router.get('/:chainKey/*', asyncRoute(async (req: Request, res: Response) => {
  const { chainKey } = req.params;
  const subPath: string = req.params[0] || '';

  // Reject path traversal attempts.
  if (subPath.includes('..') || subPath.includes('\0')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const targetUrl = getRpcUrl(chainKey);
  if (!targetUrl) {
    return res.status(400).json({ error: `Unsupported or unconfigured chain: ${chainKey}` });
  }

  const trimmedBase = targetUrl.replace(/\/+$/, '');
  let fullUrl: URL;
  try {
    fullUrl = new URL(`${trimmedBase}/${subPath}`);
  } catch {
    return res.status(400).json({ error: 'Invalid URL construction' });
  }

  // Ensure traversal did not escape the upstream origin.
  let baseOrigin: string;
  try {
    baseOrigin = new URL(targetUrl).origin;
  } catch {
    return res.status(400).json({ error: 'Invalid upstream base' });
  }
  if (fullUrl.origin !== baseOrigin) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  // Forward query string.
  if (Object.keys(req.query).length > 0) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (Array.isArray(v)) {
        v.forEach((x) => sp.append(k, String(x)));
      } else if (v !== undefined) {
        sp.append(k, String(v));
      }
    }
    fullUrl.search = sp.toString();
  }

  try {
    const result = await fetchUpstream(
      fullUrl.toString(),
      { method: 'GET', headers: { Accept: 'application/json' } },
      chainKey
    );

    if (typeof result.body === 'string') {
      return res.status(result.status).type(result.contentType || 'text/plain').send(result.body);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    return handleUpstreamError(error, chainKey, res);
  }
}));

export { router as rpcRoutes };
