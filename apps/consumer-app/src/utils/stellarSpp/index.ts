export {
  SPP_TESTNET,
  SPP_ENABLED_CHAIN_KEYS,
  getSppConfigForChain,
  isSppEnabledForChain,
  assertSppEnabled,
  sppTxExplorerUrl,
  type SppDeploymentConfig,
} from '../../constants/spp';

export {
  getSppStatus,
  getLocalPrivateBalance,
  recoverSppNotesFromChain,
  deposit,
  transfer,
  withdraw,
  ensureAspMembership,
  prepareSppOp,
  gatingSppBlocker,
  withExplorer,
  type AspMembershipStatus,
  type SppPrepChecklist,
  type SppNoteRecoveryResult,
  type SppOperationStage,
  type SppOperationProgressStatus,
  type SppOperationProgressEvent,
  type SppOperationOptions,
} from './sppClient';

export {
  XLM_STROOPS,
  STELLAR_CLASSIC_FEE_STROOPS,
  SPP_TRANSACT_FEE_CEILING_STROOPS,
  stroopsToXlm,
  sppPlannedTxCount,
  sppFeeCeilingStroops,
} from './sppFees';

export {
  recoverSppNotesCoordinated,
  refreshPrivateBalanceSmart,
  readLocalPrivateBalanceLight,
  hasRecoveredThisSession,
  getLastKnownPrivateAmount,
  setLastKnownPrivateAmount,
  resetSppRecoverySession,
  type CoordinatedRecoverOptions,
} from './sppRecoveryCoordinator';

export {
  SPP_KEY_DERIVATION_MESSAGE,
  signSppKeyDerivationMessage,
  recordSppKeySignature,
  insertAspMembershipLeaf,
  onboardSppAccount,
  ensureSppAccountReady,
  probeAspMembershipRoot,
  type SppOnboardResult,
} from './sppOnboard';

export {
  sppNativeVersion,
  sppNativePing,
  sppNativeCapabilities,
  setSppNativeBackend,
  sppNativeDeposit,
  sppNativeTransfer,
  sppNativeWithdraw,
  sppNativeEnsureAsp,
  sppNativePoolReadiness,
  sppNativePoolOpen,
  sppNativePoolClose,
  sppNativePoolSync,
  sppNativePoolBalance,
  type SppNativeOpResult,
  type SppNativeModule,
} from './sppNativeBridge';

export {
  clearSppDiagnostics,
  exportSppDiagnostics,
  getSppDiagnostics,
  recordSppDiagnostic,
  runWithSppDiagnostics,
  sanitizeSppDiagnosticText,
  type SppDiagnosticRecord,
  type SppDiagnosticStatus,
} from './sppDiagnostics';

export {
  ensurePoolSession,
  closePoolSession,
  getSppCircuitsDir,
  contractConfigFor,
} from './sppPoolSession';

export { getCircuitsReadiness, type CircuitsReadiness } from './sppCircuits';

export {
  runShieldTransferUnshield,
  planLifecycleAmounts,
  type SppLifecycleParams,
  type SppLifecycleResult,
  type SppLifecycleStep,
} from './sppLifecycle';

export {
  createSppActivityRecord,
  getSppActivityTitle,
  getSppActivitySubtitle,
  isSppActivityRecord,
  type CreateSppActivityRecordParams,
} from './sppActivity';

export {
  SppClientError,
  type SppOpStatus,
  type SppNativeCapabilities,
  type SppTxResult,
  type SppTransferRecipient,
  type SppClientContext,
} from './types';
