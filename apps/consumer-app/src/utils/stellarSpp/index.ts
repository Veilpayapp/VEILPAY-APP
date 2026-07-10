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
  deposit,
  transfer,
  withdraw,
  ensureAspMembership,
  prepareSppOp,
  withExplorer,
  type AspMembershipStatus,
  type SppPrepChecklist,
} from './sppClient';

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
  type SppNativeOpResult,
  type SppNativeModule,
} from './sppNativeBridge';

export {
  ensurePoolSession,
  closePoolSession,
  getSppCircuitsDir,
  SPP_TESTNET_CONTRACT_CONFIG,
} from './sppPoolSession';

export {
  runShieldTransferUnshield,
  planLifecycleAmounts,
  type SppLifecycleParams,
  type SppLifecycleResult,
  type SppLifecycleStep,
} from './sppLifecycle';

export {
  SppClientError,
  type SppOpStatus,
  type SppNativeCapabilities,
  type SppTxResult,
  type SppTransferRecipient,
  type SppClientContext,
} from './types';
