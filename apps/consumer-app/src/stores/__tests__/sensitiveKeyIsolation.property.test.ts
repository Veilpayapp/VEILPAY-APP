// Feature: veilpay-privacy-stack, Property 11: Sensitive-key isolation
//
// Validates: Requirements 7.6
//
// Properties checked (see design.md §Correctness Properties > Property 11):
//   For any random `CommitmentRecord r`, the *raw* `r.nullifier` and
//   `r.secret` hex strings must NEVER appear in any of these captured
//   payloads after running the persistence + relayer call sites that the
//   deposit / withdraw / stealth-send flow exercises:
//
//     • AsyncStorage `setItem` / `multiSet` / `mergeItem` write values.
//     • Any non-SecureStore-backed Zustand slice's serialized state
//       (here: `transactionStore`).
//     • `fetch` request bodies, regardless of destination.
//
//   The SecureStore-backed persistence path is the *only* allowlisted
//   sink for `nullifier` / `secret`; the SecureStore mock's in-memory map
//   is therefore intentionally NOT included in the haystack we search.
//
//   Two derived hex values are *allowed* to leak into the relayer fetch
//   body, because they're public on-chain anyway:
//     • `nullifierHash` (Poseidon(nullifier)) — public input to the proof.
//     • `commitmentHash` (Poseidon(nullifier, secret)) — public leaf.
//   The relayer body in this test is constructed with synthetic values
//   for those fields that are *intentionally distinct* from the random
//   `record.nullifier` and `record.secret` so the substring search is
//   not ambiguous.
//
// Approach
// --------
// This test does NOT spin up the full UI flow — there's no realistic way
// to do that in a Jest harness without a fully-wired runtime. Instead it
// drives the same persistence and relayer call sites the flow uses
// directly:
//   1. `saveCommitmentRecord(record)` — the SecureStore write path.
//   2. `submitWithdraw(body)` — the relayer HTTP client.
// All sinks are spied on at the module boundary (jest.mock above the
// import) so any future refactor that accidentally routes a write
// through AsyncStorage or that stuffs `nullifier`/`secret` into the
// relayer body will be caught by the substring assertion.

// ---------------------------------------------------------------------------
// Configure the relayer base URL *before* the relayerClient module is
// required, since it captures the env var at module-load time.
// ---------------------------------------------------------------------------
process.env.EXPO_PUBLIC_RELAYER_BASE_URL = 'https://relayer.test.invalid';

// ---------------------------------------------------------------------------
// AsyncStorage mock — captures every write so we can search the values.
//
// Overrides the jest-expo / jest.setup.ts default mock (which merely
// keeps an in-memory map without exposing the writes to the test). We
// expose `__writes` as a side channel.
// ---------------------------------------------------------------------------
jest.mock('@react-native-async-storage/async-storage', () => {
  const writes: { method: string; args: unknown[] }[] = [];
  const memory = new Map<string, string>();
  const m = {
    setItem: jest.fn(async (k: string, v: string) => {
      writes.push({ method: 'setItem', args: [k, v] });
      memory.set(k, v);
    }),
    multiSet: jest.fn(async (pairs: [string, string][]) => {
      writes.push({ method: 'multiSet', args: [pairs] });
      for (const [k, v] of pairs) memory.set(k, v);
    }),
    mergeItem: jest.fn(async (k: string, v: string) => {
      writes.push({ method: 'mergeItem', args: [k, v] });
      memory.set(k, v);
    }),
    getItem: jest.fn(async (k: string) => (memory.has(k) ? memory.get(k)! : null)),
    removeItem: jest.fn(async (k: string) => {
      memory.delete(k);
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      for (const k of keys) memory.delete(k);
    }),
    getAllKeys: jest.fn(async () => Array.from(memory.keys())),
    clear: jest.fn(async () => {
      memory.clear();
    }),
  };
  (m as Record<string, unknown>).__writes = writes;
  (m as Record<string, unknown>).__memory = memory;
  return { __esModule: true, default: m, ...m };
});

// ---------------------------------------------------------------------------
// expo-secure-store mock — the *allowlisted* persistence path.
//
// We back it with a module-scoped Map. Crucially we never include this
// memory map in the haystack: it is the only place the raw `nullifier`
// / `secret` are permitted to live.
// ---------------------------------------------------------------------------
jest.mock('expo-secure-store', () => {
  const memory = new Map<string, string>();
  const mod = {
    __esModule: true,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (k: string, v: string) => {
      memory.set(k, v);
    }),
    getItemAsync: jest.fn(async (k: string) =>
      memory.has(k) ? (memory.get(k) as string) : null
    ),
    deleteItemAsync: jest.fn(async (k: string) => {
      memory.delete(k);
    }),
  };
  (mod as Record<string, unknown>).__memory = memory;
  return mod;
});

