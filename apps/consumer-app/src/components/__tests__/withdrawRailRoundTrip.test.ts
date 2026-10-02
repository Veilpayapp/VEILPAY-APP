// Round-trip proof test for the EVM max-privacy withdraw rail against the
// LOCAL staged circuit artifacts.
//
// Chain under test (one continuous flow):
//   1. A real witness for the shipped 5-signal circuit
//      (packages/circuits/withdraw.circom) is built with real Poseidon —
//      the same construction as packages/circuits/test/withdraw.test.js —
//      using the input ENCODING the client rail actually passes (0x-hex
//      strings from CommitmentRecord for the field/address signals,
//      decimal amount, numeric pathIndices).
//   2. `snarkjs.groth16.fullProve` runs against the staged
//      assets/circuits/withdraw.wasm + withdraw_final.zkey and the proof is
//      verified with `snarkjs.groth16.verify` against
//      packages/circuits/build/verification_key.json (nPublic = 5).
//   3. The decimal publicSignals come back to the jest side, which asserts
//      the 5-entry circuit declaration order
//      [merkleRoot, nullifierHash, recipient, amount, token].
//   4. The rail's real `serializePublicSignalsForRelay` (from
//      usePaymentTransaction) serializes them, and BOTH WithdrawRequestSchema
//      mirrors (consumer + backend, byte-identical) must accept the body —
//      plus negative cases for the stale 4-signal shape and
//      order-inconsistent serializations.
//
// Why proving runs in a CHILD node process
// -----------------------------------------
// The snarkjs/circomlibjs/ffjavascript packages expose only node-conditioned
// `exports` maps, and the jest-expo resolver conditions do not include
// `node` (verified empirically: bare `require('snarkjs')` and
// `require('ffjavascript')` both fail from consumer jest, while zod's
// plain `main` resolves fine). The consumer jest config also moduleNameMaps
// the bare `circomlibjs` specifier to __mocks__/circomlibjs.ts (a
// deterministic stand-in with no BN254 math), and `module.createRequire` is
// intercepted by jest's runtime, so the real prover stack cannot be loaded
// inside the jest sandbox. A child `node` process resolves and runs the real
// stack natively (verified: full prove + verify in ~2s). Everything AFTER
// the proof — ordering, serialization, schema validation — is exercised
// in-process with the REAL production code paths.
//
// The wasm/zkey are gitignored build artifacts staged locally (see
// assets/circuits/README.md and scripts/stage-circuit-assets.js). When they
// are absent (fresh clone before staging), this suite self-skips rather than
// failing on environment; on a staged tree it runs and must pass.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { serializePublicSignalsForRelay } from '../../hooks/usePaymentTransaction';
import type { ProveInputs } from '../ZkpProver';
import { WithdrawRequestSchema } from '../../schemas/withdrawRequest';
import { WithdrawRequestSchema as BackendWithdrawRequestSchema } from '../../../../../apps/backend/src/schemas/withdrawRequest';

// The hook's module graph pulls the Solana/Stellar signers whose native
// transitive deps (bigint-buffer via @solana/spl-token) cannot load in the
// jest sandbox; the dispatch property test established mocking them at
// module scope. Only the serializer is consumed here.
jest.mock('../../utils/solanaSigner', () => ({
  signAndSendSolanaTransaction: jest.fn(),
}));
jest.mock('../../utils/stellarSigner', () => ({
  signAndSendStellarTransaction: jest.fn(),
}));

const CIRCUIT_WASM = path.resolve(
  __dirname,
  '../../../assets/circuits/withdraw.wasm'
);
const CIRCUIT_ZKEY = path.resolve(
  __dirname,
  '../../../assets/circuits/withdraw_final.zkey'
);
const VERIFICATION_KEY = path.resolve(
  __dirname,
  '../../../../../packages/circuits/build/verification_key.json'
);
/** Monorepo root (for the child's absolute-path requires). */
const REPO_ROOT = path.resolve(__dirname, '../../../../../');

const artifactsPresent =
  fs.existsSync(CIRCUIT_WASM) &&
  fs.existsSync(CIRCUIT_ZKEY) &&
  fs.existsSync(VERIFICATION_KEY);
// Self-skip (reported as skipped, not failed) when the gitignored staged
// artifacts are not on disk — see the file header.
const maybeIt = artifactsPresent ? it : it.skip;

