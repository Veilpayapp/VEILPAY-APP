/**
 * Onramp order status machine + provider status-polling fallback (round 5).
 *
 * This module owns three things the fiat onramp lifecycle was missing:
 *
 *   1. CAS terminal transitions — `applyOnrampStatusTransition` performs the
 *      status write with the terminal-state precondition inside the UPDATE's
 *      WHERE clause (`updateMany` + `status: { notIn: TERMINAL }`, mirroring
 *      paymentProcessor.ts confirmInvoicePayment). The previous
 *      find-then-update in the webhook handler read `processing`, released
 *      the row, then wrote whatever the event said — so an out-of-order
 *      `failed` could overwrite a `completed` order. With the CAS write, a
 *      late event that no longer matches the precondition updates ZERO rows
 *      and is provably inert.
 *
 *   2. Refund representation — provider refund/chargeback events map to the
 *      new `refunded` FiatOrderStatus value instead of collapsing into
 *      `failed`. `completed → refunded` is the ONE sanctioned exit from a
 *      terminal state and has its own CAS precondition; `completed → failed`
 *      can never happen. Post-completion refunds are no longer dropped.
 *
 *   3. Provider status-polling fallback — a lost webhook previously stranded
 *      a fiat order in `pending` forever. `startOnrampStatusPoller` (config
 *      gated, DEFAULT OFF) sweeps orders stuck `pending`/`processing` past
 *      the stale threshold, fetches their status from the provider's API and
 *      applies the SAME CAS transitions as the webhook path. Status-only:
 *      amounts never come from provider payloads — server records stay the
 *      source of truth.
 */

/* eslint-disable no-console */
import type { FiatOrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../lib/logger';
import { OnrampService } from '../lib/onramp';
import { MoonPayService } from '../lib/moonpay';

/**
 * Order statuses we treat as terminal. An event that tries to move an order
 * OUT of one of these states is a replay or an out-of-order delivery and is
 * ignored — except the single sanctioned exit `completed → refunded`.
 */
export const TERMINAL_STATUS_VALUES: FiatOrderStatus[] = [
  'completed',
  'cancelled',
  'failed',
  'refunded',
];

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(TERMINAL_STATUS_VALUES);

export type FiatOrderStatusValue = FiatOrderStatus;
export type OnrampTransitionResult = 'applied' | 'ignored';

/** Minimal order shape the transition machine needs (subset of FiatOrder). */
export interface OnrampOrderSnapshot {
  id: string;
  status: FiatOrderStatus;
  txHash: string | null;
  cryptoAmount: string | null;
}

/** Event-provided fields the webhook path writes alongside the status. */
export interface OnrampTransitionFields {
  txHash?: string;
  cryptoAmount?: string;
}

/**
 * Normalizes a provider webhook status into a FiatOrderStatus.
 *
 * Unknown statuses still map to `failed` (existing, pinned semantics): a
 * signed webhook event the server cannot interpret is the provider
 * asserting something went wrong, and `failed` is terminal so the order is
 * never stranded. Refund/chargeback statuses (MoonPay `refunded` /
 * `refunded_card_payment`, Onramp.money `ORDER_REFUNDED`-style tokens) now
 * map to `refunded` instead of falling into `failed`.
 */
export function mapProviderWebhookStatus(rawStatus: unknown): FiatOrderStatusValue {
  const normalized = typeof rawStatus === 'string' ? rawStatus.toLowerCase().trim() : '';
  if (normalized === 'completed' || normalized === 'success') return 'completed';
  if (normalized === 'processing') return 'processing';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized.includes('refund')) return 'refunded';
  return 'failed';
}

/**
 * Normalizes a provider POLLING status into a FiatOrderStatus, FAIL-CLOSED.
 *
 * Unlike the webhook path, an unrecognized status returns `null` and the
 * order is left untouched: a polling response is parsed best-effort, and a
 * misread response shape must not mass-fail or mass-refund live orders.
 * Only statuses we explicitly understand mutate anything.
 */
