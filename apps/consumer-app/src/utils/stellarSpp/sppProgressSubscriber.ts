/**
 * Veilpay SPP progress subscriber.
 *
 * Wraps {@link recordSppDiagnostic} so every diagnostic record updates a
 * sequential 5-stage progress model. The confirm screen subscribes to this
 * model to render the {@link ShieldProgressModal} in real time.
 *
 * Stage mapping (step or operation name, `native:` prefix stripped):
 *
 *   derive_keys      → derive_keys
 *   pool_open, pool_sync, pool_sync_failover → sync_pool
 *   prove, ensure_circuit_assets, generate_proof, pool_readiness → generate_proof
 *   transfer, deposit, withdraw, submit, transact, shield, unshield → submit_tx
 *   success, confirmed → confirmed
 *
 * Stages are sequential: a later stage stays 'pending' until the immediately
 * preceding stage reaches 'success'.
 */

import {
  recordSppDiagnostic as persistRecord,
  type NewSppDiagnosticRecord,
} from './sppDiagnostics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SppProgressStage =
  | 'derive_keys'
  | 'sync_pool'
  | 'generate_proof'
  | 'submit_tx'
  | 'confirmed';

export type SppProgressStatus = 'pending' | 'active' | 'success' | 'error';

export interface SppProgressState {
  stage: SppProgressStage;
  status: SppProgressStatus;
  message?: string;
}

type Listener = (state: SppProgressState[]) => void;

// ---------------------------------------------------------------------------
// Stages in order; used for sequential gating.
// ---------------------------------------------------------------------------

const STAGE_ORDER: SppProgressStage[] = [
  'derive_keys',
  'sync_pool',
  'generate_proof',
  'submit_tx',
  'confirmed',
];

// ---------------------------------------------------------------------------
// Step-name → stage mapping.  Strip `native:` prefix before lookup.
// ---------------------------------------------------------------------------

const STEP_TO_STAGE: Record<string, SppProgressStage> = {
  // derive_keys
  derive_keys: 'derive_keys',

  // sync_pool
  pool_open: 'sync_pool',
  pool_sync: 'sync_pool',
  pool_sync_failover: 'sync_pool',

  // generate_proof
  prove: 'generate_proof',
  ensure_circuit_assets: 'generate_proof',
  generate_proof: 'generate_proof',
  pool_readiness: 'generate_proof',

  // submit_tx
  shield: 'submit_tx',
  transfer: 'submit_tx',
  unshield: 'submit_tx',
  deposit: 'submit_tx',
  withdraw: 'submit_tx',
  submit: 'submit_tx',
  transact: 'submit_tx',
};

/**
 * Resolve a diagnostic record to a progress stage, or `null` when the
 * step / operation doesn't match any known mapping.
 */
function resolveStage(record: NewSppDiagnosticRecord): SppProgressStage | null {
  const stepRaw = (record.step ?? '').replace(/^native:/, '');
  const opRaw = record.operation ?? '';

  // Explicit `success` / `confirmed` records land on the final stage.
  const lowered = stepRaw.toLowerCase();
  if (lowered === 'confirmed' || lowered === 'success') {
    return 'confirmed';
  }

  // Try step first, then operation.
  const fromStep = STEP_TO_STAGE[lowered];
  if (fromStep) return fromStep;

  const fromOp = STEP_TO_STAGE[opRaw.toLowerCase()];
  if (fromOp) return fromOp;

  // Stage names themselves (`submit_tx`) can also be reported directly.
  if (STAGE_ORDER.includes(lowered as SppProgressStage)) {
    return lowered as SppProgressStage;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
// Module-level mutable state is intentional: it is a session-scoped singleton
// (resets on app kill) shared by the confirm screen and the modal. Re-entering
// the screen resets it via `resetSppProgress()` on mount/idle, so stale stages
// from a previous instance never persist.

const listeners = new Set<Listener>();

let stageState: SppProgressState[] = STAGE_ORDER.map((stage) => ({
  stage,
  status: 'pending' as SppProgressStatus,
}));

/**
 * Return a snapshot of the current progress state.
 */
function currentState(): SppProgressState[] {
  return stageState.map((s) => ({ ...s }));
}

function notifyListeners(): void {
  const snapshot = currentState();
  for (const cb of listeners) {
    try {
      cb(snapshot);
    } catch {
      /* subscriber errors must not break the payment path */
    }
  }
}

/**
 * Reset all stages to `'pending'` and notify subscribers so mounted modals
 * re-render immediately (no stale-state window before the first record).
 */
export function resetSppProgress(): void {
  stageState = STAGE_ORDER.map((stage) => ({
    stage,
    status: 'pending',
  }));
  notifyListeners();
}

// ---------------------------------------------------------------------------
// Progress update from a diagnostic record
// ---------------------------------------------------------------------------

function toErrorText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return String(value);
  } catch {
    return undefined;
  }
}

