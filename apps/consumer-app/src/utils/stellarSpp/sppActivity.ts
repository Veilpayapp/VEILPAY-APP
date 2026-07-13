import type { SppActivityOp, TransactionRecord } from '../../types/transactions';

const SPP_POOL_LABEL = 'SPP Pool';

const SPP_ACTIVITY_TITLES: Record<SppActivityOp, string> = {
  shield: 'SHIELDED XLM',
  transfer: 'PRIVATE TRANSFER',
  unshield: 'UNSHIELDED XLM',
};

const SPP_ACTIVITY_SUBTITLES: Record<SppActivityOp, string> = {
  shield: 'Public XLM → private balance',
  transfer: 'Private balance → shielded recipient',
  unshield: 'Private balance → public Stellar address',
};

export interface CreateSppActivityRecordParams {
  op: SppActivityOp;
  txHash: string;
  ownerAddress: string;
  recipient?: string;
  amount: string;
  chainKey: string;
  poolId?: string;
  timestamp?: number;
}

export function getSppActivityTitle(op: SppActivityOp): string {
  return SPP_ACTIVITY_TITLES[op];
}

export function getSppActivitySubtitle(op: SppActivityOp): string {
  return SPP_ACTIVITY_SUBTITLES[op];
}

/**
 * Creates the local activity row for an SPP Soroban pool invocation.
 *
 * The public explorer correctly shows raw contract/proof fields for these
 * transactions. This record is intentionally a UX summary only: it stores the
 * tx hash and high-level operation, never note material, nullifiers, encrypted
 * outputs, signatures, or proof calldata.
 */
export function createSppActivityRecord({
  op,
  txHash,
  ownerAddress,
  recipient,
  amount,
  chainKey,
  poolId,
  timestamp,
}: CreateSppActivityRecordParams): TransactionRecord {
  const trimmedHash = txHash.trim();
  const trimmedRecipient = recipient?.trim();
  const poolDestination = poolId?.trim() || SPP_POOL_LABEL;

  return {
    id: `spp-${op}-${trimmedHash}`,
    // Shielding credits the private balance; transfer/unshield spend it.
    type: op === 'shield' ? 'received' : 'sent',
    amount,
    token: 'Private XLM',
    tokenSymbol: 'pXLM',
    from: ownerAddress,
    to: op === 'shield' ? poolDestination : trimmedRecipient || ownerAddress,
    timestamp: timestamp ?? Date.now(),
    status: 'completed',
    hash: trimmedHash,
    privacyLevel: 'private',
    network: chainKey,
    sppOp: op,
    displayTitle: getSppActivityTitle(op),
    displaySubtitle: getSppActivitySubtitle(op),
    explorerLabel: 'Pool proof transaction',
    isPrivatePoolTx: true,
  };
}

export function isSppActivityRecord(transaction: TransactionRecord): boolean {
  return transaction.isPrivatePoolTx === true || (
    transaction.privacyLevel === 'private' && transaction.sppOp !== undefined
  );
}