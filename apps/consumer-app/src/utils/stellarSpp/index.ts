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
  withExplorer,
  type AspMembershipStatus,
  type SppPrepChecklist,
  type SppNoteRecoveryResult,
} from './sppClient';

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
