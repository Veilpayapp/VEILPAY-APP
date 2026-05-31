#!/usr/bin/env node
/**
 * VeilPay Chain Config Validator
 *
 * Validates that all required environment variables are present and well-formed
 * before a build or deployment. Run this in CI before `eas build` or `npm run start`.
 *
 * Usage:
 *   npx ts-node scripts/chain-config-validator.ts
 *   node scripts/chain-config-validator.js
 *
 * Exit codes:
 *   0 — All required vars present and valid
 *   1 — Missing or malformed critical configuration
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = 'required' | 'recommended' | 'optional';

interface EnvVarSpec {
  key: string;
  description: string;
  severity: Severity;
  /** If provided, the value must match this regex */
  pattern?: RegExp;
  /** Human-readable format hint shown on failure */
  format?: string;
}

// ─── Variable Specs ───────────────────────────────────────────────────────────

const ENV_SPECS: EnvVarSpec[] = [
  // ── Backend Security ────────────────────────────────────────────────────────
  {
    key: 'JWT_SECRET',
    description: 'JWT signing secret for API authentication',
    severity: 'required',
    pattern: /^.{32,}$/,
    format: 'min 32 characters',
  },
  {
    key: 'WEBHOOK_SIGNING_SECRET',
    description: 'Webhook payload signature secret',
    severity: 'required',
    pattern: /^.{32,}$/,
    format: 'min 32 characters',
  },
  {
    key: 'API_KEY_SALT',
    description: 'Salt for API key hashing',
    severity: 'required',
    pattern: /^.{16,}$/,
    format: 'min 16 characters',
  },

  // ── RPC Provider Keys ───────────────────────────────────────────────────────
  {
    key: 'EXPO_PUBLIC_ALCHEMY_API_KEY',
    description: 'Alchemy API key (primary RPC provider)',
    severity: 'recommended',
    pattern: /^[a-zA-Z0-9_-]{20,}$/,
    format: 'alphanumeric, 20+ chars',
  },
  {
    key: 'EXPO_PUBLIC_INFURA_API_KEY',
    description: 'Infura API key (fallback RPC provider)',
    severity: 'optional',
    pattern: /^[a-f0-9]{32}$/,
    format: '32 hex chars',
  },

  // ── Chain-Specific RPC Overrides ────────────────────────────────────────────
  {
    key: 'EXPO_PUBLIC_RPC_ETHEREUM',
    description: 'Ethereum Mainnet RPC override',
    severity: 'optional',
    pattern: /^https?:\/\/.+/,
    format: 'https://...',
  },
  {
    key: 'EXPO_PUBLIC_RPC_ARBITRUM',
    description: 'Arbitrum One RPC override',
    severity: 'optional',
    pattern: /^https?:\/\/.+/,
    format: 'https://...',
  },
  {
    key: 'EXPO_PUBLIC_RPC_BASE',
    description: 'Base (Coinbase L2) RPC override — chainId 8453',
    severity: 'optional',
    pattern: /^https?:\/\/.+/,
    format: 'https://...',
  },
  {
    key: 'EXPO_PUBLIC_RPC_POLYGON',
    description: 'Polygon PoS RPC override',
    severity: 'optional',
    pattern: /^https?:\/\/.+/,
    format: 'https://...',
  },
  {
    key: 'EXPO_PUBLIC_RPC_SEPOLIA',
    description: 'Sepolia Testnet RPC override',
    severity: 'optional',
    pattern: /^https?:\/\/.+/,
    format: 'https://...',
  },

  // ── WalletConnect ───────────────────────────────────────────────────────────
  {
    key: 'EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID',
    description: 'WalletConnect Cloud project ID',
    severity: 'recommended',
    pattern: /^[a-f0-9]{32}$/,
    format: '32 hex chars — get from cloud.walletconnect.com',
  },

  // ── Feature Flags ───────────────────────────────────────────────────────────
  {
    key: 'EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS',
    description: 'Enable live mainnet transactions (set false until audited)',
    severity: 'required',
    pattern: /^(true|false)$/,
    format: '"true" or "false"',
  },
];

