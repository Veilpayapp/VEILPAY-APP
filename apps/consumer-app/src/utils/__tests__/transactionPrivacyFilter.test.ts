import { filterTransactionsForPrivacyMode } from '../transactionPrivacyFilter';
import type { TransactionRecord } from '../../types/transactions';

function tx(partial: Partial<TransactionRecord> & { id: string }): TransactionRecord {
  return {
    type: 'sent',
    amount: '1',
    token: 'XLM',
    tokenSymbol: 'XLM',
    from: 'G1',
    to: 'G2',
    timestamp: Date.now(),
    status: 'completed',
    hash: partial.id,
    network: 'stellar-testnet',
    ...partial,
  };
}

describe('filterTransactionsForPrivacyMode', () => {
  const publicTx = tx({ id: 'pub-1', privacyLevel: 'standard' });
  const privateTx = tx({
    id: 'priv-1',
    privacyLevel: 'private',
    isPrivatePoolTx: true,
    sppOp: 'shield',
    tokenSymbol: 'pXLM',
  });
  const privateOtherChain = tx({
    id: 'priv-2',
    privacyLevel: 'private',
    isPrivatePoolTx: true,
    sppOp: 'transfer',
    network: 'stellar',
  });

  it('private mode shows only private pool rows for the chain', () => {
    const out = filterTransactionsForPrivacyMode(
      [publicTx, privateTx, privateOtherChain],
      { privacyMode: true, privacyChainKey: 'stellar-testnet' }
    );
    expect(out.map((t) => t.id)).toEqual(['priv-1']);
  });

  it('public mode hides private pool rows', () => {
    const out = filterTransactionsForPrivacyMode(
      [publicTx, privateTx],
      { privacyMode: false, publicChainKey: 'stellar-testnet' }
    );
    expect(out.map((t) => t.id)).toEqual(['pub-1']);
  });

  it('private mode includes sppOp rows even without isPrivatePoolTx flag', () => {
    const legacy = tx({
      id: 'legacy-priv',
      privacyLevel: 'private',
      sppOp: 'unshield',
      tokenSymbol: 'pXLM',
    });
    const out = filterTransactionsForPrivacyMode([publicTx, legacy], {
      privacyMode: true,
      privacyChainKey: 'stellar-testnet',
    });
    expect(out.map((t) => t.id)).toEqual(['legacy-priv']);
  });
});
