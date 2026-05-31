/**
 * VeilPay — Deployed Contract Addresses (Sepolia)
 *
 * Single source of truth for the on-chain privacy-stack contract addresses
 * that the mobile app talks to. Addresses are sourced from
 * `packages/contracts-evm/deployments/sepolia.json`, which is the
 * deployment manifest written by the Foundry deploy script
 * (`packages/contracts-evm/script/DeployPrivacyStack.s.sol`). When a fresh
 * deployment lands, that JSON file is overwritten and a rebuild of the app
 * picks up the new addresses statically — there is no runtime fetch.
 *
 * The placeholder values committed to the JSON are the zero address
 * (`0x000…000`); a build with the unfilled placeholders MUST behave as
 * "privacy stack not configured" so we don't silently send funds to the
 * zero address. {@link isPrivacyStackConfigured} provides that gate, and is
 * consumed by:
 *
 *   - `PrivacyLevelScreen` — to render `'stealth'` and `'max'` rows as
 *     disabled with a "not configured on this network" explanation.
 *   - `usePaymentTransaction` — to fail fast at flow start with a
 *     configuration-error toast instead of attempting a transaction.
 *
 * @see ../../../../packages/contracts-evm/deployments/sepolia.json
 * @see ../../../../packages/contracts-evm/script/DeployPrivacyStack.s.sol
 * @see Requirements 5.5, 5.6, 13.1, 13.2, 13.3
 */

import sepolia from '../../../../packages/contracts-evm/deployments/sepolia.json';

/**
 * Address of the `VeilPool` shielded-pool contract on Sepolia.
 * Sourced from `sepolia.veilPool` at bundle time.
 */
export const VEIL_POOL_ADDRESS: string = sepolia.veilPool;

/**
 * Address of the `StealthAnnouncer` event-emitter contract on Sepolia,
 * used to publish stealth-payment announcements (ephemeral pubkey + view
 * tag) so recipients can scan and claim.
 * Sourced from `sepolia.stealthAnnouncer` at bundle time.
 */
export const STEALTH_ANNOUNCER_ADDRESS: string = sepolia.stealthAnnouncer;

/**
 * Address of the Groth16 on-chain verifier contract on Sepolia, called by
 * `VeilPool.withdraw()` to verify the zk-SNARK proof produced by the
 * mobile WebView prover.
 * Sourced from `sepolia.groth16Verifier` at bundle time.
 */
export const GROTH16_VERIFIER_ADDRESS: string = sepolia.groth16Verifier;

/**
 * Numeric chain id for the Ethereum Sepolia testnet (`11155111`). Sourced
 * from `sepolia.chainId`. Useful for `useNetworkPrivacySupport` and any
 * wallet-network gating that needs the canonical id without re-importing
 * the JSON elsewhere.
 */
export const SEPOLIA_CHAIN_ID: number = sepolia.chainId;

/** The all-zero EVM address — never a valid deployment target. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Strict EVM address regex: `0x` followed by exactly 40 hex characters. */
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Returns true iff `s` is a syntactically valid EVM address AND not the
 * zero address. The zero-address check is case-insensitive (the canonical
 * placeholder is all lowercase, but we normalize defensively).
 */
function isAddr(s: string): boolean {
  return EVM_ADDRESS_RE.test(s) && s.toLowerCase() !== ZERO_ADDRESS;
}

/**
 * Returns true only when ALL THREE privacy-stack contract addresses
 * (`VEIL_POOL_ADDRESS`, `STEALTH_ANNOUNCER_ADDRESS`,
 * `GROTH16_VERIFIER_ADDRESS`) are syntactically valid EVM addresses and
 * non-zero.
 *
 * If any address is missing or still set to the zero-address placeholder
 * from `deployments/sepolia.json`, the privacy stack is treated as
 * unconfigured and `'stealth'` / `'max'` privacy levels MUST be disabled
 * by the UI and refused by the payment transaction hook.
 *
 * @returns `true` when the privacy stack is fully configured for use.
 */
export function isPrivacyStackConfigured(): boolean {
  return [
    VEIL_POOL_ADDRESS,
    STEALTH_ANNOUNCER_ADDRESS,
    GROTH16_VERIFIER_ADDRESS,
  ].every(isAddr);
}
