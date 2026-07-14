/**
 * PRIV-002: local DSAR / account-wipe unit tests.
 */

const mockClearStoredMnemonic = jest.fn();
const mockDeleteAnalyticsData = jest.fn();
const mockClearWallet = jest.fn();
const mockDisconnect = jest.fn();
const mockClearTransactions = jest.fn();
const mockClearAddresses = jest.fn();

jest.mock('../transactions', () => ({
  clearStoredMnemonic: (...args: unknown[]) => mockClearStoredMnemonic(...args),
}));

jest.mock('../analytics', () => ({
  deleteAnalyticsData: (...args: unknown[]) => mockDeleteAnalyticsData(...args),
}));

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: {
    getState: () => ({
      clearWallet: mockClearWallet,
      disconnect: mockDisconnect,
    }),
  },
}));

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: {
    getState: () => ({
      clearTransactions: mockClearTransactions,
    }),
  },
}));

jest.mock('../../stores/addressBookStore', () => ({
  useAddressBookStore: {
    getState: () => ({
      clearAddresses: mockClearAddresses,
    }),
  },
}));

import { wipeLocalAccountData } from '../accountWipe';

describe('wipeLocalAccountData (PRIV-002)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClearStoredMnemonic.mockResolvedValue(undefined);
  });

  it('clears mnemonic, session, history, address book, and analytics in order', async () => {
    const result = await wipeLocalAccountData();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps).toEqual([
        'mnemonic',
        'wallet_session',
        'transactions',
        'address_book',
        'analytics',
      ]);
    }
    expect(mockClearStoredMnemonic).toHaveBeenCalled();
    expect(mockClearWallet).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockClearTransactions).toHaveBeenCalled();
    expect(mockClearAddresses).toHaveBeenCalled();
    expect(mockDeleteAnalyticsData).toHaveBeenCalled();
  });

  it('fails closed when mnemonic clear throws (does not wipe session first)', async () => {
    mockClearStoredMnemonic.mockRejectedValue(new Error('secure store locked'));

    const result = await wipeLocalAccountData();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedStep).toBe('mnemonic');
      expect(result.completedSteps).toEqual([]);
    }
    expect(mockClearWallet).not.toHaveBeenCalled();
    expect(mockDeleteAnalyticsData).not.toHaveBeenCalled();
  });
});
