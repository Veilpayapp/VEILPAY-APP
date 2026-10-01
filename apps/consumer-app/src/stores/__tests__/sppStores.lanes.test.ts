/**
 * SPP store edge-lane tests (sppNoteStore + sppAccountStore).
 *
 * The existing suites cover the happy round-trips; these drive the corrupt /
 * missing / wipe lanes: unparseable or non-array SecureStore index, non-string
 * index entries, missing or corrupt records, id sanitization, index
 * idempotency, missing-record mark/clear no-ops, and the account-wipe
 * clearAll* helpers (including best-effort delete failures).
 */
const mockSecureStore = new Map<string, string>();
const mockDeleteFailKeys = new Set<string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    if (mockDeleteFailKeys.has(key)) throw new Error('delete failed');
    mockSecureStore.delete(key);
  }),
}));

import {
  getSppNote,
  listSppNotes,
  markSppNoteSpent,
  saveSppNote,
  clearAllSppNotes,
  type SppNoteRecord,
} from '../sppNoteStore';
import {
  clearAllSppAccounts,
  clearAspInserted,
  clearKeysRegistered,
  getSppAccount,
  markAspInserted,
  markKeysRegistered,
  saveSppAccount,
  type SppAccountRecord,
} from '../sppAccountStore';

const CHAIN = 'stellar-testnet';
const OWNER = 'GBU4T3ZUDWDCD3X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH';

function note(partial: Partial<SppNoteRecord> & Pick<SppNoteRecord, 'id' | 'amount'>): SppNoteRecord {
  return {
    chainKey: CHAIN,
    poolId: 'CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH',
    ownerAddress: OWNER,
    createdAt: Date.now(),
    spent: false,
    ...partial,
  };
}

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

describe('sppNoteStore edge lanes', () => {
  beforeEach(() => {
    mockSecureStore.clear();
    mockDeleteFailKeys.clear();
  });

  it('getSppNote: missing key and corrupt JSON both resolve null', async () => {
    expect(await getSppNote('missing')).toBeNull();
    mockSecureStore.set('veilpay.spp.note.corrupt', '{not json');
    expect(await getSppNote('corrupt')).toBeNull();
  });

  it('note ids are sanitized into storage keys', async () => {
    const weird = note({ id: 'a/b c#1', amount: '1' });
    await saveSppNote(weird);
    expect(mockSecureStore.has('veilpay.spp.note.a_b_c_1')).toBe(true);
    expect((await getSppNote('a/b c#1'))?.id).toBe('a/b c#1');
  });

  it('listSppNotes survives a corrupt index and a non-array index', async () => {
    mockSecureStore.set('veilpay.spp.notes.index', 'not-json');
    expect(await listSppNotes()).toEqual([]);

    mockSecureStore.set('veilpay.spp.notes.index', JSON.stringify({ nope: true }));
    expect(await listSppNotes()).toEqual([]);
  });

  it('listSppNotes filters non-string index entries and corrupt note payloads', async () => {
    await saveSppNote(note({ id: 'good', amount: '1' }));
    mockSecureStore.set(
      'veilpay.spp.notes.index',
      JSON.stringify(['good', 42, null, 'corrupt-note'])
    );
    mockSecureStore.set('veilpay.spp.note.corrupt-note', '###');

    const list = await listSppNotes();
    expect(list.map((n) => n.id)).toEqual(['good']);
  });

  it('listSppNotes filters by poolId and unspentOnly, newest first', async () => {
    const older = note({ id: 'older', amount: '1', createdAt: 100 });
    const newer = note({
      id: 'newer',
      amount: '2',
      createdAt: 200,
      poolId: 'OTHERPOOL',
    });
    const spent = note({ id: 'spent', amount: '3', spent: true, createdAt: 300 });
    await saveSppNote(older);
    await saveSppNote(newer);
    await saveSppNote(spent);

    expect((await listSppNotes({ poolId: 'OTHERPOOL' })).map((n) => n.id)).toEqual(['newer']);
    const unspent = await listSppNotes({ unspentOnly: true });
    expect(unspent.map((n) => n.id)).toEqual(['newer', 'older']);
  });

  it('markSppNoteSpent: missing note is a no-op; lastTxHash recorded when given', async () => {
    await expect(markSppNoteSpent('ghost')).resolves.toBeUndefined();

    const n = note({ id: 'n1', amount: '1' });
    await saveSppNote(n);
    await markSppNoteSpent('n1', '0xtx');
    const after = await getSppNote('n1');
    expect(after?.spent).toBe(true);
    expect(after?.lastTxHash).toBe('0xtx');
  });

  it('saveSppNote keeps one index entry per id (idempotent)', async () => {
    const n = note({ id: 'dup', amount: '1' });
    await saveSppNote(n);
    await saveSppNote({ ...n, amount: '2' });
    const index = JSON.parse(
      mockSecureStore.get('veilpay.spp.notes.index') as string
    ) as string[];
    expect(index.filter((id) => id === 'dup')).toHaveLength(1);
  });

  it('clearAllSppNotes removes every note and the index', async () => {
    await saveSppNote(note({ id: 'a', amount: '1' }));
    await saveSppNote(note({ id: 'b', amount: '2' }));
    await clearAllSppNotes();
    expect(mockSecureStore.has('veilpay.spp.note.a')).toBe(false);
    expect(mockSecureStore.has('veilpay.spp.note.b')).toBe(false);
    expect(mockSecureStore.has('veilpay.spp.notes.index')).toBe(false);
  });

  it('clearAllSppNotes tolerates a failing note delete (best-effort)', async () => {
    await saveSppNote(note({ id: 'x', amount: '1' }));
    mockDeleteFailKeys.add('veilpay.spp.note.x');
    await expect(clearAllSppNotes()).resolves.toBeUndefined();
    expect(mockSecureStore.has('veilpay.spp.notes.index')).toBe(false);
  });
});