/** The nine circuit signals, in declaration order (five public). */
const EXPECTED_INPUT_KEYS = [
  'amount',
  'merkleRoot',
  'nullifier',
  'nullifierHash',
  'pathElements',
  'pathIndices',
  'recipient',
  'secret',
  'token',
].sort();

interface ChildResult {
  ok: boolean;
  error?: string;
  nPublic?: number;
  vkNPublic?: number;
  verified?: boolean;
  publicSignals?: string[];
  inputsKeys?: string[];
  expected?: {
    merkleRoot: string;
    nullifierHash: string;
    recipient: string;
    amount: string;
    token: string;
  };
}

/**
 * Runs the real prove → verify pipeline in a child node process against the
 * staged artifacts and returns its JSON report. The child script is written
 * to a temp file (avoiding shell-quoting hazards) and requires the real
 * snarkjs/circomlibjs from the monorepo root by absolute path.
 */
function runProverChild(): Promise<ChildResult> {
  const script = `
(async () => {
  const circomlibjs = require(${JSON.stringify(
    path.join(REPO_ROOT, 'node_modules', 'circomlibjs')
  )});
  const snarkjs = require(${JSON.stringify(
    path.join(REPO_ROOT, 'node_modules', 'snarkjs')
  )});
  const fs = require('fs');
  const hex64 = (b) => '0x' + b.toString(16).padStart(64, '0');
  const hex40 = (b) => '0x' + b.toString(16).padStart(40, '0');

  const nullifier = 12345n;
  const secret = 67890n;
  const recipient = 0x9999999999999999999999999999999999999999n; // < 2^160
  const amount = 100n; // non-zero, < 2^128
  const token = 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n; // USDC-like, < 2^160

  // commitment = Poseidon(nullifier, secret, amount, token) as a leaf of an
  // all-zero-subtree depth-20 incremental tree.
  const poseidon = await circomlibjs.buildPoseidon();
  const F = poseidon.F;
  const commitment = F.toObject(poseidon([nullifier, secret, amount, token]));
  const nullifierHash = F.toObject(poseidon([nullifier]));
  let cursor = commitment;
  const pathElements = [];
  const pathIndices = [];
  for (let i = 0; i < 20; i++) {
    pathElements.push(0n);
    pathIndices.push(0);
    cursor = F.toObject(poseidon([cursor, 0n]));
  }
  const merkleRoot = cursor;

  // Rail encoding — exactly what usePaymentTransaction's max path hands to
  // ZkpProver.generateProof from the CommitmentRecord: 0x-hex for the
  // field/address signals, decimal amount, numeric pathIndices.
  const inputs = {
    nullifier: hex64(nullifier),
    secret: hex64(secret),
    pathElements: pathElements.map(hex64),
    pathIndices,
    merkleRoot: hex64(merkleRoot),
    nullifierHash: hex64(nullifierHash),
    recipient: hex40(recipient),
    amount: amount.toString(),
    token: hex40(token),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    ${JSON.stringify(CIRCUIT_WASM)},
    ${JSON.stringify(CIRCUIT_ZKEY)}
  );
  const vk = JSON.parse(fs.readFileSync(${JSON.stringify(
    VERIFICATION_KEY
  )}, 'utf8'));
  const verified = await snarkjs.groth16.verify(vk, publicSignals, proof);

  const report = {
    ok: true,
    nPublic: publicSignals.length,
    vkNPublic: vk.nPublic,
    verified,
    publicSignals,
    inputsKeys: Object.keys(inputs).sort(),
    expected: {
      merkleRoot: merkleRoot.toString(),
      nullifierHash: nullifierHash.toString(),
      recipient: recipient.toString(),
      amount: amount.toString(),
      token: token.toString(),
    },
  };
  await new Promise((resolve) => process.stdout.write(JSON.stringify(report), resolve));
  process.exit(0);
})().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
  process.exit(1);
});
`;
  const scriptPath = path.join(
    os.tmpdir(),
    `veilpay-withdraw-roundtrip-${process.pid}-${Date.now()}.cjs`
  );
  fs.writeFileSync(scriptPath, script);
  return new Promise<ChildResult>((resolve, reject) => {
    execFile(
      process.execPath,
      [scriptPath],
      { timeout: 150_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        fs.unlink(scriptPath, () => undefined);
        if (err) {
          reject(
            new Error(
              `prover child process failed: ${err.message}; stdout: ${String(
                stdout
              ).slice(0, 500)}`
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(String(stdout)) as ChildResult);
        } catch (e) {
          reject(
            new Error(
              `prover child returned non-JSON output: ${String(stdout).slice(
                0,
                500
              )}`
            )
          );
        }
      }
    );
  });
}

const hex64 = (decimal: string): string =>
  `0x${BigInt(decimal).toString(16).padStart(64, '0')}`;
const hex40 = (decimal: string): string =>
  `0x${BigInt(decimal).toString(16).padStart(40, '0')}`;

describe('withdraw rail round-trip against the local staged circuit artifacts', () => {
  maybeIt(
    'ProveInputs (rail encoding) → fullProve → verified 5 ordered publicSignals → serialized body both schemas accept',
    async () => {
      // ---- 1+2. Real witness, real proof, real verification (child node). ----
      const result = await runProverChild();

      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.inputsKeys).toEqual(EXPECTED_INPUT_KEYS);
      expect(result.vkNPublic).toBe(5);
      expect(result.verified).toBe(true);

      // ---- 3. Public signals: 5 entries, circuit declaration order. ----
      const publicSignals = result.publicSignals as string[];
      expect(result.nPublic).toBe(5);
      expect(publicSignals).toHaveLength(5);
      expect(publicSignals[0]).toBe(result.expected?.merkleRoot);
      expect(publicSignals[1]).toBe(result.expected?.nullifierHash);
      expect(publicSignals[2]).toBe(result.expected?.recipient);
      expect(publicSignals[3]).toBe(result.expected?.amount);
      expect(publicSignals[4]).toBe(result.expected?.token);

      // ---- 4. Serialize with the rail's real serializer. ----
      const serialized = serializePublicSignalsForRelay(publicSignals);
      expect(serialized).toEqual([
        hex64(result.expected!.merkleRoot),
        hex64(result.expected!.nullifierHash),
        hex40(result.expected!.recipient),
        result.expected!.amount,
        hex40(result.expected!.token),
      ]);

      // ---- 5. Both schema mirrors accept the body. ----
      const body = {
        nullifierHash: hex64(result.expected!.nullifierHash),
        // The proof blob the relayer receives is the abi-encoded Groth16
        // object (still deferred — tasks 11.x); for this schema check any
        // 0x-hex string exercises the proof field's validator.
        proof: '0xdeadbeef',
        publicSignals: serialized,
        merkleRoot: hex64(result.expected!.merkleRoot),
        recipient: hex40(result.expected!.recipient),
        token: hex40(result.expected!.token),
        amount: result.expected!.amount,
        chainKey: 'evm-sepolia',
        contractAddress: '0x' + '11'.repeat(20),
      };

      expect(WithdrawRequestSchema.safeParse(body).success).toBe(true);
      expect(BackendWithdrawRequestSchema.safeParse(body).success).toBe(true);

      // Negative cases — the schemas must reject the stale 4-signal shape
      // and order-inconsistent serializations.
      const fourSignals = { ...body, publicSignals: serialized.slice(0, 4) };
      expect(WithdrawRequestSchema.safeParse(fourSignals).success).toBe(false);
      expect(
        BackendWithdrawRequestSchema.safeParse(fourSignals).success
      ).toBe(false);

      // amount slot sent as 0x-hex instead of decimal → per-element reject.
      const hexEncodedAmount = {
        ...body,
        publicSignals: [
          serialized[0],
          serialized[1],
          serialized[2],
          `0x${BigInt(result.expected!.amount).toString(16)}`,
          serialized[4],
        ],
      };
      expect(
        WithdrawRequestSchema.safeParse(hexEncodedAmount).success
      ).toBe(false);

      // token slot sent as a bytes32 instead of an address → per-element
      // reject.
      const bytes32Token = {
        ...body,
        publicSignals: [
          serialized[0],
          serialized[1],
          serialized[2],
          serialized[3],
          hex64(result.expected!.token),
        ],
      };
      expect(
        WithdrawRequestSchema.safeParse(bytes32Token).success
      ).toBe(false);
    },
    180_000
  );
});
