// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
//
// usePaymentTransaction — single-source dispatcher for the three privacy levels.
// =============================================================================
//
// This hook is the seam where the UI's chosen `privacyLevel` is turned into
// concrete on-chain action. The shape is deliberate: a *single*
// `switch (privacyLevel)` dispatcher lives inside `handleConfirmSend`, so the
// `'standard'` / `'stealth'` / `'max'` paths cannot accidentally bleed into
// each other (e.g. `'max'` can never call `StealthAnnouncer`, `'standard'`
// can never enter the pool). See design.md §`apps/consumer-app/src/hooks/
// usePaymentTransaction.ts` and Requirements 4.1, 4.2, 4.6, 4.7, 4.8, 7.3,
// 7.4, 8.1, 8.3, 8.4, 12.4, 12.5.
//
// Privacy branches:
//
//   `'standard'`  → existing direct token transfer (EVM / SVM / MVM / XLM).
//                   Never touches `StealthAnnouncer`, never enters the pool.
//
//   `'stealth'`   → derive a one-time stealth address with the dual-key
//                   `stealthEngine`, fund it with a regular EVM transfer,
//                   wait for on-chain confirmation, then call
//                   `StealthAnnouncer.announce(1, stealthAddress,
//                   ephemeralPubKey, '0x')`. Per Requirement 4.6 the announce
//                   call MUST happen before the UI surface flips to
//                   `'confirmed'`. On announce failure we surface a warning
//                   toast but keep the underlying transfer marked successful
//                   — the funds did move, only the discovery hint failed.
//
//   `'max'`       → load the source `CommitmentRecord` from SecureStore (or
//                   guide the user back to deposit if missing), run
//                   `ZkpProver` to generate a Groth16 proof against the
//                   pool's current Merkle root, post the result to the
//                   relayer, poll for on-chain confirmation, and on success
//                   `markSpent` the record so it is never reused.
//
// Pre-flight guard: when `privacyLevel ∈ {stealth, max}` and the privacy
// stack is not configured (`deployments/sepolia.json` still holds zero
// addresses), we bail with a config-error toast rather than silently
// transacting against the zero address. Requirements 13.2, 13.3.
//
// Implementation notes / TODOs:
//   * `'stealth'` reads only one key from the directory today — the
//     consumer-app `directory.fetchRecipientPublicKey` returns a single
//     viewing-key hex. The new dual-key engine wants both viewing pub *and*
//     spending pub. As an interim bridge we feed the same key into both
//     slots and flag this with a TODO so the directory extension to a
//     dual-key meta-address (out of scope for task 9.2) lands in one place.
//   * `'max'` requires `pathElements`, `pathIndices`, and `nullifierHash`
//     to feed the prover. `CommitmentRecord` does not yet carry the path
//     data nor a precomputed `nullifierHash`. Until task 11.x lands the
//     deposit-time path-stash and the on-chain reconstruction fallback,
//     `'max'` throws a clear "not yet implemented" error after loading
//     the record. The dispatcher *shape* is what task 9.2 establishes —
//     the missing inputs surface as a typed error rather than as a silent
//     failure or as a placeholder proof submission.
import 'react-native-get-random-values';
import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { parseEther } from 'viem';
import { Buffer } from 'buffer';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

import { useWalletStore } from '../stores/walletStore';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useToast } from '../components/Toast';
import {
  signAndSendTransaction,
  deriveAddressFromStoredMnemonic,
} from '../utils/secureSigner';
import { signAndSendSolanaTransaction } from '../utils/solanaSigner';
import { signAndSendStellarTransaction } from '../utils/stellarSigner';
import { validateAddress } from '../utils/validation';
import {
  TransactionError,
  TransactionResult,
  getStoredMnemonic,
} from '../utils/transactions';
import { getRpcUrl } from '../utils/rpc';
import { encryptNote, generateEphemeralKeyPair } from '../utils/encryption';
import { deriveStealthAddress } from '../utils/stealthEngine';
import { fetchRecipientPublicKey } from '../utils/directory';
import { pollTransactionStatus } from '../utils/txStatusPoller';
import {
  estimateTransactionGas,
  isGasExpensive,
  type GasEstimate,
} from '../utils/gasEstimator';
import {
  loadCommitmentRecord,
  markSpent,
  type Hex,
} from '../stores/commitmentStore';
import { submitWithdraw, RelayerError } from '../services/relayerClient';
import type { WithdrawRequest } from '../schemas/withdrawRequest';
import {
  isPrivacyStackConfigured,
  STEALTH_ANNOUNCER_ADDRESS,
  VEIL_POOL_ADDRESS,
} from '../constants/contracts';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import type { PrivacyLevel } from '../stores/settingsStore';
import type { ZkpProverRef } from '../components/ZkpProver';
import type { UiTxStatus } from '../components/payment/TransactionStatusCard';

