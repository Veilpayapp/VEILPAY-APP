/**
 * VeilPay — Stellar Private Payments (SPP) contract config
 *
 * Testnet IDs come from the vendored Nethermind deployment:
 *   packages/vendor/spp/deployments/testnet/deployments.json
 *
 * Mainnet is intentionally **fail-closed**: no contract IDs until audit +
 * ceremony + explicit product go-ahead. Callers must use
 * {@link getSppConfigForChain} / {@link assertSppEnabled} so mainnet never
 * silently hits testnet contracts or an empty deployment.
 *
 * @see plans/spp-phase0-findings.md
 * @see plans/stellar-spp-integration-plan.md §4
 */

/** On-chain + RPC surface for one SPP deployment (one network). */
export interface SppDeploymentConfig {
  /** Chain key in the consumer app (`stellar-testnet` today). */
  chainKey: string;
  /** Human network label for UI / logs (never secrets). */
  network: 'testnet' | 'mainnet';
  /** Horizon HTTP API base (balance / account reads). */
  horizonUrl: string;
  /** Soroban RPC base (pool events + contract invoke). */
  sorobanRpcUrl: string;
  /** Stellar network passphrase for signing. */
  networkPassphrase: string;
  /** Native XLM privacy pool contract id (C…). */
  poolId: string;
  /** Circom Groth16 verifier (BN254) contract id. */
  verifierId: string;
  /** ASP membership Merkle tree contract id. */
  aspMembershipId: string;
  /** ASP non-membership (exclusion) tree contract id. */
  aspNonMembershipId: string;
  /** Public-key registry (G… → note/enc keys) contract id. */
  registryId: string;
  /** Classic asset contract for native XLM on this network. */
  nativeTokenContractId: string;
  /** Explorer base for tx links. */
  explorerBaseUrl: string;
}

/**
 * Live Nethermind testnet deployment (verified Phase 0).
 * Self-deploy only if these contracts age out of RPC event retention (~7d)
 * or lose admin funding.
 */
export const SPP_TESTNET: SppDeploymentConfig = {
  chainKey: 'stellar-testnet',
  network: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  poolId: 'CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH',
  verifierId: 'CCKNCZXDGM7Z7EHL7PVQEYRDK636TZJIDODO5TSAS5BME2JYGMFR3MU3',
  aspMembershipId: 'CDSJXWV5JITIQLXNM4AEI53RY2UQLOQBCG6WKYCFPWS5AHBAD3FWAVNH',
  aspNonMembershipId: 'CBG3BT6KHJM3UQGSUP2GHPQE5FLPEYBFVF47DCDHH6UOYQ6KDT5URJTI',
  registryId: 'CB3IAFWZPU5H5MQ4NEMQCWLZJ6PAYZWLAA4DZIRZZCWXSI2WV6C7L556',
  nativeTokenContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  explorerBaseUrl: 'https://stellar.expert/explorer/testnet',
};

/** Chain keys that may expose SPP UI / client entry points. */
export const SPP_ENABLED_CHAIN_KEYS = ['stellar-testnet'] as const;

export type SppEnabledChainKey = (typeof SPP_ENABLED_CHAIN_KEYS)[number];

/**
 * Returns SPP deployment config for a chain key, or `null` when SPP is not
 * available (mainnet, non-Stellar, or not yet configured).
 */
export function getSppConfigForChain(chainKey: string | null | undefined): SppDeploymentConfig | null {
  if (!chainKey) return null;
  if (chainKey === SPP_TESTNET.chainKey) return SPP_TESTNET;
  return null;
}

/**
 * True when the active chain is allowed to use SPP product surfaces.
 * Mainnet Stellar returns false until a mainnet deployment is explicitly added.
 */
export function isSppEnabledForChain(chainKey: string | null | undefined): boolean {
  return getSppConfigForChain(chainKey) !== null;
}

/**
 * Fail-closed preflight for SPP ops and UI.
 *
 * @throws Error with `code: 'SPP_NOT_ENABLED'` when the chain has no SPP config
 *   (includes mainnet by design).
 */
export function assertSppEnabled(chainKey: string | null | undefined): SppDeploymentConfig {
  const config = getSppConfigForChain(chainKey);
  if (!config) {
    const err = new Error(
      chainKey === 'stellar'
        ? 'SPP is not enabled on Stellar mainnet until audit and ceremony gates pass.'
        : `SPP is not configured for chain "${chainKey ?? 'unknown'}". Switch to Stellar Testnet.`
    );
    (err as Error & { code?: string }).code = 'SPP_NOT_ENABLED';
    throw err;
  }
  return config;
}

/** Explorer deep-link for a submitted Soroban/Horizon tx hash. */
export function sppTxExplorerUrl(config: SppDeploymentConfig, txHash: string): string {
  const hash = txHash.replace(/^0x/i, '');
  return `${config.explorerBaseUrl}/tx/${hash}`;
}
