import { Router, Request, Response, NextFunction } from 'express';
import { getRpcUrl } from '../lib/rpcEndpoints';

const router = Router();

// ─── Upstream configuration ────────────────────────────────────────────────
// Provider priority: Alchemy → Infura → public fallback (read-only).
// Keys are never sent to the client; the proxy injects them server-side.
// Resolution lives in lib/rpcEndpoints (shared with paymentTxVerifier).

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

/** SEC-004: hard caps on batch size, eth_getLogs range, and response body. */
const MAX_BATCH_SIZE = 10;
const MAX_ETH_GETLOGS_BLOCK_RANGE = 2_000;
const MAX_ETH_GETLOGS_ADDRESSES = 20;
const MAX_RESPONSE_BYTES = 1_500_000; // ~1.5 MB

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

function parseBlockTag(tag: unknown): number | null {
  if (typeof tag !== 'string') return null;
  if (tag === 'latest' || tag === 'pending' || tag === 'earliest' || tag === 'safe' || tag === 'finalized') {
    return null; // non-numeric tags — range check skipped for that bound
  }
  if (!/^0x[0-9a-fA-F]+$/.test(tag)) return null;
  try {
    return parseInt(tag, 16);
  } catch {
    return null;
  }
}

/**
 * SEC-004 complexity guard: batch length, eth_getLogs block range + address count.
 */
function checkRequestComplexity(body: unknown): { ok: boolean; error?: string; code?: string } {
  if (Array.isArray(body)) {
    if (body.length > MAX_BATCH_SIZE) {
      return {
        ok: false,
        error: `JSON-RPC batch exceeds max size of ${MAX_BATCH_SIZE}`,
        code: 'RPC_BATCH_TOO_LARGE',
      };
    }
    for (const item of body) {
      const check = checkSingleCallComplexity(item);
      if (!check.ok) return check;
    }
    return { ok: true };
  }
  return checkSingleCallComplexity(body);
}

function checkSingleCallComplexity(call: unknown): { ok: boolean; error?: string; code?: string } {
  if (!call || typeof call !== 'object' || !('method' in call)) return { ok: true };
  const method = (call as { method?: unknown }).method;
  const params = (call as { params?: unknown }).params;

  if (method === 'eth_getLogs' && Array.isArray(params) && params[0] && typeof params[0] === 'object') {
    const filter = params[0] as { fromBlock?: unknown; toBlock?: unknown; address?: unknown };
    const from = parseBlockTag(filter.fromBlock);
    const to = parseBlockTag(filter.toBlock);
    if (from !== null && to !== null && to - from > MAX_ETH_GETLOGS_BLOCK_RANGE) {
      return {
        ok: false,
        error: `eth_getLogs block range exceeds max of ${MAX_ETH_GETLOGS_BLOCK_RANGE}`,
        code: 'RPC_LOGS_RANGE_TOO_LARGE',
      };
    }
    if (Array.isArray(filter.address) && filter.address.length > MAX_ETH_GETLOGS_ADDRESSES) {
      return {
        ok: false,
        error: `eth_getLogs address filter exceeds max of ${MAX_ETH_GETLOGS_ADDRESSES}`,
        code: 'RPC_LOGS_TOO_MANY_ADDRESSES',
      };
    }
  }
  return { ok: true };
}

function truncateResponseBody(body: unknown): { body: unknown; truncated: boolean } {
  try {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    if (raw.length <= MAX_RESPONSE_BYTES) {
      return { body, truncated: false };
    }
    return {
      body: {
        error: 'Upstream RPC response exceeded size limit',
        code: 'RPC_RESPONSE_TOO_LARGE',
        maxBytes: MAX_RESPONSE_BYTES,
      },
      truncated: true,
    };
  } catch {
    return { body, truncated: false };
  }
}

// Exported for unit testing of the allowlist logic.
export const __test = {
  checkMethodAllowlist,
  extractMethods,
  redactUrl,
  isChainSupported: (k: string): boolean => !!getRpcUrl(k),
  checkRequestComplexity,
  MAX_BATCH_SIZE,
  MAX_ETH_GETLOGS_BLOCK_RANGE,
  MAX_RESPONSE_BYTES,
};

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
) => Promise<unknown>;

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

  // SEC-004: complexity caps (batch size, eth_getLogs range/addresses).
  const complexity = checkRequestComplexity(req.body);
  if (!complexity.ok) {
    return res.status(400).json({
      error: complexity.error,
      code: complexity.code,
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

    const { body: safeBody, truncated } = truncateResponseBody(result.body);
    if (truncated) {
      return res.status(502).json(safeBody);
    }

    if (typeof safeBody === 'string') {
      return res.status(result.status).type(result.contentType || 'text/plain').send(safeBody);
    }
    return res.status(result.status).json(safeBody);
  } catch (error) {
    return handleUpstreamError(error, chainKey, res);
  }
}));

// REST GET passthrough — used by Stellar (`/accounts/...`) which exposes
// an HTTP REST API rather than JSON-RPC.
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
