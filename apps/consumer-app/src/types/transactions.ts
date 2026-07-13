export type TransactionType = 'sent' | 'received';

export type TransactionStatus = 'completed' | 'pending' | 'failed';

export type SppActivityOp = 'shield' | 'transfer' | 'unshield';

export interface TransactionRecord {
  id: string;
  type: TransactionType;
  amount: string;
  token: string;
  tokenSymbol: string;
  from: string;
  to: string;
  timestamp: number;
  status: TransactionStatus;
  hash: string;
  privacyLevel?: 'standard' | 'stealth' | 'max' | 'private';

  /** Stellar Private Payments pool operation metadata for local, demo-clean activity rows. */
  sppOp?: SppActivityOp;
  /** User-facing title that can replace raw counterparty addresses in lists. */
  displayTitle?: string;
  /** User-facing context line, intentionally avoiding proof/nullifier/encrypted-output data. */
  displaySubtitle?: string;
  /** Explorer CTA copy for transactions whose public explorer view is a pool proof call. */
  explorerLabel?: string;
  /** True for locally summarized SPP Soroban privacy-pool invocations. */
  isPrivatePoolTx?: boolean;

  fee?: string;
  network?: string;
}