export function mapProviderPollingStatus(rawStatus: unknown): FiatOrderStatusValue | null {
  const normalized = typeof rawStatus === 'string' ? rawStatus.toLowerCase().trim() : '';
  if (!normalized) return null;
  if (normalized === 'completed' || normalized === 'success') return 'completed';
  if (normalized === 'processing') return 'processing';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'failed') return 'failed';
  if (normalized.includes('refund')) return 'refunded';
  return null;
}

/**
 * The single sanctioned `completed → refunded` transition, guarded by its
 * own CAS precondition. A refund racing a completion (the read saw a
 * non-terminal state, the write lost the CAS) retries through here.
 *
 * `cryptoAmount` is deliberately NEVER written on refund transitions —
 * refund payloads describe the fiat side, and server records remain the
 * source of truth for what was delivered.
 */
async function casCompletedToRefunded(
  orderId: string,
  fields: OnrampTransitionFields,
): Promise<OnrampTransitionResult> {
  const data: { status: FiatOrderStatus; txHash?: string } = { status: 'refunded' };
  if (fields.txHash !== undefined) data.txHash = fields.txHash;

  const updated = await prisma.fiatOrder.updateMany({
    where: { id: orderId, status: 'completed' },
    data,
  });
  return updated.count > 0 ? 'applied' : 'ignored';
}

/**
 * Applies a status transition to a fiat order with a terminal-state CAS
 * precondition in the write itself (no read-then-act gap).
 *
 * Rules enforced atomically by the WHERE clauses below:
 *   - an order already in a terminal state never leaves it, except
 *     `completed → refunded`;
 *   - `completed` can NEVER be overwritten by `failed`/`cancelled`;
 *   - an event that arrives late (after a concurrent event flipped the
 *     order terminal) matches zero rows and is inert.
 *
 * Returns 'applied' when the order moved, 'ignored' when the event was
 * inert (terminal replay, out-of-order delivery, or lost CAS race).
 */
export async function applyOnrampStatusTransition(
  order: OnrampOrderSnapshot,
  nextStatus: FiatOrderStatusValue,
  fields: OnrampTransitionFields = {},
): Promise<OnrampTransitionResult> {
  // Terminal guard. This is the same guard the webhook previously applied
  // before its update — the difference is that the writes below no longer
  // depend on this read being fresh.
  if (TERMINAL_STATUSES.has(order.status)) {
    if (order.status === 'completed' && nextStatus === 'refunded') {
      return casCompletedToRefunded(order.id, fields);
    }
    return 'ignored';
  }

  // Non-terminal CAS write. The precondition `status NOT IN terminal` is
  // evaluated by the database at write time: if a concurrent event flipped
  // this order terminal between our read and this write, count === 0.
  const data: { status: FiatOrderStatus; txHash?: string; cryptoAmount?: string } = {
    status: nextStatus,
  };
  if (fields.txHash !== undefined) data.txHash = fields.txHash;
  if (fields.cryptoAmount !== undefined) data.cryptoAmount = fields.cryptoAmount;

  const updated = await prisma.fiatOrder.updateMany({
    where: { id: order.id, status: { notIn: TERMINAL_STATUS_VALUES } },
    data,
  });
  if (updated.count > 0) {
    return 'applied';
  }

  // Lost the CAS race: the order went terminal concurrently. A refund event
  // that raced a completion is still legitimate (post-completion refund) —
  // `completed → refunded` has its own precondition. Everything else is
  // inert; the caller responds as the terminal-guard path always has.
  if (nextStatus === 'refunded') {
    return casCompletedToRefunded(order.id, fields);
  }
  return 'ignored';
}

// ─── Provider status-polling fallback (config gated, DEFAULT OFF) ──────────

/**
 * Upper bound on provider API calls per sweep so one tick can never hammer
 * a provider (or hold the event loop) after a long outage backlog.
 */
const POLL_BATCH_LIMIT = 50;

let intervalHandle: NodeJS.Timeout | null = null;

export function onrampStatusPollerRunning(): boolean {
  return intervalHandle !== null;
}

