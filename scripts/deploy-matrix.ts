#!/usr/bin/env node
/**
 * VeilPay Multi-Chain Deployment Health Check
 *
 * Validates that all configured RPC endpoints are live and responding correctly.
 * Run this before any deployment to catch misconfigured or down endpoints.
 *
 * Usage:
 *   npx ts-node scripts/deploy-matrix.ts
 *   node scripts/deploy-matrix.js   (after compilation)
 *
 * Exit codes:
 *   0  — All chains healthy (or passed threshold)
 *   1  — One or more critical chains failing
 */

import * as https from 'https';
import * as http from 'http';

// ─── Chain Matrix ──────────────────────────────────────────────────────────────

interface ChainSpec {
  key: string;
  name: string;
  chainId: number;
  tier: 'critical' | 'standard' | 'testnet';
  rpcEnvVar: string;
  fallbackUrl: string;
  explorerUrl: string;
}

const CHAIN_MATRIX: ChainSpec[] = [
  // ── L1 ───────────────────────────────────────────────────────────────────────
  {
    key: 'ethereum',
    name: 'Ethereum Mainnet',
    chainId: 1,
    tier: 'critical',
    rpcEnvVar: 'EXPO_PUBLIC_RPC_ETHEREUM',
    fallbackUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
  },

  // ── L2 Rollups ───────────────────────────────────────────────────────────────
  {
    key: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42161,
    tier: 'critical',
    rpcEnvVar: 'EXPO_PUBLIC_RPC_ARBITRUM',
    fallbackUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
  },
  {
    key: 'base',
    name: 'Base',
    chainId: 8453,
    tier: 'critical',
    rpcEnvVar: 'EXPO_PUBLIC_RPC_BASE',
    fallbackUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
  },
  {
    key: 'polygon',
    name: 'Polygon PoS',
    chainId: 137,
    tier: 'standard',
    rpcEnvVar: 'EXPO_PUBLIC_RPC_POLYGON',
    fallbackUrl: 'https://polygon.llamarpc.com',
    explorerUrl: 'https://polygonscan.com',
  },

  // ── Alt L1s ──────────────────────────────────────────────────────────────────
  {
    key: 'bsc',
    name: 'BNB Smart Chain',
    chainId: 56,
    tier: 'standard',
    rpcEnvVar: 'EXPO_PUBLIC_RPC_BSC',
    fallbackUrl: 'https://binance.llamarpc.com',
    explorerUrl: 'https://bscscan.com',
  },

  // ── Testnets ─────────────────────────────────────────────────────────────────
  {
    key: 'sepolia',
    name: 'Sepolia Testnet',
    chainId: 11155111,
    tier: 'testnet',
    rpcEnvVar: 'EXPO_PUBLIC_RPC_SEPOLIA',
    fallbackUrl: 'https://rpc.sepolia.org',
    explorerUrl: 'https://sepolia.etherscan.io',
  },
];

// ─── RPC Probe ────────────────────────────────────────────────────────────────

interface ProbeResult {
  chain: ChainSpec;
  url: string;
  ok: boolean;
  reportedChainId: number | null;
  chainIdMatch: boolean;
  latencyMs: number;
  error: string | null;
}

const TIMEOUT_MS = 8000;

function resolveRpcUrl(chain: ChainSpec): string {
  const envVal = process.env[chain.rpcEnvVar];
  if (envVal && envVal.trim()) return envVal.trim();

  const alchemyKey = process.env.EXPO_PUBLIC_ALCHEMY_API_KEY?.trim();
  if (alchemyKey) {
    const alchemySlugs: Record<string, string> = {
      ethereum: 'eth-mainnet',
      arbitrum: 'arb-mainnet',
      base: 'base-mainnet',
      polygon: 'polygon-mainnet',
      sepolia: 'eth-sepolia',
    };
    const slug = alchemySlugs[chain.key];
    if (slug) return `https://${slug}.g.alchemy.com/v2/${alchemyKey}`;
  }

  return chain.fallbackUrl;
}

