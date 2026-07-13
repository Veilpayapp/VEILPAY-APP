/**
 * Chain-family validation for invoice `tokenAddress` (ERC-20 / SPL mint / Stellar issuer).
 */

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
/** Stellar account (G…) — ed25519 public StrKey, 56 chars. */
const STELLAR_G_RE = /^G[A-Z2-7]{55}$/;

const EVM_CHAINS = new Set([
  'ethereum',
  'sepolia',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'bsc',
]);
const SVM_CHAINS = new Set(['solana', 'solana-devnet']);
const XLM_CHAINS = new Set(['stellar', 'stellar-testnet']);

export type TokenAddressFamily = 'evm' | 'svm' | 'xlm' | 'unknown';

export function chainFamily(chainKey: string): TokenAddressFamily {
  const k = chainKey.trim().toLowerCase();
  if (EVM_CHAINS.has(k)) return 'evm';
  if (SVM_CHAINS.has(k)) return 'svm';
  if (XLM_CHAINS.has(k)) return 'xlm';
  return 'unknown';
}

export function isValidEvmTokenAddress(value: string): boolean {
  return EVM_RE.test(value.trim());
}

/** Solana mint / token account: base58, typically 32–44 chars. */
export function isValidSolanaMint(value: string): boolean {
  const v = value.trim();
  return v.length >= 32 && v.length <= 48 && BASE58_RE.test(v);
}

export function isValidStellarIssuer(value: string): boolean {
  return STELLAR_G_RE.test(value.trim().toUpperCase());
}

/**
 * Validate tokenAddress for the invoice chain. Empty is allowed (caller may
 * resolve from registry). Unknown chain keys accept any non-empty reasonable string.
 */
export function isValidTokenAddressForChain(
  chainKey: string,
  tokenAddress: string
): { ok: true } | { ok: false; error: string } {
  const v = tokenAddress.trim();
  if (!v) return { ok: false, error: 'tokenAddress must not be empty' };

  switch (chainFamily(chainKey)) {
    case 'evm':
      if (!isValidEvmTokenAddress(v)) {
        return {
          ok: false,
          error: 'tokenAddress must be a 20-byte 0x-prefixed EVM address on this chain',
        };
      }
      return { ok: true };
    case 'svm':
      if (!isValidSolanaMint(v)) {
        return {
          ok: false,
          error: 'tokenAddress must be a base58 Solana mint address on this chain',
        };
      }
      return { ok: true };
    case 'xlm':
      if (!isValidStellarIssuer(v)) {
        return {
          ok: false,
          error: 'tokenAddress must be a Stellar issuer account (G…) on this chain',
        };
      }
      return { ok: true };
    default:
      if (v.length > 100) {
        return { ok: false, error: 'tokenAddress is too long' };
      }
      return { ok: true };
  }
}
