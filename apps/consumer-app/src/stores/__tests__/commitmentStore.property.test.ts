// Feature: veilpay-privacy-stack, Property 10: CommitmentRecord SecureStore round-trip
//
// Validates: Requirements 7.1, 7.3, 7.4, 7.5
//
// Properties checked (see design.md §Correctness Properties > Property 10):
//   1. Round-trip: for any valid CommitmentRecord r,
//      saveCommitmentRecord(r) → loadCommitmentRecord(r.commitmentHash)
//      returns a record deep-equal to r.
//   2. markSpent flips `spent` to true and preserves every other field.
//   3. markSpent on an unknown commitmentHash is a silent no-op (no throw,
//      no record created).
//   4. Every SecureStore write uses keychainAccessible:
//      WHEN_UNLOCKED_THIS_DEVICE_ONLY (Requirement 7.2 / design §SecureStore
//      isolation invariant — also surfaced here so a regression in the
//      access-class flag is caught at unit-test time).

// ---------------------------------------------------------------------------
// expo-secure-store mock
//
// The mock has to be declared *before* the SUT import so jest hoists it. We
// keep the in-memory state at module scope inside the factory (memoryStore),
// and expose a side-channel `__calls` array via the mocked module so the test
// body can inspect every operation's options bag.
// ---------------------------------------------------------------------------
jest.mock('expo-secure-store', () => {
  const memoryStore = new Map<string, string>();
  const calls: Array<{
    op: 'set' | 'get' | 'delete';
    key: string;
    value?: string;
    options?: unknown;
  }> = [];

  return {
    __esModule: true,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: async (key: string, value: string, options?: unknown) => {
      calls.push({ op: 'set', key, value, options });
      memoryStore.set(key, value);
    },
    getItemAsync: async (key: string) => {
      calls.push({ op: 'get', key });
      return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
    },
    deleteItemAsync: async (key: string) => {
      calls.push({ op: 'delete', key });
      memoryStore.delete(key);
    },
    // Test-only side channel — not part of the real expo-secure-store API.
    __memoryStore: memoryStore,
    __calls: calls,
  };
});

import * as fc from 'fast-check';

import {
  saveCommitmentRecord,
  loadCommitmentRecord,
  markSpent,
  type Address,
  type CommitmentRecord,
  type Hex,
} from '../commitmentStore';

// Re-import the mocked module so we can read the side-channel arrays.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SecureStoreMock = require('expo-secure-store') as {
  __memoryStore: Map<string, string>;
  __calls: Array<{ op: 'set' | 'get' | 'delete'; key: string; value?: string; options?: unknown }>;
};

// ---------------------------------------------------------------------------
// Smart generators
//
// These constrain to the input space the type system actually allows: 0x-
// prefixed lower-case hex of fixed lengths for hashes / addresses, decimal
// strings for amounts, and so on. Random non-conforming inputs would just
// exercise the JSON layer rather than the storage contract we care about.
// ---------------------------------------------------------------------------

const arbitraryHex32 = (): fc.Arbitrary<Hex> =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .map((bytes) => `0x${Buffer.from(bytes).toString('hex')}` as Hex);

const arbitraryAddress = (): fc.Arbitrary<Address> =>
  fc
    .uint8Array({ minLength: 20, maxLength: 20 })
    .map((bytes) => `0x${Buffer.from(bytes).toString('hex')}` as Address);

const arbitraryDecimalAmount = (): fc.Arbitrary<string> =>
  // 1 to 78 digits (256-bit max ≈ 78 digits), no leading zero, no negatives.
  fc
    .tuple(
      fc.integer({ min: 1, max: 9 }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 77 })
    )
    .map(([head, rest]) => `${head}${rest.join('')}`);

const arbitraryChainKey = (): fc.Arbitrary<string> =>
  fc.constantFrom('evm-sepolia', 'evm-mainnet', 'evm-polygon', 'svm-devnet');

const arbitraryRecord = (): fc.Arbitrary<CommitmentRecord> =>
  fc.record({
    nullifier: arbitraryHex32(),
    secret: arbitraryHex32(),
    commitmentHash: arbitraryHex32(),
    leafIndex: fc.integer({ min: 0, max: 2 ** 20 - 1 }),
    merkleRoot: arbitraryHex32(),
    amount: arbitraryDecimalAmount(),
    token: arbitraryAddress(),
    chainKey: arbitraryChainKey(),
    timestamp: fc.integer({ min: 0, max: 2 ** 53 - 1 }),
    spent: fc.boolean(),
  });

// ---------------------------------------------------------------------------
// Test lifecycle
//
// Reset the in-memory store and the captured-calls log between iterations so
// previous records cannot leak across runs and inflate / mask assertions.
// ---------------------------------------------------------------------------

beforeEach(() => {
  SecureStoreMock.__memoryStore.clear();
  SecureStoreMock.__calls.length = 0;
});

describe('CommitmentRecord SecureStore round-trip (Property 10)', () => {
  it('save → load returns a deep-equal record', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryRecord(), async (record) => {
        SecureStoreMock.__memoryStore.clear();
        SecureStoreMock.__calls.length = 0;

        await saveCommitmentRecord(record);
        const loaded = await loadCommitmentRecord(record.commitmentHash);

        expect(loaded).toEqual(record);
      }),
      { numRuns: 50 }
    );
  });

  it('markSpent flips `spent` to true and preserves every other field', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryRecord(), async (record) => {
        SecureStoreMock.__memoryStore.clear();
        SecureStoreMock.__calls.length = 0;

        await saveCommitmentRecord(record);
        await markSpent(record.commitmentHash);
        const loaded = await loadCommitmentRecord(record.commitmentHash);

        // `spent` must be true regardless of its prior value.
        expect(loaded).not.toBeNull();
        expect(loaded!.spent).toBe(true);

        // Every other field must equal the original. We compare by
        // reconstructing the record with `spent` swapped back so a single
        // deep-equal catches any incidental mutation.
        expect({ ...loaded!, spent: record.spent }).toEqual(record);
      }),
      { numRuns: 50 }
    );
  });

  it('markSpent on an unknown commitmentHash is a silent no-op', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryHex32(), async (unknownHash) => {
        SecureStoreMock.__memoryStore.clear();
        SecureStoreMock.__calls.length = 0;

        await expect(markSpent(unknownHash)).resolves.toBeUndefined();

        // No record was created as a side effect.
        await expect(loadCommitmentRecord(unknownHash)).resolves.toBeNull();
      }),
      { numRuns: 25 }
    );
  });

  it('every SecureStore write pins the entry to WHEN_UNLOCKED_THIS_DEVICE_ONLY', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryRecord(), async (record) => {
        SecureStoreMock.__memoryStore.clear();
        SecureStoreMock.__calls.length = 0;

        await saveCommitmentRecord(record);
        await markSpent(record.commitmentHash);

        const writes = SecureStoreMock.__calls.filter((c) => c.op === 'set');
        expect(writes.length).toBeGreaterThan(0);
        for (const w of writes) {
          expect(w.options).toEqual(
            expect.objectContaining({
              keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
            })
          );
        }
      }),
      { numRuns: 25 }
    );
  });
});