describe('sppAccountStore edge lanes', () => {
  beforeEach(() => {
    mockSecureStore.clear();
    mockDeleteFailKeys.clear();
  });

  it('getSppAccount: missing, corrupt, and non-object payloads all resolve null', async () => {
    expect(await getSppAccount(CHAIN, OWNER)).toBeNull();

    const key = `veilpay.spp.account.stellar-testnet.${OWNER}`;
    mockSecureStore.set(key, '{broken');
    expect(await getSppAccount(CHAIN, OWNER)).toBeNull();

    mockSecureStore.set(key, JSON.stringify('just a string'));
    expect(await getSppAccount(CHAIN, OWNER)).toBeNull();
  });

  it('mark/clear functions no-op (return null) when the record is missing', async () => {
    expect(await markAspInserted(CHAIN, OWNER, '0xtx')).toBeNull();
    expect(await clearAspInserted(CHAIN, OWNER)).toBeNull();
    expect(await markKeysRegistered(CHAIN, OWNER, '0xtx')).toBeNull();
    expect(await clearKeysRegistered(CHAIN, OWNER)).toBeNull();
  });

  it('markAspInserted keeps an existing contract id when none is supplied', async () => {
    await saveSppAccount(
      account({ aspMembershipContractId: 'CONTRACT-OLD', aspInserted: true })
    );
    const next = await markAspInserted(CHAIN, OWNER, '0xnew', undefined);
    expect(next?.aspInserted).toBe(true);
    expect(next?.aspInsertTxHash).toBe('0xnew');
    expect(next?.aspMembershipContractId).toBe('CONTRACT-OLD');
    expect(next?.updatedAt).toBeGreaterThan(1);
  });

  it('markKeysRegistered stores the registry contract id when supplied', async () => {
    await saveSppAccount(account({ registryContractId: 'REG-OLD' }));
    const next = await markKeysRegistered(CHAIN, OWNER, '0xreg', 'REG-NEW');
    expect(next?.keysRegistered).toBe(true);
    expect(next?.keysRegisterTxHash).toBe('0xreg');
    expect(next?.registryContractId).toBe('REG-NEW');
  });

  it('clear functions wipe the tx hashes and contract ids', async () => {
    await saveSppAccount(account());
    await markAspInserted(CHAIN, OWNER, '0xasp', 'CONTRACT');
    await markKeysRegistered(CHAIN, OWNER, '0xkeys', 'REG');

    const clearedAsp = await clearAspInserted(CHAIN, OWNER);
    expect(clearedAsp?.aspInserted).toBe(false);
    expect(clearedAsp?.aspInsertTxHash).toBeUndefined();
    expect(clearedAsp?.aspMembershipContractId).toBeUndefined();

    const clearedKeys = await clearKeysRegistered(CHAIN, OWNER);
    expect(clearedKeys?.keysRegistered).toBe(false);
    expect(clearedKeys?.keysRegisterTxHash).toBeUndefined();
    expect(clearedKeys?.registryContractId).toBeUndefined();
  });

  it('clearAllSppAccounts removes records and the index', async () => {
    await saveSppAccount(account());
    await saveSppAccount(account({ chainKey: 'stellar', ownerAddress: 'GOTHER' }));
    await clearAllSppAccounts();
    expect(mockSecureStore.size).toBe(0);
  });

  it('clearAllSppAccounts tolerates a failing record delete', async () => {
    await saveSppAccount(account());
    const key = `veilpay.spp.account.${CHAIN}.${OWNER}`;
    mockDeleteFailKeys.add(key);
    await expect(clearAllSppAccounts()).resolves.toBeUndefined();
    expect(mockSecureStore.has('veilpay.spp.account.index')).toBe(false);
  });
});