async function probeChain(chain: ChainSpec): Promise<ProbeResult> {
  const url = resolveRpcUrl(chain);
  const start = Date.now();

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_chainId',
    params: [],
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        chain,
        url,
        ok: false,
        reportedChainId: null,
        chainIdMatch: false,
        latencyMs: TIMEOUT_MS,
        error: `Timeout after ${TIMEOUT_MS}ms`,
      });
    }, TIMEOUT_MS);

    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          clearTimeout(timeout);
          const latencyMs = Date.now() - start;

          try {
            const parsed = JSON.parse(data) as { result?: string; error?: { message?: string } };
            const reportedChainId = parsed.result ? parseInt(parsed.result, 16) : null;
            const chainIdMatch = reportedChainId === chain.chainId;

            resolve({
              chain,
              url,
              ok: res.statusCode === 200 && !parsed.error,
              reportedChainId,
              chainIdMatch,
              latencyMs,
              error: parsed.error?.message ?? null,
            });
          } catch {
            resolve({ chain, url, ok: false, reportedChainId: null, chainIdMatch: false, latencyMs, error: 'Invalid JSON response' });
          }
        });
      }
    );

    req.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        chain,
        url,
        ok: false,
        reportedChainId: null,
        chainIdMatch: false,
        latencyMs: Date.now() - start,
        error: err.message,
      });
    });

    req.write(body);
    req.end();
  });
}

// ─── Reporter ─────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function pad(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function printResult(r: ProbeResult): void {
  const status = r.ok && r.chainIdMatch
    ? `${GREEN}✓ HEALTHY${RESET}`
    : r.ok && !r.chainIdMatch
    ? `${YELLOW}⚠ CHAIN ID MISMATCH${RESET}`
    : `${RED}✗ FAIL${RESET}`;

  const tier = r.chain.tier === 'critical'
    ? `${RED}CRITICAL${RESET}`
    : r.chain.tier === 'standard'
    ? `${CYAN}STANDARD${RESET}`
    : `${DIM}TESTNET${RESET}`;

  const latency = r.latencyMs < 500
    ? `${GREEN}${r.latencyMs}ms${RESET}`
    : r.latencyMs < 2000
    ? `${YELLOW}${r.latencyMs}ms${RESET}`
    : `${RED}${r.latencyMs}ms${RESET}`;

  console.log(
    `  ${pad(r.chain.name, 22)} ${status}  ${pad(tier, 20)}  ${latency}` +
    (r.chainIdMatch ? '' : r.reportedChainId ? `  ${RED}(got chainId ${r.reportedChainId}, expected ${r.chain.chainId})${RESET}` : '') +
    (r.error ? `  ${DIM}${r.error}${RESET}` : '')
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${BOLD}VeilPay Multi-Chain Deployment Matrix${RESET}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`${DIM}Probing ${CHAIN_MATRIX.length} chains...${RESET}\n`);

  const results = await Promise.all(CHAIN_MATRIX.map(probeChain));

  const critical  = results.filter(r => r.chain.tier === 'critical');
  const standard  = results.filter(r => r.chain.tier === 'standard');
  const testnets  = results.filter(r => r.chain.tier === 'testnet');

  console.log(`${BOLD}L1 + L2 Critical Chains${RESET}`);
  critical.forEach(printResult);

  console.log(`\n${BOLD}Standard Chains${RESET}`);
  standard.forEach(printResult);

  console.log(`\n${BOLD}Testnets${RESET}`);
  testnets.forEach(printResult);

  // Summary
  const allOk = (r: ProbeResult) => r.ok && r.chainIdMatch;
  const criticalFailing = critical.filter(r => !allOk(r));
  const totalFailing = results.filter(r => !allOk(r));

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`${BOLD}Summary${RESET}`);
  console.log(`  Total chains:    ${results.length}`);
  console.log(`  Healthy:         ${GREEN}${results.filter(allOk).length}${RESET}`);
  console.log(`  Failing:         ${totalFailing.length > 0 ? RED : GREEN}${totalFailing.length}${RESET}`);
  console.log(`  Critical fail:   ${criticalFailing.length > 0 ? RED : GREEN}${criticalFailing.length}${RESET}`);

  if (criticalFailing.length > 0) {
    console.log(`\n${RED}${BOLD}⛔ DEPLOY BLOCKED — Critical chains are down:${RESET}`);
    criticalFailing.forEach(r => console.log(`  ${RED}✗ ${r.chain.name} — ${r.error ?? 'chain ID mismatch'}${RESET}`));
    process.exit(1);
  }

  if (totalFailing.length > 0) {
    console.log(`\n${YELLOW}${BOLD}⚠ WARNING — Non-critical chains are degraded. Proceed with caution.${RESET}`);
    process.exit(0);
  }

  console.log(`\n${GREEN}${BOLD}✅ All chains healthy. Safe to deploy.${RESET}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('deploy-matrix fatal error:', err);
  process.exit(1);
});