import * as fc from 'fast-check';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AsyncStorageMock = require('@react-native-async-storage/async-storage') as {
  __writes: { method: string; args: unknown[] }[];
  __memory: Map<string, string>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SecureStoreMock = require('expo-secure-store') as {
  __memory: Map<string, string>;
};

import { saveCommitmentRecord, type Address, type CommitmentRecord, type Hex } from '../commitmentStore';
import { useTransactionStore } from '../transactionStore';
import type { WithdrawRequest } from '../../schemas/withdrawRequest';

// relayerClient captures `EXPO_PUBLIC_RELAYER_BASE_URL` at module-load time.
// Babel-preset-expo compiles ES `import` to CJS `require` and hoists those
// requires above other top-level code, so a plain `process.env.X = '...'`
// at the top of this file would run *after* relayerClient initialized — by
// which point its constant is already `''`. We therefore lazy-require the
// module *inside* a `jest.isolateModules` block in `beforeAll`, after the
// env has been set, and store the resolved `submitWithdraw` for the test.
let submitWithdraw: (body: WithdrawRequest) => Promise<unknown>;

// ---------------------------------------------------------------------------
// fetch interceptor — captures body strings so the haystack can include them.
//
// The mocked relayer always returns 200 with a well-formed RelayerSuccess
// body so submitWithdraw resolves rather than throws; the test cares about
// the *outgoing* body, not the response.
// ---------------------------------------------------------------------------

interface CapturedFetch {
  url: string;
  body: string | undefined;
}

const fetchCalls: CapturedFetch[] = [];
const realFetch = global.fetch;

beforeAll(() => {
  // Load relayerClient *after* the env var has been set above. Using
  // `jest.isolateModules` ensures we get a fresh module instance whose
  // top-level RELAYER_BASE_URL constant reads the configured value.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    submitWithdraw = (require('../../services/relayerClient') as {
      submitWithdraw: (body: WithdrawRequest) => Promise<unknown>;
    }).submitWithdraw;
  });

  // 64 hex chars = 32-byte tx hash; matches relayerClient's TX_HASH_RE.
  const fakeTxHash = '0x' + 'a'.repeat(64);
  const fakeBody = JSON.stringify({ success: true, txHash: fakeTxHash });

  global.fetch = jest.fn(async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === 'string' ? input : String(input);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    fetchCalls.push({ url, body });
    return {
      ok: true,
      status: 200,
      text: async () => fakeBody,
      json: async () => JSON.parse(fakeBody),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  fetchCalls.length = 0;
  AsyncStorageMock.__writes.length = 0;
  AsyncStorageMock.__memory.clear();
  SecureStoreMock.__memory.clear();
  // Reset transactionStore in-memory slice so previous iterations cannot
  // leak into the haystack.
  useTransactionStore.setState({
    transactions: [],
    transactionsCursor: null,
    hasMoreTransactions: true,
    isLoadingTransactions: false,
    transactionsError: null,
    latestTransakOrder: null,
    latestOnrampOrder: null,
  });
});

// ---------------------------------------------------------------------------
// Smart generators — same shape as task 7.5 (commitmentStore round-trip).
// ---------------------------------------------------------------------------

const arbitraryHex32 = (): fc.Arbitrary<Hex> =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .map((bytes) => `0x${Buffer.from(bytes).toString('hex')}` as Hex);

const arbitraryAddress = (): fc.Arbitrary<Address> =>
  fc
    .uint8Array({ minLength: 20, maxLength: 20 })
    .map((bytes) => `0x${Buffer.from(bytes).toString('hex')}` as Address);

// 1..78 digits, no leading zero — matches schemas/withdrawRequest POSITIVE_DECIMAL.
const arbitraryDecimalAmount = (): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.integer({ min: 1, max: 9 }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 77 })
    )
    .map(([head, rest]) => `${head}${rest.join('')}`);

const arbitraryRecord = (): fc.Arbitrary<CommitmentRecord> =>
  fc.record({
    nullifier: arbitraryHex32(),
    secret: arbitraryHex32(),
    commitmentHash: arbitraryHex32(),
    leafIndex: fc.integer({ min: 0, max: 2 ** 20 - 1 }),
    merkleRoot: arbitraryHex32(),
    amount: arbitraryDecimalAmount(),
    token: arbitraryAddress(),
    chainKey: fc.constant('evm-sepolia'),
    timestamp: fc.integer({ min: 0, max: 2 ** 53 - 1 }),
    spent: fc.constant(false),
  });

// ---------------------------------------------------------------------------
// Sentinel constants used in the relayer body so the substring search is
// unambiguous: these values cannot collide with `record.nullifier` /
// `record.secret` (which are random 32-byte hex strings).
// ---------------------------------------------------------------------------

const SENTINEL_NULLIFIER_HASH: Hex = ('0x' + 'a1'.repeat(32)) as Hex;
const SENTINEL_PROOF: Hex = ('0x' + 'b2'.repeat(64)) as Hex;
const SENTINEL_PUBSIG_ROOT: Hex = ('0x' + 'c3'.repeat(32)) as Hex;
const SENTINEL_PUBSIG_RECIPIENT: Hex = ('0x' + 'd4'.repeat(32)) as Hex;
const SENTINEL_PUBSIG_AMOUNT: Hex = ('0x' + 'e5'.repeat(32)) as Hex;
const SENTINEL_RECIPIENT: Address = ('0x' + 'f6'.repeat(20)) as Address;
const SENTINEL_CONTRACT: Address = ('0x' + '07'.repeat(20)) as Address;

