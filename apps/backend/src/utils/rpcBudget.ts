/**
 * SEC-001: budget circuit-breaker for the unauthenticated RPC proxy
 * (`/api/v1/rpc/:chainKey`).
 *
 * The proxy injects metered Alchemy/Infura keys server-side, so an attacker who
 * discovers the endpoint could otherwise burn provider credits. The IP-anchored
 * `rpcRateLimiter` bounds per-caller throughput; this module adds two
 * process-/fleet-wide protections on top:
 *
 *  1. Daily budget — a hard cap on total upstream calls per UTC day. Once
 *     exhausted the proxy fails closed (503) until the day rolls over, so a
 *     distributed abuse campaign across many IPs cannot run up an unbounded bill.
 *
 *  2. Failure circuit breaker — trips after a run of consecutive upstream
 *     failures (provider 429s, 5xx, network/timeouts) and opens for a short
 *     cooldown, so we stop hammering a throttled or failing provider (which is
 *     both what earns escalating 429s and what wastes credits on doomed calls).
 *
 * Both breaches raise a throttled ops alert (see `./alerting`). Redis is the
 * source of truth for the daily counter (shared across replicas); an in-memory
 * counter is used as a degraded fallback when Redis is unavailable.
 */

import { getRedisClient } from '../lib/redis';
import { sendOpsAlert } from './alerting';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number((raw ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Default upstream calls per UTC day before the proxy fails closed. */
const DEFAULT_DAILY_BUDGET = 200_000;
let dailyBudget = parsePositiveInt(process.env.RPC_DAILY_BUDGET, DEFAULT_DAILY_BUDGET);

/** Consecutive upstream failures before the circuit opens. */
const CIRCUIT_TRIP_AT = 20;
/** How long the circuit stays open once tripped. */
const CIRCUIT_COOLDOWN_MS = 2 * 60 * 1000;
/** Redis TTL for a day's counter — long enough to survive the day, then GC'd. */
const BUDGET_KEY_TTL_SEC = 2 * 24 * 60 * 60;

export function getRpcDailyBudget(): number {
  return dailyBudget;
}

/** UTC calendar day, e.g. `2026-07-14`. */
function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── In-memory fallback counter (used only when Redis is down) ────────────────
let memDay = currentDay();
let memCount = 0;

function memConsume(): number {
  const day = currentDay();
  if (day !== memDay) {
    memDay = day;
    memCount = 0;
  }
  memCount += 1;
  return memCount;
}

async function incrementDailyCounter(): Promise<number> {
  const key = `rpc:budget:${currentDay()}`;
  const redis = getRedisClient();
  if (!redis) return memConsume();
  try {
    const n = await redis.incr(key);
    if (n === 1) {
      await redis.expire(key, BUDGET_KEY_TTL_SEC);
    }
    return n;
  } catch {
    return memConsume();
  }
}

export interface RpcBudgetResult {
  ok: boolean;
  count: number;
  budget: number;
}

/**
 * Consume one unit of the daily budget. Call immediately before dispatching an
 * upstream request. Returns `ok: false` once the day's cap is exceeded; the
 * first breach of the window raises an ops alert.
 */
export async function consumeRpcBudget(): Promise<RpcBudgetResult> {
  const count = await incrementDailyCounter();
  const ok = count <= dailyBudget;
  if (!ok && count === dailyBudget + 1) {
    // Fire exactly once at the moment of breach; `sendOpsAlert` also throttles.
    sendOpsAlert('rpc.budget.exhausted', `Daily RPC upstream budget of ${dailyBudget} exhausted`, {
      context: { budget: dailyBudget, count },
    });
  }
  return { ok, count, budget: dailyBudget };
}

// ── Failure circuit breaker ──────────────────────────────────────────────────
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export function noteRpcSuccess(): void {
  consecutiveFailures = 0;
}

/** Record an upstream failure (429 / 5xx / network / timeout). Trips the circuit at the threshold. */
export function noteRpcFailure(reason: string): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_TRIP_AT) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    consecutiveFailures = 0;
    sendOpsAlert(
      'rpc.circuit.open',
      `RPC upstream circuit opened after ${CIRCUIT_TRIP_AT} consecutive failures`,
      { context: { lastReason: reason, cooldownMs: CIRCUIT_COOLDOWN_MS } }
    );
  }
}

export function isRpcCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

/**
 * Classify an upstream HTTP status and update breaker state. A provider 429 or
 * 5xx counts as a failure (and raises a throttled alert); anything else counts
 * as a success and resets the consecutive-failure run.
 */
export function recordUpstreamStatus(status: number, chainKey: string): void {
  if (status === 429) {
    sendOpsAlert('rpc.upstream.429', `Upstream RPC returned 429 (rate limited) for chain=${chainKey}`, {
      context: { chainKey, status },
    });
    noteRpcFailure('provider_429');
    return;
  }
  if (status >= 500) {
    sendOpsAlert('rpc.upstream.5xx', `Upstream RPC returned ${status} for chain=${chainKey}`, {
      context: { chainKey, status },
    });
    noteRpcFailure('provider_5xx');
    return;
  }
  noteRpcSuccess();
}

/** Test helpers. */
export const __test = {
  reset(): void {
    memDay = currentDay();
    memCount = 0;
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
    dailyBudget = parsePositiveInt(process.env.RPC_DAILY_BUDGET, DEFAULT_DAILY_BUDGET);
  },
  setDailyBudget(n: number): void {
    dailyBudget = n;
  },
  CIRCUIT_TRIP_AT,
  CIRCUIT_COOLDOWN_MS,
  DEFAULT_DAILY_BUDGET,
};
