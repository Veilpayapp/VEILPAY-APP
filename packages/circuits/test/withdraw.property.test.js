// Feature: veilpay-privacy-stack, Property 1: Merkle membership proof round-trip
//
// Validates: Requirements 1.4, 1.5, 1.6, 1.7, 1.8, 1.11, 2.5, 3.3, 9.6
//
// Implements design.md §Correctness Properties §Property 1.
//
// For any depth-20 tree built from random commitment leaves, with a chosen
// leaf whose preimage `(nullifier, secret)` is known, the circuit must:
//   (a) accept the honest witness and (when artifacts are present) yield a
//       Groth16 proof that snarkjs.groth16.verify accepts against the same
//       verification_key.json the deployed Groth16Verifier consumes;
//   (b) reject any single-byte mutation of `pathElements`, `pathIndices`,
//       `nullifier`, `secret`, `merkleRoot`, `nullifierHash`, `recipient`,
//       `amount`, or `token` — either by failing witness generation OR by
//       causing the verifier to return `false`.
//
// Note on the inline incremental tree below: this duplicates a slimmed-down
// version of `./merkleTree.ts`. The mocha runner here is configured for
// plain JavaScript (`mocha test/*.test.js`); pulling ts-node in for one
// consumer would be more friction than keeping ~80 LoC of well-commented
// duplication. Both copies must hash with circomlibjs's BN254 Poseidon, so
// drift is observable as a mismatch against any cross-language reference.

const path = require('path');
const fs = require('fs');
const { expect } = require('chai');

// BN254 scalar field — same field used by circom's Poseidon.
const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const TREE_LEVELS = 20;

function bytesToField(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % FIELD_PRIME;
}

// 32-byte big-endian view of a field element, mutate one byte by `delta`,
// reduce modulo p so the result remains a valid field element.
function mutateBigIntByte(value, byteOffset, delta) {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  bytes[byteOffset] = (bytes[byteOffset] + delta) & 0xff;
  let r = 0n;
  for (const b of bytes) r = (r << 8n) | BigInt(b);
  return r % FIELD_PRIME;
}

// Builds a function that produces a value-changed-by-one-byte version of
// `initialValue`. Field reduction can — in pathological corners — fold the
// mutation back to the original; we try a small fixed schedule before
// falling back to (value + 1) mod p.
function makeMutator(initialValue) {
  return (offset, delta) => {
    let m = mutateBigIntByte(initialValue, offset, Math.max(1, delta));
    if (m !== initialValue) return m;
    for (let alt = 1; alt < 8; alt++) {
      m = mutateBigIntByte(initialValue, (offset + alt) & 31, ((delta + alt) & 0xff) || 1);
      if (m !== initialValue) return m;
    }
    return (initialValue + 1n) % FIELD_PRIME;
  };
}

// Tornado-style incremental Merkle tree (depth `levels`, Poseidon over BN254).
// See ./merkleTree.ts for the documented reference; this is a JS port for use
// from a plain-JS mocha test.
class IncrementalTree {
  constructor(poseidon, levels) {
    this.poseidon = poseidon;
    this.F = poseidon.F;
    this.levels = levels;
    this.zeros = [0n];
    for (let i = 1; i <= levels; i++) {
      this.zeros.push(this.hashPair(this.zeros[i - 1], this.zeros[i - 1]));
    }
    this.filledSubtrees = this.zeros.slice(0, levels);
    this.nodes = Array.from({ length: levels + 1 }, () => new Map());
    this.nextIndex = 0;
    this.currentRoot = this.zeros[levels];
  }

  hashPair(left, right) {
    return this.F.toObject(this.poseidon([left, right]));
  }

  insert(leaf) {
    if (this.nextIndex >= 2 ** this.levels) throw new Error('tree full');
    let idx = this.nextIndex;
    let cur = leaf;
    this.nodes[0].set(idx, leaf);
    for (let i = 0; i < this.levels; i++) {
      let left;
      let right;
      if ((idx & 1) === 0) {
        left = cur;
        right = this.zeros[i];
        this.filledSubtrees[i] = cur;
      } else {
        left = this.filledSubtrees[i];
        right = cur;
      }
      cur = this.hashPair(left, right);
      idx >>= 1;
      this.nodes[i + 1].set(idx, cur);
    }
    this.currentRoot = cur;
    this.nextIndex += 1;
  }

