/**
 * VeilPay — Network privacy-stack support gate
 *
 * Returns whether the active wallet chain supports the four-layer privacy
 * stack (`'stealth'` and `'max'` privacy levels). The stack is only deployed
 * on Ethereum Sepolia and only usable when all three contract addresses in
 * `deployments/sepolia.json` resolve to non-zero EVM addresses.
 *
 * This hook is consumed by:
 *   - `PrivacyLevelScreen` — to render `'stealth'` and `'max'` rows as
 *     disabled with the explanatory message when unsupported.
 *   - `usePaymentTransaction` — to fail fast at flow start when the user
 *     somehow reaches confirmation with an unsupported chain selected.
 *
 * @see ../constants/contracts.ts (`isPrivacyStackConfigured`, `SEPOLIA_CHAIN_ID`)
 * @see Requirements 13.4
 */

import { useMemo } from 'react';
import { useActiveChain } from '../stores/walletStore';
import { isPrivacyStackConfigured, SEPOLIA_CHAIN_ID } from '../constants/contracts';

/**
 * Result of the privacy-support gate.
 *
 * - `supported: true` — the active chain is Sepolia AND all three privacy
 *   contracts resolve to valid non-zero addresses. Stealth and max levels
 *   may be selected.
 * - `supported: false` — at least one of those is not true. `reason` carries
 *   a human-readable explanation suitable for rendering on a disabled UI row.
 */
export interface NetworkPrivacySupport {
  supported: boolean;
  reason?: string;
}

/**
 * React hook that derives `NetworkPrivacySupport` from the currently active
 * wallet chain and the bundled deployment manifest.
 *
 * The result is memoized on the `(chainId, configured)` tuple so referential
 * stability holds across renders that don't change either input — important
 * for `PrivacyLevelScreen`'s pre-selection-clamp `useMemo`/`useEffect`.
 */
export function useNetworkPrivacySupport(): NetworkPrivacySupport {
  const activeChain = useActiveChain();
  const chainId = activeChain?.id;

  return useMemo<NetworkPrivacySupport>(() => {
    if (chainId !== SEPOLIA_CHAIN_ID) {
      // Wording mirrors Requirement 13.4 verbatim so UI copy and the hook
      // contract stay aligned without translation drift.
      return {
        supported: false,
        reason: 'Privacy pool not available on this network',
      };
    }

    if (!isPrivacyStackConfigured()) {
      return {
        supported: false,
        reason: 'Privacy pool not yet configured for this build',
      };
    }

    return { supported: true };
  }, [chainId]);
}
