export interface ValidationService {
  isMethodAllowed(method: string, chainKey: string): boolean;
}

// In the future, this could fetch from a DB or centralized config
const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  'eth_getBalance', 'eth_call', 'eth_blockNumber', 'eth_chainId',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_getLogs', 'eth_getCode', 'eth_getStorageAt',
  'eth_gasPrice', 'eth_estimateGas', 'eth_getTransactionCount',
  'eth_feeHistory', 'eth_maxPriorityFeePerGas',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBlockReceipts',
  'eth_getBlockTransactionCountByNumber', 'eth_getBlockTransactionCountByHash',
  'eth_getUncleByBlockNumberAndIndex', 'eth_getUncleCountByBlockNumber',
  'net_version', 'net_listening', 'net_peerCount',
  'web3_clientVersion',
  'alchemy_getTokenBalances', 'alchemy_getTokenMetadata',
  'alchemy_getAssetTransfers', 'alchemy_getTokenAllowance',
  'getBalance', 'getTokenAccountsByOwner', 'getAccountInfo',
  'getSlot', 'getSlotLeader', 'getLatestBlockhash', 'getBlock',
  'getSignatureStatuses', 'getTransaction', 'getSignaturesForAddress',
  'getTokenAccountBalance', 'getEpochInfo', 'getHealth', 'getVersion',
  'getInflationGovernor', 'getInflationRate', 'getSupply',
  'getMinimumBalanceForRentExemption', 'getRecentPerformanceSamples',
]);

export const validationService: ValidationService = {
  isMethodAllowed: (method: string) => ALLOWED_RPC_METHODS.has(method),
};