  root() {
    return this.currentRoot;
  }

  path(index) {
    const pathElements = new Array(this.levels);
    const pathIndices = new Array(this.levels);
    let idx = index;
    for (let i = 0; i < this.levels; i++) {
      const sideBit = idx & 1;
      pathIndices[i] = sideBit;
      const sib = this.nodes[i].get(idx ^ 1);
      pathElements[i] = sib !== undefined ? sib : this.zeros[i];
      idx >>= 1;
    }
    return { pathElements, pathIndices };
  }
}

function cloneInput(input) {
  return {
    nullifier: input.nullifier,
    secret: input.secret,
    pathElements: [...input.pathElements],
    pathIndices: [...input.pathIndices],
    merkleRoot: input.merkleRoot,
    nullifierHash: input.nullifierHash,
    recipient: input.recipient,
    amount: input.amount,
    token: input.token,
  };
}

// True iff calling `buildInput()` and feeding the result to the circuit
// causes either witness generation OR constraint checking to throw.
async function expectWitnessFailure(circuit, buildInput, message) {
  let threw = false;
  try {
    const witness = await circuit.calculateWitness(buildInput(), true);
    await circuit.checkConstraints(witness);
  } catch (_e) {
    threw = true;
  }
  expect(threw, message).to.equal(true);
}

