import {
  createSppActivityRecord,
  getSppActivitySubtitle,
  getSppActivityTitle,
  isSppActivityRecord,
} from '../sppActivity';

const ownerAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const recipient = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const poolId = 'CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH';

describe('sppActivity', () => {
  it('summarizes shield operations as private-balance credits', () => {
    const record = createSppActivityRecord({
      op: 'shield',
      txHash: 'abc123',
      ownerAddress,
      amount: '100',
      chainKey: 'stellar-testnet',
      poolId,
      timestamp: 123,
    });

    expect(record).toMatchObject({
      id: 'spp-shield-abc123',
      type: 'received',
      token: 'Private XLM',
      tokenSymbol: 'pXLM',
      to: poolId,
      timestamp: 123,
      status: 'completed',
      privacyLevel: 'private',
      network: 'stellar-testnet',
      sppOp: 'shield',
      displayTitle: 'SHIELDED XLM',
      displaySubtitle: 'Public XLM → private balance',
      explorerLabel: 'Pool proof transaction',
      isPrivatePoolTx: true,
    });
    expect(isSppActivityRecord(record)).toBe(true);
  });

  it('summarizes private transfers without proof or note material', () => {
    const record = createSppActivityRecord({
      op: 'transfer',
      txHash: 'def456',
      ownerAddress,
      recipient,
      amount: '25.5',
      chainKey: 'stellar-testnet',
    });

    expect(record.type).toBe('sent');
    expect(record.to).toBe(recipient);
    expect(record.displayTitle).toBe('PRIVATE TRANSFER');
    expect(record.displaySubtitle).toBe('Private balance → shielded recipient');
    expect(Object.keys(record).join(' ')).not.toMatch(/nullifier|proof|encrypted/i);
  });

  it('uses stable labels for all SPP operations', () => {
    expect(getSppActivityTitle('unshield')).toBe('UNSHIELDED XLM');
    expect(getSppActivitySubtitle('unshield')).toBe('Private balance → public Stellar address');
  });
});