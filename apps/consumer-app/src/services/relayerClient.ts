// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
//
// Relayer HTTP client — Layer 4 → Layer 3 hop.
// ============================================
// This module is the *only* surface in the consumer app that talks to the
// relayer's `POST /api/v1/relayer/withdraw` endpoint. It wraps `fetch` with:
//
//   1. A 30-second `AbortController` timeout (Requirement 8.5).
//   2. A local validation gate that mirrors the relayer's
//      `WithdrawRequestSchema` so we fail fast in the UI before we ever
//      hit the network (Requirement 8.2).
//   3. A typed `RelayerError` taxonomy that distinguishes HTTP non-2xx,
//      timeout, network failure, configuration drift, and local
//      schema-validation failures so callers (i.e. `usePaymentTransaction`'s
//      `'max'` branch) can map each kind onto a meaningful UI state
//      (Requirement 8.1).
//
// The shape of `WithdrawRequest` here is imported from the consumer-app
// schema mirror (`apps/consumer-app/src/schemas/withdrawRequest.ts`), which
// is kept byte-identical to the backend schema. That mirror is the
// compile-time source of truth — see tasks.md §9.3.
import { WithdrawRequestSchema, type WithdrawRequest } from '../schemas/withdrawRequest';

const RELAYER_BASE_URL: string =
  (process.env.EXPO_PUBLIC_RELAYER_BASE_URL as string | undefined) ?? '';

const TIMEOUT_MS = 30_000;

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

/**
 * Discriminator for `RelayerError`. Each kind maps onto a distinct UI surface:
 *
 *  - `'http'`        — the relayer responded with a non-2xx status. `status`
 *                      and `body` carry the structured payload so the UI can
 *                      render the relayer's own message (e.g. validation
 *                      failure, allowlist rejection, on-chain revert).
 *  - `'timeout'`     — the request was aborted after `TIMEOUT_MS` without an
 *                      HTTP response (Requirement 8.5).
 *  - `'network'`     — `fetch` itself rejected before any HTTP layer was
 *                      reached (DNS, TLS, offline, etc.).
 *  - `'config'`      — `EXPO_PUBLIC_RELAYER_BASE_URL` is unset; we refuse to
 *                      issue a request rather than POST to a relative URL.
 *  - `'validation'`  — the body failed the local `WithdrawRequestSchema`
 *                      gate; this should be impossible if callers route
 *                      through the dispatcher correctly, but guarding here
 *                      keeps Requirement 8.2 a hard invariant.
 */
export type RelayerErrorKind = 'http' | 'timeout' | 'network' | 'config' | 'validation';

export class RelayerError extends Error {
  readonly kind: RelayerErrorKind;
  readonly status?: number;
  readonly body?: unknown;

  constructor(
    kind: RelayerErrorKind,
    message: string,
    opts?: { status?: number; body?: unknown }
  ) {
    super(message);
    this.name = 'RelayerError';
    this.kind = kind;
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

/**
 * Successful relayer response shape.
 *
 * The relayer guarantees `{ success: true, txHash: <0x hex 66 chars> }` on
 * the 2xx path (Requirement 6.7). We re-validate the shape here so that a
 * relayer regression cannot smuggle a malformed `txHash` into the payment
 * dispatcher's polling step.
 */
export interface RelayerSuccess {
  success: true;
  txHash: `0x${string}`;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * POSTs a withdraw request to the relayer.
 *
 * @throws {RelayerError} of kind `'config'` when `EXPO_PUBLIC_RELAYER_BASE_URL` is unset.
 * @throws {RelayerError} of kind `'validation'` when the body fails the local schema gate.
 * @throws {RelayerError} of kind `'http'` when the relayer responds non-2xx or with a malformed success body.
 * @throws {RelayerError} of kind `'timeout'` when the request exceeds {@link TIMEOUT_MS}.
 * @throws {RelayerError} of kind `'network'` when `fetch` itself rejects.
 */
export async function submitWithdraw(body: WithdrawRequest): Promise<RelayerSuccess> {
  if (RELAYER_BASE_URL === '') {
    throw new RelayerError(
      'config',
      'EXPO_PUBLIC_RELAYER_BASE_URL is not configured'
    );
  }

  const parsed = WithdrawRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new RelayerError(
      'validation',
      'withdraw request body failed local validation',
      { body: parsed.error.flatten() }
    );
  }

  const url = `${RELAYER_BASE_URL.replace(/\/+$/, '')}/api/v1/relayer/withdraw`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: ctrl.signal,
    });

    const text = await res.text();
    const json = safeJsonParse(text);

    if (!res.ok) {
      throw new RelayerError('http', `relayer responded ${res.status}`, {
        status: res.status,
        body: json,
      });
    }

    const success = json as { success?: unknown; txHash?: unknown };
    if (
      success.success !== true ||
      typeof success.txHash !== 'string' ||
      !TX_HASH_RE.test(success.txHash)
    ) {
      throw new RelayerError('http', 'relayer success response was malformed', {
        status: res.status,
        body: json,
      });
    }

    return { success: true, txHash: success.txHash as `0x${string}` };
  } catch (err) {
    if (err instanceof RelayerError) throw err;

    if ((err as { name?: string } | null)?.name === 'AbortError') {
      throw new RelayerError(
        'timeout',
        `relayer request timed out after ${TIMEOUT_MS}ms`
      );
    }

    const msg = err instanceof Error ? err.message : String(err);
    throw new RelayerError('network', msg);
  } finally {
    clearTimeout(timer);
  }
}
