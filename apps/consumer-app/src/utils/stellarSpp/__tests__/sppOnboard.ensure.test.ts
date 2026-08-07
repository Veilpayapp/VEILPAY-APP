/**
 * ensureSppAccountReady must not leave ASP insert permanently skipped.
 */

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async () => 'deadbeef'),
}));

// Force insert_leaf network path to fail closed (no real RPC) so we assert
// the retry message rather than short-circuit "set up on this device".
jest.mock('stellar-sdk/rpc', () => {
  const actual = jest.requireActual('stellar-sdk/rpc');
  return {
    ...actual,
    Server: jest.fn().mockImplementation(() => ({
      getAccount: jest.fn(async () => {
        throw new Error('mock: no account');
      }),
    })),
  };
});

jest.mock('../../transactions', () => ({
  getStoredMnemonic: jest.fn(async () => Array(24).fill('abandon')),
}));

jest.mock('@scure/bip39', () => ({
  mnemonicToSeed: jest.fn(async () => Buffer.alloc(64)),
}));

jest.mock('ed25519-hd-key', () => ({
  derivePath: jest.fn(() => ({ key: Buffer.alloc(32) })),
}));

// Mock Keypair.fromRawEd25519Seed method directly
jest.mock('stellar-sdk', () => {
  const actualStellar = jest.requireActual('stellar-sdk');
  return {
    ...actualStellar,
    Keypair: {
      ...actualStellar.Keypair,
      fromRawEd25519Seed: jest.fn().mockReturnValue({
        publicKey: jest.fn(() => OWNER),
        sign: jest.fn(),
      }),
    },
  };
});

const OWNER = 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME';

function putAccount(record: Record<string, unknown>) {
  const key = `veilpay.spp.account.stellar-testnet.${OWNER}`.replace(
    /[^A-Za-z0-9._-]/g,
    '_'
  );
  mockStore.set(key, JSON.stringify(record));
}

describe('ensureSppAccountReady', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('when leaf exists and not inserted, attempts insert (does not silent-skip)', async () => {
    putAccount({
      chainKey: 'stellar-testnet',
      ownerAddress: OWNER,
      derivationSigHashHex: 'ab'.repeat(32),
      aspLeafDecimal: '123456789',
      aspInserted: false,
      updatedAt: Date.now(),
    });

    // Mock is already configured in jest.mock() block above.
    // Keypair.fromRawEd25519Seed returns mocked keypair with OWNER public key.

    const { ensureSppAccountReady } = await import('../sppOnboard');
    const result = await ensureSppAccountReady('stellar-testnet', OWNER);

    expect(result.hasLeaf).toBe(true);
    expect(result.aspReady).toBe(false);
    // Old bug: message was only "set up on this device" with no insert attempt.
    expect(result.message).toMatch(/insert|ASP|pending|Fund|account|RPC/i);
    expect(result.message).not.toBe('Private XLM set up on this device');
  });

  it('when already inserted, returns ready without claiming pending', async () => {
    const { SPP_TESTNET } = await import('../../../constants/spp');
    putAccount({
      chainKey: 'stellar-testnet',
      ownerAddress: OWNER,
      derivationSigHashHex: 'ab'.repeat(32),
      aspLeafDecimal: '123',
      aspInserted: true,
      aspInsertTxHash: 'done-hash',
      aspMembershipContractId: SPP_TESTNET.aspMembershipId,
      keysRegistered: true,
      keysRegisterTxHash: 'keys-hash',
      registryContractId: SPP_TESTNET.registryId,
      updatedAt: Date.now(),
    });

    const { ensureSppAccountReady } = await import('../sppOnboard');
    const result = await ensureSppAccountReady('stellar-testnet', OWNER);
    expect(result.aspReady).toBe(true);
    expect(result.hasLeaf).toBe(true);
    expect(result.message).toMatch(/ready/i);
  });

  it('fails closed when a legacy ASP flag has no deployment contract id', async () => {
    putAccount({
      chainKey: 'stellar-testnet',
      ownerAddress: OWNER,
      derivationSigHashHex: 'ab'.repeat(32),
      aspLeafDecimal: '123',
      aspInserted: true,
      aspInsertTxHash: 'legacy-hash',
      keysRegistered: false,
      updatedAt: Date.now(),
    });

    const { ensureSppAccountReady } = await import('../sppOnboard');
    const result = await ensureSppAccountReady('stellar-testnet', OWNER);

    expect(result.aspReady).toBe(false);
    expect(result.account.aspMembershipContractId).toBeUndefined();
    expect(result.message).not.toBe('Private XLM ready');
  });
});
