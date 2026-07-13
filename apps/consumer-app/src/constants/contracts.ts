/**
 * VeilPay — Deployed Contract Addresses (Sepolia)
 *
 * App-local copy of the Foundry deployment manifest lives at
 * `src/constants/deployments/sepolia.json` so Metro/EAS never need a monorepo
 * relative path into `packages/contracts-evm` (EAS archives can omit that tree).
 *
 * Upstream authoring path remains:
 *   packages/contracts-evm/deployments/sepolia.json
 * written by `packages/contracts-evm/script/DeployPrivacyStack.s.sol`.
 * After a fresh deploy, copy that file into this app constants folder and rebuild.
 *
 * Placeholder values are the zero address (`0x000…000`); a build with unfilled
 * placeholders MUST behave as "privacy stack not configured".
 * {@link isPrivacyStackConfigured} is consumed by:
 *
 *   - `PrivacyLevelScreen` — disable `'stealth'` / `'max'` when unconfigured
 *   - `usePaymentTransaction` — fail fast instead of sending to zero address
 *
 * @see ./deployments/sepolia.json
 * @see packages/contracts-evm/script/DeployPrivacyStack.s.sol
 * @see Requirements 5.5, 5.6, 13.1, 13.2, 13.3
 */

import sepolia from './deployments/sepolia.json';

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

/**
 * DATA-002 release gate: whether the EVM max-privacy WITHDRAW path is wired
 * end-to-end in this build.
 *
 * The deposit half of the max-privacy flow has always worked — the app
 * generates a commitment, calls `VeilPool.deposit`, and stores a
 * `CommitmentRecord` in SecureStore. The WITHDRAW half is NOT yet wired:
 * `CommitmentRecord` does not carry the Merkle path (`pathElements`,
 * `pathIndices`) or the precomputed `nullifierHash`, and `usePaymentTransaction`
 * throws `"not yet implemented"` when the user tries to spend a max deposit.
 *
 * Exposing the deposit path while withdraw is unavailable lets users lock
 * funds they can never recover from the app. This flag MUST stay `false` until:
 *   - deposit-time Merkle path capture lands in `CommitmentRecord`;
 *   - Poseidon `nullifierHash` derivation ships in the prover;
 *   - the relayer withdraw request round-trips on testnet;
 *   - a deposit → app restart → prove → relayer withdraw → mark-spent e2e
 *     test passes.
 *
 * Flip to `true` only after that e2e gate passes, and keep the test in the
 * P1/TEST-001 suite so a regression re-disables the path.
 */
export const EVM_MAX_PRIVACY_WITHDRAW_READY = false;
