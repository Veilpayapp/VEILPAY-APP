import { promises as dns } from 'dns';
import type { LookupAddress } from 'dns';
import { isIP } from 'net';
import { config } from '../config';

/**
 * SEC-002 fix: SSRF guard for merchant-controlled webhook URLs.
 *
 * A merchant can set any URL as their webhook target. Without validation,
 * `fetch(url)` in `deliverWebhook` lets a merchant probe the backend's
 * internal network (localhost admin surfaces, cloud metadata at
 * 169.254.169.254, private RFC1918 ranges, etc.) and exfiltrate response
 * snippets via stored error messages.
 *
 * This module validates that a webhook URL:
 *   - uses http or https only (https required in production);
 *   - does not point at a blocked hostname (localhost, metadata, etc.);
 *   - does not resolve (via DNS) to a private, reserved, or link-local IP.
 *
 * DNS rebinding mitigation: this module resolves DNS once and returns the
 * resolved IP. The caller (deliverWebhook) MUST pin the HTTP request to
 * that IP via a custom agent `lookup` so the connection does not re-resolve
 * DNS at fetch time. Without that pinning, an attacker-controlled
 * nameserver can return a public IP for the validation lookup and a
 * private IP for the fetch lookup (the DNS-rebinding TOCTOU).
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * Result of a successful webhook URL safety check. The `resolvedAddress` is
 * the single IP the caller MUST use for the actual fetch — it pins the
 * connection so a DNS rebinding attack between validation and fetch cannot
 * redirect to a private IP.
 */
export interface SafeWebhookUrl {
  /** The original validated URL (scheme + hostname + path + query). */
  url: string;
  /**
   * The resolved IP address that passed the private/loopback check. The
   * caller pins the fetch connection to this IP via a custom agent `lookup`
   * so `fetch`/`https.request` does NOT re-resolve DNS (closing the
   * DNS-rebinding TOCTOU).
   */
  resolvedAddress: string;
  /** 4 for IPv4, 6 for IPv6. */
  family: 4 | 6;
}

interface IpChecker {
  name: string;
  test: (octets: number[]) => boolean;
}

const PRIVATE_IPV4_PATTERNS: IpChecker[] = [
  { name: 'loopback', test: (o) => o[0] === 127 },
  { name: 'unspecified', test: (o) => o[0] === 0 },
  { name: 'private-10', test: (o) => o[0] === 10 },
  { name: 'private-172', test: (o) => o[0] === 172 && o[1] >= 16 && o[1] <= 31 },
  { name: 'private-192', test: (o) => o[0] === 192 && o[1] === 168 },
  // 169.254.0.0/16 link-local — includes AWS/GCP/Azure metadata at 169.254.169.254
  { name: 'link-local', test: (o) => o[0] === 169 && o[1] === 254 },
  // 100.64.0.0/10 CGNAT
  { name: 'cgnat', test: (o) => o[0] === 100 && o[1] >= 64 && o[1] <= 127 },
  // 198.18.0.0/15 benchmarking
  { name: 'benchmark', test: (o) => o[0] === 198 && o[1] >= 18 && o[1] <= 19 },
  // 240.0.0.0/4 reserved
  { name: 'reserved', test: (o) => o[0] >= 240 },
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  return PRIVATE_IPV4_PATTERNS.some((p) => p.test(parts));
}

/**
 * Extract an embedded IPv4 address from an IPv4-mapped or IPv4-compatible
 * IPv6 literal, handling all three forms Node's URL parser produces:
 *   - dotted decimal: `::ffff:127.0.0.1` / `::192.168.0.1`
 *   - hex hextets:    `::ffff:7f00:1`    / `::c0a8:1`     (Node normalizes the above to this)
 * Returns the IPv4 string (e.g. `127.0.0.1`) or `null` if the address has
 * no embedded IPv4.
 *
 * Without both forms, the IPv6 literal `::ffff:127.0.0.1` reaches the SSRF
 * guard with the dots stripped — `isPrivateIPv6` sees `::ffff:7f00:1` and
 * the dotted-decimal-only regex misses it, so the guard returns success and
 * `fetch` connects to loopback. The same path bypasses the cloud metadata
 * IP at `::ffff:169.254.169.254` (normalized to `::ffff:a9fe:a9fe`).
 */
function extractEmbeddedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');

  // Form: ::ffff:a.b.c.d or ::a.b.c.d (dotted decimal IPv4 tail)
  const dotted = lower.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];

  // Form: ::ffff:HHHH:HHHH (hex hextets — Node's normalized output for
  // ::ffff:127.0.0.1 → ::ffff:7f00:1, ::ffff:169.254.169.254 → ::ffff:a9fe:a9fe)
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  // Form: ::HHHH:HHHH (deprecated IPv4-compatible)
  const compat = lower.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (compat) {
    const hi = parseInt(compat[1], 16);
    const lo = parseInt(compat[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  return null;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  // IPv4-mapped (`::ffff:a.b.c.d` and the hex-normalized form
  // `::ffff:HHHH:HHHH` that Node's URL parser produces) and IPv4-compatible
  // (`::a.b.c.d` / `::HHHH:HHHH`). Extract the embedded IPv4 and check it
  // with the IPv4 rules. Without this, `https://[::ffff:127.0.0.1]/` (which
  // Node normalizes to `https://[::ffff:7f00:1]/`) and
  // `https://[::ffff:169.254.169.254]/` (→ `::ffff:a9fe:a9fe`, the AWS/GCP
  // metadata IP) bypass the SSRF guard.
  const mapped = extractEmbeddedIPv4(lower);
  if (mapped) {
    return isPrivateIPv4(mapped);
  }
  return false;
}

function isPrivateIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
]);

/**
 * Validate that `rawUrl` is safe for the backend to fetch as a webhook
 * target, and return the resolved IP the caller MUST pin for the actual
 * fetch. Throws `UnsafeUrlError` if the URL is malformed, uses a non-https
 * scheme in production, points at localhost / a private / reserved /
 * link-local IP, or resolves via DNS to a blocked address.
 *
 * The returned `resolvedAddress` MUST be used to pin the fetch connection
 * (via `http(s).Agent` `lookup`) so the connection does not re-resolve
 * DNS — that re-resolution is the DNS-rebinding TOCTOU vector.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<SafeWebhookUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('Invalid webhook URL');
  }

  // Reject non-http(s) schemes first — file:, ftp:, gopher: etc. are never
  // allowed as webhook targets, regardless of environment.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UnsafeUrlError(
      `Webhook URL scheme '${parsed.protocol.replace(':', '')}' is not allowed`
    );
  }

  // In production, require https. http is only permitted in dev/test so a
  // local merchant can point at a localhost dev receiver for testing.
  const isProduction = config.nodeEnv === 'production';
  if (isProduction && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError('Webhook URL must use https in production');
  }

  // Strip IPv6 brackets for hostname comparison.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError(`Webhook hostname '${hostname}' is blocked`);
  }

  // If the hostname is already an IP literal, check it directly without DNS.
  if (isIP(hostname) !== 0) {
    if (isPrivateIP(hostname)) {
      throw new UnsafeUrlError('Webhook URL points at a private/reserved IP');
    }
    return {
      url: rawUrl,
      resolvedAddress: hostname,
      family: (isIP(hostname) === 6 ? 6 : 4) as 4 | 6,
    };
  }

  // Resolve DNS and check every resolved address. This catches hostnames
  // that resolve to internal IPs — the core SSRF vector.
  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve webhook hostname '${hostname}'`);
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Webhook hostname '${hostname}' resolved to no addresses`);
  }

  for (const addr of addresses) {
    if (isPrivateIP(addr.address)) {
      throw new UnsafeUrlError(
        `Webhook hostname '${hostname}' resolves to a private/reserved IP`
      );
    }
  }

  // Pin the first resolved address for the fetch connection. The caller
  // uses this IP via a custom agent `lookup` so `fetch` cannot re-resolve
  // to a different (potentially private) address at connection time.
  const first = addresses[0];
  return {
    url: rawUrl,
    resolvedAddress: first.address,
    family: (first.family === 6 ? 6 : 4) as 4 | 6,
  };
}

/**
 * Convenience wrapper for the merchant controllers (`registerMerchant` and
 * `updateMerchant`): validate a webhook URL, swallowing `UnsafeUrlError`
 * and rewriting it as a `400` response so the controllers do not duplicate
 * the try/catch error-mapping. Returns `true` when the URL is valid (or
 * when it is absent — undefined / null / empty string), `false` after it
 * has written the 400 response.
 *
 * Single source of truth for the SSRF-guard error contract — if the
 * rejection message ever changes (or we want to surface a structured
 * machine-readable code), only this helper needs to bump.
 */
export async function rejectUnsafeWebhookUrl(
  rawUrl: string | null | undefined,
  res: { status(value: number): { json(body: unknown): void } }
): Promise<boolean> {
  if (rawUrl === undefined || rawUrl === null || rawUrl === '') return true;
  try {
    await assertSafeWebhookUrl(rawUrl);
    return true;
  } catch (e) {
    if (e instanceof UnsafeUrlError) {
      res.status(400).json({ error: e.message });
      return false;
    }
    throw e;
  }
}
