import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearSppDiagnostics,
  exportSppDiagnostics,
  getSppDiagnostics,
  recordSppDiagnostic,
  sanitizeSppDiagnosticText,
  sppNetworkLabelFromChainKey,
} from '../sppDiagnostics';

describe('SPP diagnostics', () => {
  let stored: string | null;

  beforeEach(() => {
    stored = null;
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async () => stored);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(
      async (_key: string, value: string) => {
        stored = value;
      }
    );
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async () => {
      stored = null;
    });
  });

  it('persists structured operation context without payment secrets', async () => {
    await recordSppDiagnostic({
      status: 'error',
      step: 'shield',
      operation: 'shield',
      chainKey: 'stellar-mainnet',
      contractId: 'CPOOL',
      contractFunction: 'transact',
      code: 'SPP_NATIVE_OP_FAILED',
      message: 'native deposit failed',
    });

    const [record] = await getSppDiagnostics();
    expect(record).toMatchObject({
      status: 'error',
      step: 'shield',
      contractId: 'CPOOL',
      contractFunction: 'transact',
      code: 'SPP_NATIVE_OP_FAILED',
    });
    expect(stored).not.toContain('ownerAddress');
    expect(stored).not.toContain('amount');
  });

  it('redacts key material from raw native errors', () => {
    const secret = 'a'.repeat(64);
    expect(
      sanitizeSppDiagnosticText({
        message: 'prove failed',
        privateKey: secret,
        signature: secret,
      })
    ).toBe(
      '{"message":"prove failed","privateKey":"[REDACTED]","signature":"[REDACTED]"}'
    );
    expect(sanitizeSppDiagnosticText(`native error ${secret}`)).toContain(
      '[REDACTED_HEX]'
    );
  });

  it('clears the persistent report', async () => {
    await recordSppDiagnostic({ status: 'info', step: 'prepare' });
    await clearSppDiagnostics();
    expect(await getSppDiagnostics()).toEqual([]);
  });

  it('stamps the export header with the active network label', async () => {
    await recordSppDiagnostic({
      status: 'success',
      step: 'pool_sync',
      chainKey: 'stellar-testnet',
    });
    const exported = await exportSppDiagnostics('TESTNET');
    expect(exported).toContain('Network: TESTNET');
    expect(exported).toContain('"chainKey":"stellar-testnet"');
  });

  it('maps chain keys to human network labels', () => {
    expect(sppNetworkLabelFromChainKey('stellar-testnet')).toBe('TESTNET');
    expect(sppNetworkLabelFromChainKey('stellar')).toBe('MAINNET');
    expect(sppNetworkLabelFromChainKey(undefined)).toBeUndefined();
    expect(sppNetworkLabelFromChainKey(null)).toBeUndefined();
    expect(sppNetworkLabelFromChainKey('futurenet')).toBe('FUTURENET');
  });
});
