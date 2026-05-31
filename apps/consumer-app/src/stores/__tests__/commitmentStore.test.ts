import { saveCommitmentRecord, loadCommitmentRecord, markSpent, CommitmentRecord } from '../commitmentStore';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1
}));

describe('commitmentStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockRecord: CommitmentRecord = {
    nullifier: '0x123',
    secret: '0x456',
    commitmentHash: '0x789abc',
    leafIndex: 0,
    merkleRoot: '0xabc',
    amount: '100',
    token: '0xdef',
    chainKey: 'evm-sepolia',
    timestamp: 123456,
    spent: false
  };

  it('saves a commitment record', async () => {
    await saveCommitmentRecord(mockRecord);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'veilpay.commitment.789abc',
      JSON.stringify(mockRecord),
      expect.any(Object)
    );
  });

  it('loads a commitment record', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockRecord));
    const record = await loadCommitmentRecord('0x789abc');
    expect(record).toEqual(mockRecord);
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('veilpay.commitment.789abc');
  });

  it('returns null if record not found', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    const record = await loadCommitmentRecord('0x789abc');
    expect(record).toBeNull();
  });

  it('marks a record as spent', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockRecord));
    await markSpent('0x789abc');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'veilpay.commitment.789abc',
      expect.stringContaining('"spent":true'),
      expect.any(Object)
    );
  });
});