// ─── Validator ────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';

function pad(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

interface ValidationResult {
  spec: EnvVarSpec;
  present: boolean;
  valid: boolean;
  value: string | undefined;
  issue: string | null;
}

function validate(spec: EnvVarSpec): ValidationResult {
  const value = process.env[spec.key];
  const present = value !== undefined && value.trim() !== '';

  if (!present) {
    return {
      spec,
      present: false,
      valid: false,
      value: undefined,
      issue: 'Not set',
    };
  }

  if (spec.pattern && !spec.pattern.test(value!.trim())) {
    return {
      spec,
      present: true,
      valid: false,
      value: '***',
      issue: `Invalid format. Expected: ${spec.format ?? spec.pattern.toString()}`,
    };
  }

  return {
    spec,
    present: true,
    valid: true,
    value: '***',
    issue: null,
  };
}

function printResult(r: ValidationResult): void {
  const sev = r.spec.severity === 'required'
    ? `${RED}REQUIRED${RESET}`
    : r.spec.severity === 'recommended'
    ? `${YELLOW}RECOMMEND${RESET}`
    : `${DIM}OPTIONAL ${RESET}`;

  const status = r.valid
    ? `${GREEN}✓${RESET}`
    : r.present
    ? `${YELLOW}⚠${RESET}`
    : r.spec.severity === 'required'
    ? `${RED}✗${RESET}`
    : `${YELLOW}-${RESET}`;

  console.log(
    `  ${status}  ${sev}  ${pad(r.spec.key, 42)}  ${DIM}${r.spec.description}${RESET}` +
    (r.issue ? `\n       ${RED}→ ${r.issue}${RESET}` : '')
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(`\n${BOLD}VeilPay Chain Config Validator${RESET}`);
  console.log(`${'─'.repeat(80)}`);

  // Load .env if running locally (optional — dotenv may not be installed)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config({ path: '../.env' });
    require('dotenv').config({ path: '.env.local' });
  } catch {
    // dotenv not available — env vars must come from the shell
  }

  const results = ENV_SPECS.map(validate);

  const required    = results.filter(r => r.spec.severity === 'required');
  const recommended = results.filter(r => r.spec.severity === 'recommended');
  const optional    = results.filter(r => r.spec.severity === 'optional');

  console.log(`\n${BOLD}Required Variables${RESET}`);
  required.forEach(printResult);

  console.log(`\n${BOLD}Recommended Variables${RESET}`);
  recommended.forEach(printResult);

  console.log(`\n${BOLD}Optional Overrides${RESET}`);
  optional.forEach(printResult);

  // Summary
  const requiredFailing = required.filter(r => !r.valid);
  const recommendedMissing = recommended.filter(r => !r.present);
  const allValid = results.filter(r => r.valid);

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`${BOLD}Summary${RESET}`);
  console.log(`  Total vars checked:  ${results.length}`);
  console.log(`  Valid:               ${GREEN}${allValid.length}${RESET}`);
  console.log(`  Required failing:    ${requiredFailing.length > 0 ? RED : GREEN}${requiredFailing.length}${RESET}`);
  console.log(`  Recommended missing: ${recommendedMissing.length > 0 ? YELLOW : GREEN}${recommendedMissing.length}${RESET}`);

  if (requiredFailing.length > 0) {
    console.log(`\n${RED}${BOLD}⛔ CONFIG INVALID — Fix required variables before building:${RESET}`);
    requiredFailing.forEach(r => {
      console.log(`  ${RED}✗ ${r.spec.key}  →  ${r.issue}${RESET}`);
    });
    process.exit(1);
  }

  if (recommendedMissing.length > 0) {
    console.log(`\n${YELLOW}${BOLD}⚠ WARNING — Recommended vars missing (app will use public fallback RPCs):${RESET}`);
    recommendedMissing.forEach(r => {
      console.log(`  ${YELLOW}- ${r.spec.key}  →  ${r.spec.description}${RESET}`);
    });
  }

  console.log(`\n${GREEN}${BOLD}✅ Config valid. Safe to build.${RESET}\n`);
  process.exit(0);
}

main();
