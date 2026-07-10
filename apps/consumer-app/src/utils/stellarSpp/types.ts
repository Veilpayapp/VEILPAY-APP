/**
 * Shared types for the Stellar Private Payments client surface.
 */

import type { SppDeploymentConfig } from '../../constants/spp';

export type SppOpStatus =
  | 'idle'
  | 'preparing'
  | 'proving'
  | 'signing'
  | 'submitted'
  | 'confirmed'
  | 'failed';

export type SppNativeCapabilities = {
  /** Crate / stub version string. */
  version: string;
  /** Hello-world ping works. */
  ping: boolean;
  /**
   * True when native module can run real pool ops (deposit/transfer/withdraw).
   * Phase 1 scaffold: false until Nitro/UniFFI wires `sdk/pool`.
   */
  poolOps: boolean;
  /** True when ASP membership leaf helper is available natively. */
  aspLeaf: boolean;
  /** Backend label for diagnostics (`js-stub` | `native`). */
  backend: 'js-stub' | 'native';
};

export type SppTxResult = {
  txHash: string;
  explorerUrl?: string;
};

export type SppTransferRecipient =
  | { kind: 'address'; stellarAddress: string }
  | { kind: 'keys'; notePublicKey: string; encryptionPublicKey: string };

export type SppClientContext = {
  chainKey: string;
  ownerAddress: string;
  config: SppDeploymentConfig;
};

export class SppClientError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SppClientError';
    this.code = code;
  }
}
