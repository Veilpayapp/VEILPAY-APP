/**
 * UX-001 / premium ASP path: when a Stellar wallet session is ready, run
 * SPP account setup (keys + ASP membership) once in the background without
 * requiring the diagnostic Private status screen.
 *
 * Failures are silent (logged in __DEV__) so public UX stays clean.
 * Do NOT re-run pool_sync / ensureSpp on every AppState resume — that freezes
 * private mode when returning from Settings.
 */

import { useEffect, useRef } from 'react';
import { useWalletStore } from '../stores/walletStore';
import { isSppEnabledForChain, SPP_MAINNET } from '../constants/spp';

const RETRY_COOLDOWN_MS = 60_000;
/** Stellar testnet is the only SPP chain today — recover even if UI is on another network. */
const SPP_RECOVERY_CHAIN_KEY = 'stellar-testnet';

export function useSppBackgroundSetup(): void {
  const address = useWalletStore((s) => s.address);
  const isConnected = useWalletStore((s) => s.isConnected);
  const activeChainKey = useWalletStore((s) => s.activeChain?.key);
  const addresses = useWalletStore((s) => s.addresses);
  const lastAttemptAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const didBootRef = useRef(false);

  useEffect(() => {
    if (!isConnected) return;

    const stellarAddress =
      (addresses?.xlm && /^G[A-Z2-7]{55}$/.test(addresses.xlm) && addresses.xlm) ||
      (address && /^G[A-Z2-7]{55}$/.test(address) ? address : null);
    if (!stellarAddress) return;

    // If the user is on mainnet Stellar but SPP_MAINNET is not configured,
    // do NOT fall back to testnet — that would mix testnet operations with
    // a mainnet UI and confuse the sync/register flow.
    if (activeChainKey === 'stellar' && !SPP_MAINNET) return;

    const chainKey =
      activeChainKey && isSppEnabledForChain(activeChainKey)
        ? activeChainKey
        : isSppEnabledForChain(SPP_RECOVERY_CHAIN_KEY)
          ? SPP_RECOVERY_CHAIN_KEY
          : null;
    if (!chainKey) return;

    // One boot path per hook mount — never on AppState resume.
    if (didBootRef.current) return;

    const bootTimer = setTimeout(() => {
      void (async () => {
        const now = Date.now();
        if (inFlightRef.current) return;
        if (now - lastAttemptAtRef.current < RETRY_COOLDOWN_MS) return;

        inFlightRef.current = true;
        lastAttemptAtRef.current = now;
        didBootRef.current = true;
        try {
          const {
            ensureSppAccountReady,
            refreshPrivateBalanceSmart,
            hasRecoveredThisSession,
          } = await import('../utils/stellarSpp');

          await ensureSppAccountReady(chainKey, stellarAddress);

          if (!hasRecoveredThisSession(chainKey, stellarAddress)) {
            const recovery = await refreshPrivateBalanceSmart(
              chainKey,
              stellarAddress,
              { force: false }
            );
            if (__DEV__) {
              console.log('[spp-background-setup]', recovery.message, {
                recovered: recovery.recovered,
                amount: recovery.amount,
                nativeAmount: recovery.nativeAmount,
              });
            }
          }
        } catch (e) {
          if (__DEV__) {
            console.log(
              '[spp-background-setup]',
              e instanceof Error ? e.message : String(e)
            );
          }
        } finally {
          inFlightRef.current = false;
        }
      })();
    }, 1500);

    return () => {
      clearTimeout(bootTimer);
    };
  }, [address, addresses, isConnected, activeChainKey]);
}
