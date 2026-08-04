import {
  clearAspInserted,
  clearKeysRegistered,
  getSppAccount,
  markAspInserted,
  markKeysRegistered,
  saveSppAccount,
  type SppAccountRecord,
} from '../sppAccountStore';

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));

const CHAIN = 'stellar-testnet';
const OWNER = 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME';

function account(overrides: Partial<SppAccountRecord> = {}): SppAccountRecord {
  return {
    chainKey: CHAIN,
    ownerAddress: OWNER,
    aspInserted: false,
    keysRegistered: false,
    updatedAt: 1,
    ...overrides,
  };
}

describe('sppAccountStore deployment-scoped state', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('backfills legacy records that predate receive-key registration state', async () => {
    const legacy = account();
    delete (legacy as Partial<SppAccountRecord>).keysRegistered;
    await saveSppAccount(legacy as SppAccountRecord);

    await expect(getSppAccount(CHAIN, OWNER)).resolves.toMatchObject({
      keysRegistered: false,
    });
  });

  it('records and clears ASP membership for the exact deployment', async () => {
    await saveSppAccount(account());

    const marked = await markAspInserted(CHAIN, OWNER, 'asp-tx', 'ASP-CONTRACT');
    expect(marked).toMatchObject({
      aspInserted: true,
      aspInsertTxHash: 'asp-tx',
      aspMembershipContractId: 'ASP-CONTRACT',
    });

    const cleared = await clearAspInserted(CHAIN, OWNER);
    expect(cleared).toMatchObject({ aspInserted: false });
    expect(cleared?.aspInsertTxHash).toBeUndefined();
    expect(cleared?.aspMembershipContractId).toBeUndefined();
  });

  it('records and clears receive keys for the exact registry deployment', async () => {
    await saveSppAccount(account());

    const marked = await markKeysRegistered(CHAIN, OWNER, 'registry-tx', 'REGISTRY-CONTRACT');
    expect(marked).toMatchObject({
      keysRegistered: true,
      keysRegisterTxHash: 'registry-tx',
      registryContractId: 'REGISTRY-CONTRACT',
    });

    const cleared = await clearKeysRegistered(CHAIN, OWNER);
    expect(cleared).toMatchObject({ keysRegistered: false });
    expect(cleared?.keysRegisterTxHash).toBeUndefined();
    expect(cleared?.registryContractId).toBeUndefined();
  });
});