/**
 * Starts the onramp status-polling worker. No-op (returns false) unless
 * ONRAMP_STATUS_POLLING_ENABLED is 'true' — the fallback ships OFF.
 */
export function startOnrampStatusPoller(): boolean {
  if (!config.onrampStatusPolling.enabled) {
    console.log(
      '[OnrampStatusPoller] Disabled (ONRAMP_STATUS_POLLING_ENABLED != true) — not starting',
    );
    return false;
  }
  if (intervalHandle) {
    return true;
  }

  console.log(
    `[OnrampStatusPoller] Starting: interval=${config.onrampStatusPolling.intervalMs}ms ` +
      `staleAfter=${config.onrampStatusPolling.staleMinutes}m`,
  );

  // setInterval expects `() => void`; wrap the async sweep so rejections are
  // logged instead of becoming unhandled (same shape as invoiceExpiry).
  intervalHandle = setInterval(() => {
    void (async (): Promise<void> => {
      try {
        await pollStaleOnrampOrders();
      } catch (error) {
        console.error('[OnrampStatusPoller] Error during sweep:', error);
      }
    })();
  }, config.onrampStatusPolling.intervalMs);

  return true;
}

export function stopOnrampStatusPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[OnrampStatusPoller] Stopped');
  }
}

/**
 * One sweep: find fiat orders stuck `pending`/`processing` whose updatedAt
 * is older than the stale threshold (a lost webhook leaves updatedAt parked
 * at creation), ask the provider for the authoritative status, and apply
 * the SAME CAS transitions as the webhook path.
 *
 * Status-only semantics: the transition is applied with NO event fields —
 * amounts and tx hashes never come from provider polling payloads; the
 * server's records stay the source of truth.
 *
 * Exported for direct testing (mocked prisma + mocked fetch).
 */
export async function pollStaleOnrampOrders(): Promise<number> {
  if (!config.onrampStatusPolling.enabled) {
    return 0;
  }

  const staleBefore = new Date(
    Date.now() - config.onrampStatusPolling.staleMinutes * 60_000,
  );
  const candidates = await prisma.fiatOrder.findMany({
    where: {
      status: { in: ['pending', 'processing'] },
      updatedAt: { lt: staleBefore },
    },
    select: {
      id: true,
      orderId: true,
      provider: true,
      status: true,
      txHash: true,
      cryptoAmount: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: POLL_BATCH_LIMIT,
  });

  if (candidates.length === 0) {
    return 0;
  }

  let reconciled = 0;
  for (const order of candidates) {
    const providerOrderId = order.orderId ?? order.id;

    // Fail-closed fetch: any error, timeout or unexpected shape returns
    // null and the order is left untouched until the next sweep.
    let rawStatus: string | null = null;
    if (order.provider === 'moonpay') {
      const fetched = await MoonPayService.fetchTransactionStatus(providerOrderId);
      rawStatus = fetched ? fetched.status : null;
    } else {
      const fetched = await OnrampService.fetchOrderStatus(providerOrderId);
      rawStatus = fetched ? fetched.status : null;
    }
    if (rawStatus === null) {
      continue;
    }

    // MoonPay's in-progress vocabulary must be normalized before mapping;
    // Onramp.money statuses already speak our vocabulary.
    const normalized =
      order.provider === 'moonpay' ? MoonPayService.normalizeStatus(rawStatus) : rawStatus;
    const nextStatus = mapProviderPollingStatus(normalized);
    if (nextStatus === null || nextStatus === order.status) {
      continue;
    }

    const result = await applyOnrampStatusTransition(order, nextStatus);
    if (result === 'applied') {
      reconciled += 1;
      logger.info(
        {
          event: 'onramp_status_polled',
          orderId: order.id,
          provider: order.provider,
          previousStatus: order.status,
          nextStatus,
        },
        `Polled order ${order.id} to ${nextStatus}`,
      );
    }
  }

  if (reconciled > 0) {
    console.log(`[OnrampStatusPoller] Reconciled ${reconciled} stale order(s)`);
  }
  return reconciled;
}