function applyRecord(record: NewSppDiagnosticRecord): void {
  const stageName = resolveStage(record);
  if (!stageName) return;

  const idx = STAGE_ORDER.indexOf(stageName);
  if (idx < 0) return;

  const current = stageState[idx];
  if (!current) return;

  const newStatus: SppProgressStatus =
    record.status === 'success'
      ? 'success'
      : record.status === 'error'
        ? 'error'
        : 'active';

  // Never regress a completed stage.
  if (current.status === 'success') return;

  // A later-stage success implies every preceding stage completed — cascade
  // them to success so the modal never shows a stale spinner behind a
  // finished submit/confirmed stage.
  if (newStatus === 'success') {
    for (let i = 0; i < idx; i++) {
      if (stageState[i].status !== 'success') {
        stageState[i] = { ...stageState[i], status: 'success' };
      }
    }
  }

  // Sequential UI progression: a stage only becomes active once the preceding
  // stage has succeeded. (Success/error records are never blocked — a later
  // completion or failure always lands.)
  if (
    newStatus === 'active' &&
    idx > 0 &&
    stageState[idx - 1].status !== 'success'
  ) {
    return;
  }

  stageState[idx] = {
    stage: stageName,
    status: newStatus,
    message:
      record.status === 'error'
        ? toErrorText(record.message ?? record.rawError)
        : undefined,
  };

  notifyListeners();
}

// ---------------------------------------------------------------------------
// Wrapped `recordSppDiagnostic`
// ---------------------------------------------------------------------------

/**
 * Record a diagnostic AND update the SPP progress stage state.
 *
 * Wraps the original {@link recordSppDiagnostic} from `sppDiagnostics` so a
 * single call persists the record to AsyncStorage *and* fans out live stage
 * updates to subscribers of {@link subscribeSppProgress}. Named distinctly so
 * it is never confused with the raw diagnostic writer.
 *
 * @returns A promise that settles after the storage write completes.
 */
export function recordSppProgressDiagnostic(
  input: NewSppDiagnosticRecord
): Promise<void> {
  try {
    applyRecord(input);
  } catch {
    /* diagnostics must never break the payment path */
  }

  return persistRecord(input);
}

// ---------------------------------------------------------------------------
// Public subscription API
// ---------------------------------------------------------------------------

/**
 * Subscribe to SPP progress stage updates.
 *
 * The callback is invoked synchronously with a snapshot of the current stage
 * state whenever a diagnostic record changes the stage model. When the caller
 * first subscribes they receive the current state immediately.
 *
 * @returns An unsubscribe function. Call it when the component unmounts.
 */
export function subscribeSppProgress(cb: Listener): () => void {
  listeners.add(cb);

  // Initial snapshot
  try {
    cb(currentState());
  } catch {
    /* subscriber errors must not break the payment path */
  }

  return () => {
    listeners.delete(cb);
  };
}

/**
 * Remove a previously-registered listener. Safe to call even if the listener
 * was never registered.
 *
 * NOTE: the primary consumption path uses the unsubscribe function returned by
 * {@link subscribeSppProgress}; this direct form is kept for API completeness.
 */
export function unsubscribeSppProgress(cb: Listener): void {
  listeners.delete(cb);
}