// ---------------------------------------------------------------------------
// Helper: case-insensitive substring search.
// ---------------------------------------------------------------------------
function containsAnyCase(haystack: string, needle: string): boolean {
  return (
    haystack.includes(needle) ||
    haystack.includes(needle.toLowerCase()) ||
    haystack.includes(needle.toUpperCase())
  );
}

// ---------------------------------------------------------------------------
// Property body
// ---------------------------------------------------------------------------

describe('Sensitive-key isolation (Property 11)', () => {
  it('nullifier and secret never appear in AsyncStorage / transactionStore / fetch payloads', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryRecord(), async (record) => {
        // Reset captures per iteration.
        fetchCalls.length = 0;
        AsyncStorageMock.__writes.length = 0;
        AsyncStorageMock.__memory.clear();
        SecureStoreMock.__memory.clear();
        useTransactionStore.setState({
          transactions: [],
          transactionsCursor: null,
          hasMoreTransactions: true,
          isLoadingTransactions: false,
          transactionsError: null,
          latestTransakOrder: null,
          latestOnrampOrder: null,
        });

        // 1) Persist the commitment to SecureStore. This is the only
        //    sink that may legitimately receive `nullifier` / `secret`.
        await saveCommitmentRecord(record);

        // 2) Issue the relayer withdraw. The body purposely uses
        //    sentinel values for nullifierHash / proof / publicSignals
        //    that cannot collide with `record.nullifier` /
        //    `record.secret`, so any substring match would be a real
        //    leak rather than a coincidence. The relayer client must
        //    *not* embed `record.nullifier` or `record.secret` in the
        //    serialized body — they are not part of WithdrawRequest at
        //    all, but a regression that added them would be caught here.
        const body: WithdrawRequest = {
          nullifierHash: SENTINEL_NULLIFIER_HASH,
          proof: SENTINEL_PROOF,
          publicSignals: [
            SENTINEL_PUBSIG_ROOT,
            SENTINEL_NULLIFIER_HASH,
            SENTINEL_PUBSIG_RECIPIENT,
            SENTINEL_PUBSIG_AMOUNT,
          ],
          merkleRoot: record.merkleRoot,
          recipient: SENTINEL_RECIPIENT,
          token: record.token,
          amount: record.amount,
          chainKey: 'evm-sepolia',
          contractAddress: SENTINEL_CONTRACT,
        };
        let submitErr: unknown = null;
        try {
          await submitWithdraw(body);
        } catch (err) {
          submitErr = err;
        }
        // The mocked fetch always succeeds; if `submitErr` is non-null
        // it means the relayer call site never reached the network at
        // all (e.g. config / validation rejected the body), which would
        // make the leakage check below vacuous. We surface it via the
        // post-call sanity assertion at the bottom.

        // 3) Aggregate captured payloads.
        //
        //    SecureStoreMock.__memory is *intentionally excluded*:
        //    it's the allowlisted persistence path for the secret
        //    pre-image (see Requirement 7.6 / design §SecureStore
        //    isolation invariant).
        const asyncStorageHaystack = JSON.stringify(AsyncStorageMock.__writes);
        const transactionStoreHaystack = JSON.stringify(useTransactionStore.getState());
        const fetchHaystack = fetchCalls
          .map((c) => `${c.url}|${c.body ?? ''}`)
          .join('||');

        const haystack = [
          asyncStorageHaystack,
          transactionStoreHaystack,
          fetchHaystack,
        ].join('||');

        // 4) Forbidden-substring assertions.
        const nullifierLeaked = containsAnyCase(haystack, record.nullifier);
        const secretLeaked = containsAnyCase(haystack, record.secret);

        expect(nullifierLeaked).toBe(false);
        expect(secretLeaked).toBe(false);

        // 5) Sanity: the relayer fetch *did* go to RELAYER_BASE_URL and
        //    its body contained the public `nullifierHash` (which is the
        //    explicitly allowed substring per Requirement 7.6). This
        //    catches a regression where the relayer call silently
        //    stopped firing — making the leakage check vacuous.
        // 5) Sanity: the relayer fetch *did* go to RELAYER_BASE_URL and
        //    its body contained the public `nullifierHash` (which is the
        //    explicitly allowed substring per Requirement 7.6). This
        //    catches a regression where the relayer call silently
        //    stopped firing — making the leakage check vacuous.
        const relayerCalls = fetchCalls.filter((c) =>
          c.url.startsWith('https://relayer.test.invalid')
        );
        if (relayerCalls.length !== 1) {
          throw new Error(
            `expected exactly 1 relayer fetch but got ${relayerCalls.length}; ` +
              `submitErr=${String(submitErr)}`
          );
        }
        expect(relayerCalls[0].body ?? '').toContain(SENTINEL_NULLIFIER_HASH);
      }),
      { numRuns: 25 }
    );
  });
});