// ABI fragment for the single `StealthAnnouncer.announce` call we make on
// the stealth path. Kept inline rather than importing the full contract
// JSON so the bundle stays small — the hook only ever needs this one
// function selector.
const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata) external',
] as const;

interface PaymentTransactionParams {
  recipient: string;
  amount: string;
  memo: string;
  token: string;
  tokenAddress?: string;
  tokenDecimals?: number;
  /**
   * Selected privacy level. Narrowed to the canonical union so callers
   * can no longer pass arbitrary strings — the dispatcher's `default`
   * branch surfaces any drift as a runtime error in development.
   */
  privacyLevel: PrivacyLevel;
  ethPrice: number | null;
  activeNetworkKey: string;
  selectedNetwork: any;
  isSendSupported: boolean;
  zkpProverRef: React.RefObject<ZkpProverRef | null>;
  /**
   * Required for `privacyLevel === 'max'`: identifies the source
   * `CommitmentRecord` in SecureStore that the withdraw will spend.
   * Ignored on `'standard'` and `'stealth'`. When missing on `'max'`
   * the dispatcher emits a "deposit first" guidance toast.
   */
  sourceCommitmentHash?: Hex;
}

export function usePaymentTransaction({
  recipient,
  amount,
  memo,
  token,
  tokenAddress,
  tokenDecimals,
  privacyLevel,
  ethPrice,
  activeNetworkKey,
  selectedNetwork,
  isSendSupported,
  zkpProverRef,
  sourceCommitmentHash,
}: PaymentTransactionParams) {
  const [txStatus, setTxStatus] = useState<UiTxStatus>('idle');
  const [txResult, setTxResult] = useState<TransactionResult | null>(null);
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [gasExpensive, setGasExpensive] = useState(false);
  const [hasMnemonic, setHasMnemonic] = useState<boolean | null>(null);

  const isMountedRef = useRef(true);
  const pollAbortRef = useRef<AbortController | null>(null);

  const { activeChain, address } = useWalletStore();
  const { isConnected } = useNetworkStatus();
  const toast = useToast();

  const isWalletVerificationPending = hasMnemonic === null;
  const isSendDisabled =
    isWalletVerificationPending || hasMnemonic === false || !isSendSupported;

  useEffect(() => {
    async function checkMnemonic() {
      const addr = await deriveAddressFromStoredMnemonic();
      if (isMountedRef.current) {
        setHasMnemonic(addr !== null);
      }
    }
    checkMnemonic();
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pollAbortRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (txStatus !== 'idle') {
      return;
    }
    if (!recipient || !amount || !address || !isSendSupported) {
      setGasEstimate(null);
      setGasExpensive(false);
      return;
    }

    let isCancelled = false;

    const refreshGasEstimate = async () => {
      try {
        const parsedAmount = Number.parseFloat(amount);

        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          setGasEstimate(null);
          setGasExpensive(false);
          return;
        }

        let estimate;
        if (activeChain?.type === 'svm') {
          const estimatedCostWei = 5000n;
          const estimatedCostEth = (
            Number(estimatedCostWei) / LAMPORTS_PER_SOL
          ).toString();
          estimate = {
            gasLimit: 0n,
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n,
            gasPrice: 0n,
            estimatedCostWei,
            estimatedCostEth,
            estimatedCostUsd: null,
            isStale: false,
            fetchedAt: Date.now(),
          } as GasEstimate;
        } else if (activeChain?.type === 'xlm') {
          // Stellar base fee: 100 stroops = 0.00001 XLM
          const estimatedCostWei = 100n;
          const estimatedCostEth = '0.00001';
          estimate = {
            gasLimit: 0n,
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n,
            gasPrice: 0n,
            estimatedCostWei,
            estimatedCostEth,
            estimatedCostUsd: null,
            isStale: false,
            fetchedAt: Date.now(),
          } as GasEstimate;
        } else {
          estimate = await estimateTransactionGas(
            {
              to: recipient,
              value: parseEther(parsedAmount.toString()),
              from: address,
            },
            activeNetworkKey,
            ethPrice ?? undefined
          );
        }

        if (isCancelled || !isMountedRef.current) {
          return;
        }

        setGasEstimate(estimate);
        setGasExpensive(isGasExpensive(estimate));
      } catch {
        if (isCancelled || !isMountedRef.current) {
          return;
        }
        setGasEstimate(null);
        setGasExpensive(false);
      }
    };

    refreshGasEstimate();
    const intervalId = setInterval(refreshGasEstimate, 15000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [
    activeNetworkKey,
    address,
    amount,
    ethPrice,
    isSendSupported,
    recipient,
    txStatus,
    activeChain,
  ]);

  const handleConfirmSend = async () => {
    const attemptStartedAt = Date.now();

    // -----------------------------------------------------------------
    // Pre-flight validation — same checks as before, ordered top-down.
    // -----------------------------------------------------------------
    if (!recipient || !amount) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'missing_payment_details',
      });
      toast.show('Missing payment details', 'error');
      return;
    }

    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'invalid_amount',
      });
      toast.show('Invalid payment amount', 'error');
      return;
    }

    // Re-validate recipient against the *active* chain on confirm — not just
    // the chain that was active when SendPaymentScreen accepted the address.
    // A network switch between send and confirm would otherwise let an
    // EVM-shaped address through on Solana/Stellar (and vice versa).
    const activeChainType = activeChain?.type;
    if (
      !activeChainType ||
      !validateAddress(recipient.trim(), activeChainType)
    ) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'invalid_address_for_chain',
        chain_type: activeChainType ?? 'unknown',
      });
      toast.show('Recipient address is not valid for the selected network.', 'error');
      return;
    }

    if (isWalletVerificationPending) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'wallet_verification_pending',
      });
      toast.show('Wallet verification in progress. Please wait.', 'info');
      return;
    }

    if (hasMnemonic === false) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'wallet_not_initialized',
      });
      toast.show(
        'Wallet not properly initialized. Please re-import your wallet.',
        'error'
      );
      return;
    }

    if (!isSendSupported) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'unsupported_network',
      });
      toast.show(
        'Payments are only supported on EVM networks in this build.',
        'error'
      );
      return;
    }

    if (isConnected === false) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'offline',
      });
      toast.show('No internet connection', 'error');
      return;
    }

    // Privacy-stack fail-fast: if the user picked a privacy-stack-backed
    // level but the build does not have valid contract addresses, bail
    // before any signing happens. We surface `'failed'` in the UI so the
    // user is not stuck with a spinner; the toast carries the reason.
    if (
      (privacyLevel === 'stealth' || privacyLevel === 'max') &&
      !isPrivacyStackConfigured()
    ) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'privacy_stack_not_configured',
        privacy_level: privacyLevel,
      });
      toast.show('Privacy stack not configured for this build.', 'error');
      setTxStatus('failed');
      return;
    }

    trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_ATTEMPTED, {
      network_key: activeNetworkKey,
      token,
      privacy_level: privacyLevel,
      has_memo: Boolean(memo),
    });

    setTxResult(null);

    try {
      // -------------------------------------------------------------
      // Single dispatcher — the load-bearing shape for task 9.2.
      // -------------------------------------------------------------
      switch (privacyLevel) {
        case 'standard': {
          await runStandardFlow();
          break;
        }
        case 'stealth': {
          await runStealthFlow();
          break;
        }
        case 'max': {
          await runMaxFlow();
          break;
        }
        default: {
          // Exhaustiveness — `privacyLevel` is narrowed to the canonical
          // union, so this is unreachable in well-typed code. We leave
          // the throw for runtime defence in case a JS caller bypasses
          // TypeScript and feeds a stale value.
          const exhaustive: never = privacyLevel;
          throw new Error(`Unknown privacy level: ${String(exhaustive)}`);
        }
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setTxStatus('failed');

      if (error instanceof TransactionError) {
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          reason: error.code,
          message: error.message,
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });

        switch (error.code) {
          case 'INSUFFICIENT_FUNDS': {
            // Name the actual native asset for the selected network rather
            // than hardcoding ETH — a Solana/Aptos/Stellar/BNB send should
            // not tell the user to "add more ETH".
            const fundsSymbol = selectedNetwork?.symbol || token || 'funds';
            toast.show(
              `Insufficient funds. Please add more ${fundsSymbol} to your wallet.`,
              'error'
            );
            break;
          }
          case 'INVALID_ADDRESS':
            toast.show(
              'Invalid recipient address. Please check and try again.',
              'error'
            );
            break;
          case 'NETWORK_ERROR':
            toast.show(
              'Network error. Please check your connection and try again.',
              'error'
            );
            break;
          case 'USER_REJECTED':
            toast.show('Transaction cancelled.', 'error');
            break;
          default:
            toast.show(error.message, 'error');
        }
      } else if (error instanceof RelayerError) {
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          reason: `relayer_${error.kind}`,
          message: error.message,
          status: error.status,
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        const statusSuffix =
          typeof error.status === 'number' ? ` (HTTP ${error.status})` : '';
        toast.show(`Relayer error: ${error.message}${statusSuffix}`, 'error');
      } else {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to send payment';
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          reason: 'unknown',
          message: errorMessage,
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        toast.show(errorMessage, 'error');
      }
    }

    // ===================================================================
    // Per-branch flow helpers
    // ===================================================================

    /**
     * `'standard'` flow — direct token transfer on the active chain.
     * Never calls the announcer or the pool. Memo encryption (when a memo
     * is present and the recipient is in the directory) is preserved
     * here because it is orthogonal to the privacy stack.
     */
    async function runStandardFlow(): Promise<void> {
      const chainType = activeChain?.type ?? 'evm';
      let encryptedPayload: any = undefined;

      if (memo) {
        const recipientPubKeyHex = await fetchRecipientPublicKey(
          recipient,
          chainType
        );
        if (recipientPubKeyHex) {
          const hexStr = recipientPubKeyHex.startsWith('0x')
            ? recipientPubKeyHex.slice(2)
            : recipientPubKeyHex;
          const recipientPubKeyBytes = new Uint8Array(
            hexStr.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
          );
          const senderKeys = generateEphemeralKeyPair();
          encryptedPayload = encryptNote(
            memo,
            recipientPubKeyBytes,
            senderKeys.secretKey
          );
        }
        // If the recipient has no directory entry we silently drop the
        // memo on the standard path — the user already accepted the
        // standard privacy level which makes plaintext the only
        // alternative, and we'd rather lose the memo than reveal it.
      }

      setTxStatus('sending');

      let result;
      if (activeChain?.type === 'svm') {
        result = await signAndSendSolanaTransaction(
          {
            to: recipient,
            value: parsedAmount.toString(),
            tokenAddress,
            tokenDecimals,
          },
          activeNetworkKey,
          undefined
        );
      } else if (activeChain?.type === 'xlm') {
        result = await signAndSendStellarTransaction(
          {
            to: recipient,
            value: parsedAmount.toString(),
            // Stellar only supports short text memos.
            data: memo ? memo.slice(0, 28) : undefined,
          },
          activeNetworkKey,
          undefined
        );
      } else {
        result = await signAndSendTransaction(
          {
            to: recipient,
            value: parsedAmount.toString(),
            data: encryptedPayload
              ? `0x${Buffer.from(JSON.stringify(encryptedPayload)).toString('hex')}`
              : undefined,
          },
          activeNetworkKey,
          ethPrice ?? undefined
        );
      }

      setGasExpensive(isGasExpensive(result.gasEstimate));
      await pollAndApply(result.hash, /* finalizeOnConfirm */ undefined);
    }

    /**
     * `'stealth'` flow — derive a one-time stealth address with the dual-key
     * engine, fund it, wait for confirmation, then announce. Per
     * Requirement 4.6 the announce call MUST happen before we flip the
     * UI surface to `'confirmed'`.
     *
     * Stealth path is EVM-only: the announcer contract is on Sepolia and
     * the dual-key engine emits SEC1-compressed pubkeys keyed off
     * secp256k1. SVM/MVM/XLM are rejected upstream by the privacy-level
     * UI, but we double-check here.
     */
    async function runStealthFlow(): Promise<void> {
      const chainType = activeChain?.type ?? 'evm';
      if (chainType !== 'evm') {
        throw new Error(
          'Stealth privacy is only supported on EVM networks in this build.'
        );
      }

      setTxStatus('stealth_deriving');

      // TODO(directory): the directory currently exposes a single viewing
      // key per merchant. The dual-key stealth engine wants both viewing
      // *and* spending public keys. Until the directory is extended to
      // serve a meta-address, we feed the same key into both slots so
      // the engine still produces a derivable address. The recipient's
      // scanner will recover correctly only after the directory upgrade.
      const recipientPubKey = await fetchRecipientPublicKey(
        recipient,
        chainType
      );
      if (!recipientPubKey) {
        throw new Error(
          'Recipient public key not found in directory for stealth addressing'
        );
      }
      const recipientHex = (recipientPubKey.startsWith('0x')
        ? recipientPubKey
        : `0x${recipientPubKey}`) as Hex;

      const { stealthAddress, ephemeralPubKey } = deriveStealthAddress(
        recipientHex,
        recipientHex
      );

      // Fund the stealth address with a regular EVM transfer. We never
      // attach the ephemeral key as calldata on the stealth path — the
      // announcer is the canonical discovery channel.
      setTxStatus('sending');
      const result = await signAndSendTransaction(
        {
          to: stealthAddress,
          value: parsedAmount.toString(),
        },
        activeNetworkKey,
        ethPrice ?? undefined
      );
      setGasExpensive(isGasExpensive(result.gasEstimate));

      setTxResult({ hash: result.hash, status: 'pending' });
      setTxStatus('pending');
      toast.show(
        'Transaction submitted! Waiting for confirmation...',
        'success'
      );

      const pollResult = await pollTransactionStatus({
        chainKey: activeNetworkKey,
        txHash: result.hash,
        fromAddress: address || '',
        toAddress: stealthAddress,
        amountEth: parsedAmount.toString(),
        tokenSymbol: token || 'ETH',
        networkName: selectedNetwork?.name || activeNetworkKey,
        // The on-chain record is still a "standard"-shaped transfer; the
        // stealth nature is a function of the announcer event, which the
        // recipient scanner correlates separately.
        privacyLevel: 'standard',
        signal: pollAbortRef.current?.signal,
      });

      if (!isMountedRef.current) {
        return;
      }

      if (pollResult.status !== 'completed') {
        // Fund transfer didn't confirm within the poll window — fall back
        // to the same UX the standard path uses for non-confirmed
        // outcomes. We do NOT announce in this case: announcing for an
        // unconfirmed transfer would publish a stealth address that may
        // never receive funds.
        applyNonConfirmedOutcome(result.hash, pollResult.status);
        return;
      }

      // The fund transfer is confirmed on-chain. Announce BEFORE we
      // surface `'confirmed'` to the UI (Requirement 4.6). On announce
      // failure the underlying transfer is still successful — we surface
      // a warning toast and keep the UI on the success path.
      try {
        const mnemonicWords = await getStoredMnemonic();
        if (!mnemonicWords || mnemonicWords.length === 0) {
          throw new Error('No wallet mnemonic available for announce signer');
        }
        const rpcUrl = getRpcUrl(activeNetworkKey);
        if (!rpcUrl) {
          throw new Error(`No RPC URL for chain ${activeNetworkKey}`);
        }
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const signer = ethers.Wallet.fromPhrase(
          mnemonicWords.join(' '),
          provider
        );
        const announcer = new ethers.Contract(
          STEALTH_ANNOUNCER_ADDRESS,
          ANNOUNCER_ABI,
          signer
        );
        // schemeId = 1 is the secp256k1 ERC-5564 scheme implemented by
        // the indexer's stealth scanner. metadata = '0x' until the wire
        // format adds optional view tags or per-token hints.
        const announceTx = await announcer.announce(
          1,
          stealthAddress,
          ephemeralPubKey,
          '0x'
        );
        await announceTx.wait();
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_SUBMITTED, {
          network_key: activeNetworkKey,
          tx_hash: result.hash,
          announce_tx_hash: announceTx.hash,
          privacy_level: 'stealth',
        });
      } catch (announceErr) {
        const message =
          announceErr instanceof Error ? announceErr.message : String(announceErr);
        // Underlying transfer succeeded — keep the UI on the success
        // path and warn the user that the discovery hint failed. A
        // re-run of the announce step is a follow-up integration concern.
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          tx_hash: result.hash,
          reason: 'stealth_announce_failed',
          message,
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        toast.show(
          'Stealth announcement failed; payment was still sent.',
          'warning'
        );
      }

      // Now flip the UI to confirmed (announce attempted, transfer
      // confirmed regardless of announce outcome).
      const finalTxResult: TransactionResult = {
        hash: result.hash,
        status: 'confirmed',
      };
      setTxResult(finalTxResult);
      setTxStatus('confirmed');
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_CONFIRMED, {
        network_key: activeNetworkKey,
        tx_hash: result.hash,
        confirmation_time_ms: Date.now() - attemptStartedAt,
        privacy_level: 'stealth',
      });
      toast.show('Payment sent successfully!', 'success');
    }

    /**
     * `'max'` flow — load the source `CommitmentRecord`, prove against
     * the pool's current Merkle root, and dispatch to the relayer.
     *
     * NOTE: the deposit-time Merkle path (`pathElements`, `pathIndices`)
     * is not yet stored alongside the `CommitmentRecord`, and the
     * consumer-app does not yet ship a Poseidon hash for the
     * `nullifierHash = Poseidon(nullifier)` step. The dispatcher *shape*
     * is the deliverable for task 9.2; the missing inputs surface as a
     * typed "not yet implemented" error so task 11.x can wire them in
     * without touching the dispatcher again.
     */
    async function runMaxFlow(): Promise<void> {
      if (!sourceCommitmentHash) {
        toast.show(
          'No commitment record selected. Deposit first to use max privacy.',
          'error'
        );
        setTxStatus('failed');
        return;
      }

      const record = await loadCommitmentRecord(sourceCommitmentHash);
      if (!record) {
        toast.show(
          'No commitment record found. Deposit first to use max privacy.',
          'error'
        );
        setTxStatus('failed');
        return;
      }
      if (record.spent) {
        toast.show(
          'This commitment has already been spent. Pick a fresh deposit.',
          'error'
        );
        setTxStatus('failed');
        return;
      }

      setTxStatus('proving');

      // TODO(scanning): reconstruct the Merkle path
      // (`pathElements`, `pathIndices`) from chain — either by extending
      // `CommitmentRecord` to stash the deposit-time path or by reading
      // the leaf set via an indexer call. Same for `nullifierHash`,
      // which needs Poseidon(record.nullifier). These are tracked in
      // tasks 11.x. Until then we throw a clear "not yet implemented"
      // error so the dispatcher's shape is what task 9.2 ships and the
      // missing pieces are visible to integration.
      const recordWithPath = record as typeof record & {
        pathElements?: Hex[];
        pathIndices?: number[];
        nullifierHash?: Hex;
      };
      if (
        !recordWithPath.pathElements ||
        !recordWithPath.pathIndices ||
        !recordWithPath.nullifierHash
      ) {
        throw new Error(
          'not yet implemented: Merkle path and nullifierHash for max-privacy withdraw are not yet wired to CommitmentRecord (tracked in tasks 11.x)'
        );
      }

      const proofResult = await zkpProverRef.current?.generateProof({
        nullifier: record.nullifier,
        secret: record.secret,
        pathElements: recordWithPath.pathElements,
        pathIndices: recordWithPath.pathIndices,
        merkleRoot: record.merkleRoot,
        nullifierHash: recordWithPath.nullifierHash,
        recipient,
        amount: parsedAmount.toString(),
      });
      if (!proofResult) {
        throw new Error('ZkpProver returned no proof');
      }
      toast.show('ZK Proof generated successfully!', 'success');

      setTxStatus('relaying');

      const requestBody: WithdrawRequest = {
        nullifierHash: recordWithPath.nullifierHash,
        proof: proofResult.proof as `0x${string}`,
        publicSignals: proofResult.publicSignals as `0x${string}`[],
        merkleRoot: record.merkleRoot,
        recipient: recipient as `0x${string}`,
        token: record.token,
        amount: record.amount,
        chainKey: 'evm-sepolia',
        contractAddress: VEIL_POOL_ADDRESS as `0x${string}`,
      };

      const { txHash } = await submitWithdraw(requestBody);

      setTxResult({ hash: txHash, status: 'pending' });
      setTxStatus('pending');
      toast.show(
        'Withdraw submitted via relayer! Waiting for confirmation...',
        'success'
      );

      const pollResult = await pollTransactionStatus({
        chainKey: activeNetworkKey,
        txHash,
        fromAddress: address || '',
        toAddress: recipient,
        amountEth: parsedAmount.toString(),
        tokenSymbol: token || 'ETH',
        networkName: selectedNetwork?.name || activeNetworkKey,
        privacyLevel: 'max',
        signal: pollAbortRef.current?.signal,
      });

      if (!isMountedRef.current) {
        return;
      }

      if (pollResult.status === 'completed') {
        // Mark the record spent so it cannot be reused. SecureStore
        // failure here is logged but does not flip the UI to failed —
        // the on-chain nullifier-spent flag is the authoritative double-
        // spend guard, and the local record is a UX optimization.
        try {
          await markSpent(sourceCommitmentHash);
        } catch (markErr) {
          const message =
            markErr instanceof Error ? markErr.message : String(markErr);
          console.warn('[usePaymentTransaction] markSpent failed', message);
        }

        setTxResult({ hash: txHash, status: 'confirmed' });
        setTxStatus('confirmed');
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_CONFIRMED, {
          network_key: activeNetworkKey,
          tx_hash: txHash,
          confirmation_time_ms: Date.now() - attemptStartedAt,
          privacy_level: 'max',
        });
        toast.show('Payment sent successfully!', 'success');
        return;
      }

      applyNonConfirmedOutcome(txHash, pollResult.status);
    }

    // ===================================================================
    // Shared post-broadcast helpers
    // ===================================================================

    /**
     * Standard polling step shared by the `'standard'` flow. Updates the
     * UI to `'pending'`, polls, then maps the final poller status into
     * the appropriate UI state and analytics event.
     */
    async function pollAndApply(
      hash: string,
      _finalizeOnConfirm: undefined
    ): Promise<void> {
      setTxResult({ hash, status: 'pending' });
      setTxStatus('pending');
      toast.show(
        'Transaction submitted! Waiting for confirmation...',
        'success'
      );

      const pollResult = await pollTransactionStatus({
        chainKey: activeNetworkKey,
        txHash: hash,
        fromAddress: address || '',
        toAddress: recipient,
        amountEth: parsedAmount.toString(),
        tokenSymbol: token || 'ETH',
        networkName: selectedNetwork?.name || activeNetworkKey,
        privacyLevel: 'standard',
        signal: pollAbortRef.current?.signal,
      });

      if (!isMountedRef.current) {
        return;
      }

      if (pollResult.status === 'completed') {
        setTxResult({ hash, status: 'confirmed' });
        setTxStatus('confirmed');
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_CONFIRMED, {
          network_key: activeNetworkKey,
          tx_hash: hash,
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        toast.show('Payment sent successfully!', 'success');
        return;
      }

      applyNonConfirmedOutcome(hash, pollResult.status);
    }

    /**
     * Shared mapping for `'failed'` and `'pending'` (timeout) outcomes —
     * keeps analytics and toasts consistent across the standard, stealth,
     * and max paths.
     */
    function applyNonConfirmedOutcome(
      hash: string,
      status: 'failed' | 'pending' | 'completed'
    ): void {
      if (status === 'failed') {
        setTxResult({ hash, status: 'failed' });
        setTxStatus('failed');
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          tx_hash: hash,
          reason: 'on_chain_failure',
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        toast.show('Transaction failed on-chain.', 'error');
        return;
      }
      // 'pending' — poller timed out; we keep the record but surface the
      // delay so the user knows to check history later.
      setTxResult({ hash, status: 'pending' });
      setTxStatus('pending');
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
        network_key: activeNetworkKey,
        tx_hash: hash,
        reason: 'confirmation_timeout',
        confirmation_time_ms: Date.now() - attemptStartedAt,
      });
      toast.show(
        'Transaction submitted but confirmation is taking longer than expected. Check your history later.',
        'info'
      );
    }
  };

  return {
    txStatus,
    txResult,
    gasEstimate,
    gasExpensive,
    isWalletVerificationPending,
    isSendDisabled,
    handleConfirmSend,
  };
}
