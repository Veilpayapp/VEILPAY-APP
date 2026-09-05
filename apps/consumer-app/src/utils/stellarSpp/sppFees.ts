/**
 * Stellar/Soroban fee constants for fee *display* and pre-send gating.
 *
 * Single source of truth. Do not re-declare these numbers in screens,
 * hooks, or signers.
 */

/** 1 XLM = 10,000,000 stroops. */
export const XLM_STROOPS = 10_000_000n;

/**
 * Protocol base fee for one classic operation.
 * Mirrors `STELLAR_FEE_STROOPS` in `../stellarSigner`, which is what the
 * classic payment path actually submits.
 */
export const STELLAR_CLASSIC_FEE_STROOPS = 100n;

/**
 * Per-`transact` XLM budget shown on the confirm screen for SPP ops.
 *
 * The submitted fee is BASE_FEE(100) + minResourceFee, decided by simulation
 * *after* the Groth16 proof exists (vendor sdk/stellar `prepare_pool_transact`
 * → `assemble_soroban_transaction`), so the exact figure cannot be known when
 * the confirm screen first renders. BN254 pairing verification plus the
 * nullifier-map and Merkle persistent writes dominate the resource fee.
 *
 * Calibrated from this account's on-chain history (2026-07-08 → 2026-08-08):
 *
 * | metric | stroops | XLM |
 * |---|---|---|
 * | median successful `fee_charged` | 40,130 | 0.004 |
 * | max successful `fee_charged`    | 452,201 | 0.045 |
 * | max submitted `max_fee`         | 1,156,558 | 0.116 |
 *
 * 1 of 19 actual charges exceeds the old 200k ceiling (2.26× over); **13 of 25
 * submitted `max_fee` values exceed it**, up to 5.8× over. The gate must cover
 * the *submitted* `max_fee` (what the account must afford at submission), not
 * the settled charge, so the ceiling is 1,200,000 stroops (0.12 XLM). Caveat:
 * these figures are from `register` and `insert_leaf`; `transact` has never run,
 * so this is inference from adjacent ops, not a direct transact measurement.
 * TODO(calibrate): replace with observed p95 `tx.fee` from the first successful
 * mainnet transacts — the value is on the submitted envelope.
 */
export const SPP_TRANSACT_FEE_CEILING_STROOPS = 1_200_000n; // 0.12 XLM

/** Stroops to an XLM decimal string, 7 dp, trailing zeros trimmed. */
export function stroopsToXlm(stroops: bigint): string {
  const s = stroops < 0n ? 0n : stroops;
  const whole = s / XLM_STROOPS;
  const frac = (s % XLM_STROOPS).toString().padStart(7, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * Planned pool-transaction count. `shield` is always a single deposit; a
 * spend consolidates roughly `noteCount - 1` times, bounded by the vendor
 * planner's `TRANSACTION_LIMIT` (10).
 */
export function sppPlannedTxCount(
  op: 'shield' | 'transfer' | 'unshield',
  noteCount: number
): number {
  if (op === 'shield') return 1;
  const n = Number.isFinite(noteCount) ? Math.floor(noteCount) : 0;
  return Math.min(10, Math.max(1, n - 1));
}

/** Total fee ceiling for an op, in stroops. */
export function sppFeeCeilingStroops(
  op: 'shield' | 'transfer' | 'unshield',
  noteCount: number
): bigint {
  return (
    SPP_TRANSACT_FEE_CEILING_STROOPS * BigInt(sppPlannedTxCount(op, noteCount))
  );
}