describe('Withdraw Circuit — Property 1: Merkle membership proof round-trip', function () {
  // Each iteration runs ~6 calculateWitness calls (cheap) plus, when build
  // artifacts exist, one fullProve (slow) and two verify calls (fast). At 25
  // iterations the worst case comfortably exceeds mocha's default timeout.
  this.timeout(0);

  let fc;
  let wasmTester;
  let snarkjs;
  let circomlibjs;
  let circuit;
  let poseidon;
  let F;
  let buildArtifactsAvailable = false;
  let wasmPath;
  let zkeyPath;
  let vKey;

  before(async function () {
    try {
      fc = require('fast-check');
      ({ wasm: wasmTester } = require('circom_tester'));
      snarkjs = require('snarkjs');
      circomlibjs = require('circomlibjs');
    } catch (e) {
      console.warn(
        'Skipping Property 1: dev dependency not installed (run `pnpm install` in packages/circuits).\n  cause:',
        e && e.message,
      );
      this.skip();
      return;
    }

    poseidon = await circomlibjs.buildPoseidon();
    F = poseidon.F;

    try {
      circuit = await wasmTester(path.join(__dirname, '..', 'withdraw.circom'), {
        include: [path.join(__dirname, '..', 'node_modules')],
      });
    } catch (e) {
      console.warn(
        'Skipping Property 1: circom binary unavailable or withdraw.circom failed to compile under circom_tester.\n  cause:',
        e && e.message,
      );
      this.skip();
      return;
    }

    wasmPath = path.join(__dirname, '..', 'build', 'withdraw.wasm');
    zkeyPath = path.join(__dirname, '..', 'build', 'withdraw_final.zkey');
    const vKeyPath = path.join(__dirname, '..', 'build', 'verification_key.json');
    if (fs.existsSync(wasmPath) && fs.existsSync(zkeyPath) && fs.existsSync(vKeyPath)) {
      vKey = JSON.parse(fs.readFileSync(vKeyPath, 'utf8'));
      buildArtifactsAvailable = true;
    } else {
      console.warn(
        'Property 1: build/ artifacts missing — running witness-only path. ' +
          'Run `bash compile.sh` to enable the full proof+verify path (recipient and amount mutations).',
      );
    }
  });

  it('honest input yields a valid witness/proof; mutations of path/preimage/amount/token fail', async function () {
    // ---- Generators -----------------------------------------------------
    const nonZeroFieldFromBytes = fc
      .uint8Array({ minLength: 32, maxLength: 32 })
      .map((bytes) => {
        const v = bytesToField(bytes);
        return v === 0n ? 1n : v;
      });
    // Recipient / token: 20-byte address space (Num2Bits(160) in circuit).
    const addressField = fc
      .uint8Array({ minLength: 20, maxLength: 20 })
      .map((bytes) => {
        const v = bytesToField(bytes);
        return v === 0n ? 1n : v;
      });
    // Amounts in (0, 2^128) — matches Num2Bits(128) + IsZero checks.
    const amountField = fc.bigInt({ min: 1n, max: (1n << 128n) - 1n });

    // Mutation parameter pair: byte offset (0..31) and non-zero delta (1..255).
    const mutationParam = fc.tuple(fc.nat({ max: 31 }), fc.integer({ min: 1, max: 255 }));

    await fc.assert(
      fc.asyncProperty(
        // Up to 8 leaves. Depth-20 supports millions, but per-iteration runtime
        // matters more than tree fullness for this property.
        fc.array(nonZeroFieldFromBytes, { minLength: 1, maxLength: 8 }),
        fc.nat({ max: 7 }), // chosen index modulo leaves.length
        nonZeroFieldFromBytes, // nullifier preimage
        nonZeroFieldFromBytes, // secret preimage
        addressField, // recipient
        amountField,
        addressField, // token
        // One mutation parameter per mutation site, in canonical order.
        fc.tuple(
          mutationParam, // pathElements
          mutationParam, // pathIndices (used only for offset; we flip the side bit)
          mutationParam, // nullifier
          mutationParam, // secret
          mutationParam, // merkleRoot
          mutationParam, // nullifierHash
          mutationParam, // recipient
          mutationParam, // amount
          mutationParam, // token
        ),
        // Tree level (0..LEVELS-1) at which to mutate pathElements / pathIndices.
        fc.nat({ max: TREE_LEVELS - 1 }),
        async (
          rawLeaves,
          rawIdx,
          nullifier,
          secret,
          recipient,
          amount,
          token,
          mutations,
          mutationLevel,
        ) => {
          // Build the tree, ensuring the chosen leaf is the commitment we know
          // a preimage for.
          const commitment = F.toObject(poseidon([nullifier, secret, amount, token]));
          const nullifierHash = F.toObject(poseidon([nullifier]));

          const leaves = [...rawLeaves];
          const chosenIdx = rawIdx % leaves.length;
          leaves[chosenIdx] = commitment;

          const tree = new IncrementalTree(poseidon, TREE_LEVELS);
          for (const l of leaves) tree.insert(l);

          const merkleRoot = tree.root();
          const { pathElements, pathIndices } = tree.path(chosenIdx);

          // Public inputs: [merkleRoot, nullifierHash, recipient, amount, token]
          const honestInput = {
            nullifier: nullifier.toString(),
            secret: secret.toString(),
            pathElements: pathElements.map((x) => x.toString()),
            pathIndices: pathIndices.map((x) => x.toString()),
            merkleRoot: merkleRoot.toString(),
            nullifierHash: nullifierHash.toString(),
            recipient: recipient.toString(),
            amount: amount.toString(),
            token: token.toString(),
          };

          // (a) Honest witness must be calculable and constraint-satisfying.
          const witness = await circuit.calculateWitness(honestInput, true);
          await circuit.checkConstraints(witness);

          // Optional: full Groth16 proof + verify when build artifacts exist.
          // We reuse the proof for the recipient / amount mutations below
          // (those mutate publicSignals[2] and publicSignals[3] respectively).
          let honestProof = null;
          let honestPublicSignals = null;
          if (buildArtifactsAvailable) {
            const out = await snarkjs.groth16.fullProve(honestInput, wasmPath, zkeyPath);
            honestProof = out.proof;
            honestPublicSignals = out.publicSignals;
            const ok = await snarkjs.groth16.verify(vKey, honestPublicSignals, honestProof);
            expect(ok, 'honest proof must verify against the deployed verification key').to.equal(
              true,
            );
            // Belt-and-suspenders: the canonical-order contract puts merkleRoot
            // at publicSignals[0] and nullifierHash at publicSignals[1].
            expect(honestPublicSignals[0]).to.equal(merkleRoot.toString());
            expect(honestPublicSignals[1]).to.equal(nullifierHash.toString());
            expect(honestPublicSignals[2]).to.equal(recipient.toString());
            expect(honestPublicSignals[3]).to.equal(amount.toString());
            expect(honestPublicSignals[4]).to.equal(token.toString());
          }

          const [
            pathElM,
            ,
            nullM, // pathIdxM unused — we flip the side bit instead
            secM,
            rootM,
            nhM,
            recM,
            amtM,
            tokM,
          ] = mutations;

          // (b1) pathElements[level] mutation: hash chain mismatches → root constraint fails.
          await expectWitnessFailure(
            circuit,
            () => {
              const inp = cloneInput(honestInput);
              const orig = pathElements[mutationLevel];
              const mut = makeMutator(orig)(pathElM[0], pathElM[1]);
              inp.pathElements = pathElements.map((x, i) =>
                i === mutationLevel ? mut.toString() : x.toString(),
              );
              return inp;
            },
            'pathElements mutation must fail witness gen',
          );

          // (b2) pathIndices[level] mutation: flipping the side bit at one
          // level routes the path through the wrong sibling → root mismatch.
          await expectWitnessFailure(
            circuit,
            () => {
              const inp = cloneInput(honestInput);
              inp.pathIndices = pathIndices.map((x, i) =>
                i === mutationLevel ? (x ^ 1).toString() : x.toString(),
              );
              return inp;
            },
            'pathIndices mutation must fail witness gen',
          );

          // (b3) nullifier mutation: both Poseidon(nullifier) === nullifierHash
          // and Poseidon(nullifier, secret, amount, token) === leaf will fail.
          await expectWitnessFailure(
            circuit,
            () => {
              const inp = cloneInput(honestInput);
              inp.nullifier = makeMutator(nullifier)(nullM[0], nullM[1]).toString();
              return inp;
            },
            'nullifier mutation must fail witness gen',
          );

          // (b4) secret mutation: Poseidon(nullifier, secret, amount, token) === leaf will fail.
          await expectWitnessFailure(
            circuit,
            () => {
              const inp = cloneInput(honestInput);
              inp.secret = makeMutator(secret)(secM[0], secM[1]).toString();
              return inp;
            },
            'secret mutation must fail witness gen',
          );

          // (b5) merkleRoot mutation: tree.root === merkleRoot constraint fails.
          await expectWitnessFailure(
            circuit,
            () => {
              const inp = cloneInput(honestInput);
              inp.merkleRoot = makeMutator(merkleRoot)(rootM[0], rootM[1]).toString();
              return inp;
            },
            'merkleRoot mutation must fail witness gen',
          );

          // (b6) nullifierHash mutation: Poseidon(nullifier) === nullifierHash fails.
          await expectWitnessFailure(
            circuit,
            () => {
              const inp = cloneInput(honestInput);
              inp.nullifierHash = makeMutator(nullifierHash)(nhM[0], nhM[1]).toString();
              return inp;
            },
            'nullifierHash mutation must fail witness gen',
          );

          // (b7) recipient mutation — still free at prove time (any address);
          // post-proof public-signal swap must fail verify when artifacts exist.
          if (buildArtifactsAvailable && vKey.nPublic === 5) {
            const mutated = makeMutator(recipient)(recM[0], recM[1]).toString();
            const mutatedPub = [...honestPublicSignals];
            mutatedPub[2] = mutated;
            const ok = await snarkjs.groth16.verify(vKey, mutatedPub, honestProof);
            expect(ok, 'verifier must reject recipient mutation').to.equal(false);
          }

          // (b8) amount mutation — economically bound in commitment; witness fails.
          await expectWitnessFailure(
            circuit,
            () => {
              const inp = cloneInput(honestInput);
              // Keep amount in (0, 2^128) so we don't fail only on range checks.
              let mut = makeMutator(amount)(amtM[0], amtM[1]);
              if (mut === 0n || mut >= 1n << 128n) mut = amount === 1n ? 2n : 1n;
              inp.amount = mut.toString();
              return inp;
            },
            'amount mutation must fail witness gen',
          );

          // (b9) token mutation — economically bound in commitment.
          await expectWitnessFailure(
            circuit,
            () => {
              const inp = cloneInput(honestInput);
              let mut = makeMutator(token)(tokM[0], tokM[1]);
              if (mut >= 1n << 160n) mut = token === 1n ? 2n : 1n;
              inp.token = mut.toString();
              return inp;
            },
            'token mutation must fail witness gen',
          );
        },
      ),
      { numRuns: 15 },
    );
  });
});
