/**
 * Audit pipeline error types.
 *
 * `AuditAbortError` is the single error class that triggers the Pass 4 abort
 * writer (`d:\Veilpay\plans\.audit-evidence\ABORT.md`) and skips all other
 * Audit_Report deliverables. It is thrown from Pass 1 (Discovery) when a
 * hard precondition fails — for example, `git rev-parse HEAD` exiting
 * non-zero — and from any later pass that detects an unrecoverable state
 * the audit cannot honestly finish without falsifying.
 *
 * The error carries the four fields the abort writer needs:
 *
 *   - `command`     The exact failing command line (e.g. `"git rev-parse HEAD"`).
 *   - `exitCode`    The integer exit code from the failing process.
 *   - `outputTail`  Up to the last 50 lines of the failing process's combined
 *                   stdout/stderr. Length is bounded by the `runCommand`
 *                   harness (`MAX_TAIL_LINES`); the constructor does not
 *                   enforce the cap so callers may pre-trim if needed.
 *   - `capturedAt`  ISO 8601 timestamp at which the failure was captured.
 *
 * All four fields are required because the abort writer (task 6.5) renders
 * them verbatim into `ABORT.md`. They are also surfaced in the audit
 * report's failure-capture blocks where applicable.
 */

export interface AuditAbortPayload {
  readonly command: string;
  readonly exitCode: number;
  readonly outputTail: readonly string[];
  readonly capturedAt: string;
}

/**
 * Hard-abort error thrown by audit passes when a precondition fails.
 *
 * Extends `Error` with the abort-writer payload. The default message
 * summarizes the failure for stack traces; callers may override it via the
 * second constructor argument when a more specific phrase is helpful.
 */
export class AuditAbortError extends Error {
  /** The exact failing command line. */
  readonly command: string;
  /** Integer exit code from the failing process. */
  readonly exitCode: number;
  /** Up to 50 trailing lines of combined stdout/stderr. */
  readonly outputTail: readonly string[];
  /** ISO 8601 timestamp at which the failure was captured. */
  readonly capturedAt: string;

  constructor(payload: AuditAbortPayload, message?: string) {
    super(
      message ??
        `Audit aborted: '${payload.command}' exited with code ${payload.exitCode} at ${payload.capturedAt}`,
    );
    this.name = 'AuditAbortError';
    this.command = payload.command;
    this.exitCode = payload.exitCode;
    // Defensive copy so later mutations of the source array don't leak in.
    this.outputTail = Object.freeze([...payload.outputTail]);
    this.capturedAt = payload.capturedAt;
    // Restore prototype chain for `instanceof` to work across module
    // boundaries when the class is transpiled to ES5-style targets.
    Object.setPrototypeOf(this, AuditAbortError.prototype);
  }
}

/**
 * Type guard for `AuditAbortError`. Useful in pass orchestrators that
 * `try`/`catch` around `runDiscovery` and need to branch on the abort path
 * without disturbing other thrown errors.
 */
export function isAuditAbortError(err: unknown): err is AuditAbortError {
  return err instanceof AuditAbortError;
}
