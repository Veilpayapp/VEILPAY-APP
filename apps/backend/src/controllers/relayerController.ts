// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
import type { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";
import {
  WithdrawRequestSchema,
  type WithdrawRequest,
} from "../schemas/withdrawRequest";

/**
 * Module-load-time allowlist of permitted VeilPool contract addresses.
 *
 * The relayer refuses to broadcast a withdraw transaction targeting any
 * address not in this set. Discovery via on-chain reads is intentionally
 * NOT supported because it opens an injection surface; the operator must
 * enumerate every pool the relayer is willing to gas-sponsor.
 *
 * Source: `RELAYER_VEILPOOL_ALLOWLIST` env var, comma-separated checksummed
 * or lowercase 0x-prefixed 20-byte addresses. Invalid entries are
 * logged-and-dropped at startup. An empty allowlist is a valid
 * configuration when the relayer is intentionally disabled (combined with
 * `RELAYER_KEY_CONFIGURED === false`).
 *
 * Validates: Requirement 6.3.
 */
const ADDRESS_REGEX = /^0x[0-9a-f]{40}$/;

function loadAllowlist(): ReadonlySet<string> {
  const raw = (process.env.RELAYER_VEILPOOL_ALLOWLIST ?? "").trim();
  if (raw === "") {
    return Object.freeze(new Set<string>()) as ReadonlySet<string>;
  }
  const entries = raw.split(",").map((s) => s.trim().toLowerCase());
  const valid: string[] = [];
  for (const entry of entries) {
    if (entry === "") continue;
    if (ADDRESS_REGEX.test(entry)) {
      valid.push(entry);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[relayer] discarding invalid allowlist entry: ${entry}`);
    }
  }
  return Object.freeze(new Set(valid)) as ReadonlySet<string>;
}

export const RELAYER_VEILPOOL_ALLOWLIST: ReadonlySet<string> = loadAllowlist();

/**
 * Cached at module load — whether `RELAYER_PRIVATE_KEY` is configured.
 * The handler returns HTTP 503 when this is false.
 *
 * Validates: Requirement 6.5.
 */
export const RELAYER_KEY_CONFIGURED: boolean =
  typeof process.env.RELAYER_PRIVATE_KEY === "string" &&
  process.env.RELAYER_PRIVATE_KEY.trim() !== "";

/**
 * Per-request timeout for the on-chain simulate + broadcast path.
 *
 * Validates: Requirements 6.5, 8.5.
 */
export const RELAYER_TIMEOUT_MS = 30_000;

/**
 * Gas limit applied to every broadcasted withdraw. The on-chain Groth16
 * verification dominates gas usage; 600k is a comfortable ceiling that
 * still fails the simulation cleanly if the proof is invalid.
 */
const RELAYER_GAS_LIMIT = 600_000n;

/**
 * Minimal ABI fragment for `VeilPool.withdraw` plus the four custom errors
 * the pool can revert with. The error fragments are required so ethers v6's
 * `Interface.parseError` can decode the selector returned in the
 * `staticCall` / broadcast revert and surface a human-readable name to
 * the relayer's HTTP 422 response.
 *
 * Public-input ordering for the wrapped Groth16 verifier is enforced inside
 * `VeilPool.withdraw`; see design.md §Public input ordering contract.
 *
 * Validates: Requirements 6.1, 6.6.
 */
export const VEILPOOL_ABI = [
  "function withdraw(bytes32 nullifierHash, bytes proof, bytes32 merkleRoot, address recipient, address token, uint256 amount)",
  "error InvalidMerkleRoot()",
  "error InvalidProof()",
  "error NullifierAlreadySpent()",
  "error TreeFull()",
] as const;

const VEILPOOL_INTERFACE = new ethers.Interface(VEILPOOL_ABI as readonly string[]);

class TimeoutError extends Error {
  constructor() {
    super("relayer broadcast timeout");
    this.name = "TimeoutError";
  }
}

/**
 * Race a promise against a timer that rejects with `TimeoutError` after
 * `RELAYER_TIMEOUT_MS`. The timer is cleared on settle so the event loop
 * can drain.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Best-effort extraction of revert data from an ethers v6 error. Different
 * provider paths surface revert bytes in different shapes (`error.data`,
 * `error.info.error.data`, nested `revert.data`); we probe each location
 * and return the first 0x-hex string we find.
 */
function extractRevertData(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const candidate = err as Record<string, unknown>;

  const direct = candidate.data;
  if (typeof direct === "string" && direct.startsWith("0x")) return direct;

  const revert = candidate.revert as Record<string, unknown> | undefined;
  if (revert && typeof revert.data === "string" && revert.data.startsWith("0x")) {
    return revert.data;
  }

  const info = candidate.info as Record<string, unknown> | undefined;
  const innerError = info?.error as Record<string, unknown> | undefined;
  if (innerError && typeof innerError.data === "string" && innerError.data.startsWith("0x")) {
    return innerError.data;
  }

  const errorField = candidate.error as Record<string, unknown> | undefined;
  if (errorField && typeof errorField.data === "string" && errorField.data.startsWith("0x")) {
    return errorField.data;
  }

  return undefined;
}

/**
 * Map an ethers v6 revert error to the user-facing reason string returned in
 * the HTTP 422 body. Resolution order:
 *   1. Custom-error decode via `VEILPOOL_INTERFACE.parseError` → error name.
 *   2. ethers' built-in `reason` (string-revert path).
 *   3. Generic "transaction reverted".
 *
 * The relayer never throws past this function; callers always receive a
 * stable string suitable for the response body.
 *
 * Validates: Requirements 6.6, 6.9.
 */
export function parseRevertReason(err: unknown): string {
  const data = extractRevertData(err);
  if (data !== undefined && data !== "0x") {
    try {
      const parsed = VEILPOOL_INTERFACE.parseError(data);
      if (parsed?.name) return parsed.name;
    } catch (e) {
      console.error("parseError failed:", e, "data was:", data);
    }
  }

  if (err !== null && typeof err === "object") {
    const reason = (err as { reason?: unknown }).reason;
    if (typeof reason === "string" && reason.length > 0) return reason;
    const shortMessage = (err as { shortMessage?: unknown }).shortMessage;
    if (typeof shortMessage === "string" && shortMessage.length > 0) return shortMessage;
  }

  return "transaction reverted";
}

/**
 * Build a fresh ethers v6 signer for the current request from
 * `RELAYER_PRIVATE_KEY` and `RELAYER_RPC_URL`. Throws when either env is
 * missing — the caller has already gated on `RELAYER_KEY_CONFIGURED`, so a
 * missing RPC URL is a real configuration bug worth surfacing as 503.
 */
function buildSigner(): ethers.Wallet {
  const privateKey = process.env.RELAYER_PRIVATE_KEY;
  const rpcUrl = process.env.RELAYER_RPC_URL;
  if (!privateKey || privateKey.trim() === "") {
    throw new Error("RELAYER_PRIVATE_KEY is not configured");
  }
  if (!rpcUrl || rpcUrl.trim() === "") {
    throw new Error("RELAYER_RPC_URL is not configured");
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Run the on-chain simulation followed (only on success) by the broadcast.
 * The relayer never broadcasts after a failed simulation, which guarantees
 * Requirement 6.9 (no gas consumed for an invalid proof).
 */
async function simulateThenBroadcast(
  body: WithdrawRequest,
  signer: ethers.Wallet
): Promise<{ hash: string }> {
  const pool = new ethers.Contract(body.contractAddress, VEILPOOL_ABI as readonly string[], signer);
  const args: [string, string, string, string, string, bigint] = [
    body.nullifierHash,
    body.proof,
    body.merkleRoot,
    body.recipient,
    body.token,
    BigInt(body.amount),
  ];

  // Pre-broadcast simulation. A revert here means the proof or pool state
  // is invalid; we surface the custom-error name and never spend gas.
  await pool.withdraw.staticCall(...args);

  const tx = (await pool.withdraw(...args, { gasLimit: RELAYER_GAS_LIMIT })) as {
    hash: string;
  };
  return { hash: tx.hash };
}

/**
 * `POST /api/v1/relayer/withdraw` handler.
 *
 * Calls `VeilPool.withdraw` directly via ethers v6; the relayer never calls
 * `Groth16Verifier.verifyProof` itself — verification is the pool's job
 * (Requirement 6.2).
 *
 * Status-code surface:
 *   - 200 success                          { success: true, txHash }
 *   - 400 schema validation                { error: 'validation', details }
 *   - 400 contract not allowlisted         { error: 'contract not allowlisted' }
 *   - 422 simulation/broadcast revert      { success: false, error }
 *   - 503 relayer key unset                { error: 'Relayer not configured' }
 *   - 504 simulation/broadcast timeout     { success: false, error: 'relayer broadcast timeout' }
 *
 * Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.9.
 */
export async function handleWithdraw(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  if (!RELAYER_KEY_CONFIGURED) {
    res.status(503).json({ error: "Relayer not configured" });
    return;
  }

  const parsed = WithdrawRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  if (!RELAYER_VEILPOOL_ALLOWLIST.has(body.contractAddress.toLowerCase())) {
    res.status(400).json({ error: "contract not allowlisted" });
    return;
  }

  let signer: ethers.Wallet;
  try {
    signer = buildSigner();
  } catch {
    // Treat any signer-construction failure as a 503: configuration is
    // incomplete (e.g. missing RPC URL) even though the key was set.
    res.status(503).json({ error: "Relayer not configured" });
    return;
  }

  try {
    const { hash } = await withTimeout(
      simulateThenBroadcast(body, signer),
      RELAYER_TIMEOUT_MS
    );
    res.status(200).json({ success: true, txHash: hash });
    return;
  } catch (err) {
    if (err instanceof TimeoutError) {
      res.status(504).json({ success: false, error: "relayer broadcast timeout" });
      return;
    }
    const reason = parseRevertReason(err);
    res.status(422).json({ success: false, error: reason });
    return;
  }
}

/**
 * Route-compatible alias. The router imports `withdraw` from this module;
 * keeping that name preserves the existing wiring while the design doc and
 * tests refer to `handleWithdraw`.
 */
export const withdraw = handleWithdraw;
