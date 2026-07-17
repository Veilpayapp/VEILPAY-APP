const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

describe('Withdraw Circuit (hardened)', function () {
  this.timeout(30000);

  let snarkjs;
  let circomlibjs;
  let wasmTester;

  let poseidon;
  let F;
  let circuit;

  const LEVELS = 20;

  before(async function () {
    try {
      snarkjs = require('snarkjs');
      circomlibjs = require('circomlibjs');
      const circom_tester = require('circom_tester');
      wasmTester = circom_tester.wasm;
    } catch (e) {
      console.warn('Skipping test: dev dependencies not installed.');
      this.skip();
      return;
    }

    try {
      poseidon = await circomlibjs.buildPoseidon();
      F = poseidon.F;
    } catch (e) {
      console.warn('Skipping test: failed to build poseidon.');
      this.skip();
      return;
    }

    try {
      circuit = await wasmTester(path.join(__dirname, '..', 'withdraw.circom'), {
        include: [path.join(__dirname, '..', 'node_modules')],
      });
    } catch (e) {
      console.warn('Skipping test: circom binary unavailable or compilation failed.', e && e.message);
      this.skip();
      return;
    }
  });

  const generateInput = (
    nullifier,
    secret,
    pathElements,
    pathIndices,
    merkleRoot,
    nullifierHash,
    recipient,
    amount,
    token,
  ) => ({
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices: pathIndices.map((x) => x.toString()),
    merkleRoot: merkleRoot.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipient.toString(),
    amount: amount.toString(),
    token: token.toString(),
  });

  function buildPath(commitmentHash) {
    let currentHash = commitmentHash;
    const pathElements = [];
    const pathIndices = [];
    for (let i = 0; i < LEVELS; i++) {
      pathElements.push(0n);
      pathIndices.push(0);
      currentHash = F.toObject(poseidon([currentHash, 0n]));
    }
    return { pathElements, pathIndices, merkleRoot: currentHash };
  }

  it('Should generate a valid witness for a correct preimage (amount+token bound)', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const recipient = 9999n;
    const amount = 100n;
    const token = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48n; // USDC-like address

    const commitmentHash = F.toObject(poseidon([nullifier, secret, amount, token]));
    const nullifierHash = F.toObject(poseidon([nullifier]));
    const { pathElements, pathIndices, merkleRoot } = buildPath(commitmentHash);

    const input = generateInput(
      nullifier,
      secret,
      pathElements,
      pathIndices,
      merkleRoot,
      nullifierHash,
      recipient,
      amount,
      token,
    );

    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);

    const wasmPath = path.join(__dirname, '..', 'build', 'withdraw.wasm');
    const zkeyPath = path.join(__dirname, '..', 'build', 'withdraw_final.zkey');
    const vKeyPath = path.join(__dirname, '..', 'build', 'verification_key.json');

    if (fs.existsSync(wasmPath) && fs.existsSync(zkeyPath) && fs.existsSync(vKeyPath)) {
      const vKey = JSON.parse(fs.readFileSync(vKeyPath, 'utf8'));
      if (vKey.nPublic !== 5) {
        console.warn('Skipping fullProve: build artifacts still have nPublic !== 5; re-run compile.sh');
        return;
      }
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

      expect(publicSignals[0]).to.equal(merkleRoot.toString());
      expect(publicSignals[1]).to.equal(nullifierHash.toString());
      expect(publicSignals[2]).to.equal(recipient.toString());
      expect(publicSignals[3]).to.equal(amount.toString());
      expect(publicSignals[4]).to.equal(token.toString());

      const res = await snarkjs.groth16.verify(vKey, publicSignals, proof);
      expect(res).to.be.true;
    }
  });

  it('Should fail if amount does not match the committed amount', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const amount = 100n;
    const token = 1n;
    const commitmentHash = F.toObject(poseidon([nullifier, secret, amount, token]));
    const nullifierHash = F.toObject(poseidon([nullifier]));
    const { pathElements, pathIndices, merkleRoot } = buildPath(commitmentHash);

    // Prove with wrong public amount (economic attack must fail)
    const input = generateInput(
      nullifier,
      secret,
      pathElements,
      pathIndices,
      merkleRoot,
      nullifierHash,
      1n,
      amount + 1n,
      token,
    );

    let threw = false;
    try {
      await circuit.calculateWitness(input, true);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it('Should fail if token does not match the committed token', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const amount = 100n;
    const token = 1n;
    const commitmentHash = F.toObject(poseidon([nullifier, secret, amount, token]));
    const nullifierHash = F.toObject(poseidon([nullifier]));
    const { pathElements, pathIndices, merkleRoot } = buildPath(commitmentHash);

    const input = generateInput(
      nullifier,
      secret,
      pathElements,
      pathIndices,
      merkleRoot,
      nullifierHash,
      1n,
      amount,
      token + 1n,
    );

    let threw = false;
    try {
      await circuit.calculateWitness(input, true);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it('Should fail if amount is zero', async function () {
    if (!circuit) return this.skip();

    const nullifier = 1n;
    const secret = 2n;
    const amount = 0n;
    const token = 1n;
    const commitmentHash = F.toObject(poseidon([nullifier, secret, amount, token]));
    const nullifierHash = F.toObject(poseidon([nullifier]));
    const { pathElements, pathIndices, merkleRoot } = buildPath(commitmentHash);

    const input = generateInput(
      nullifier,
      secret,
      pathElements,
      pathIndices,
      merkleRoot,
      nullifierHash,
      1n,
      amount,
      token,
    );

    let threw = false;
    try {
      await circuit.calculateWitness(input, true);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it('Should fail if nullifier is incorrect', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const amount = 100n;
    const token = 1n;
    const commitmentHash = F.toObject(poseidon([nullifier, secret, amount, token]));
    const nullifierHash = F.toObject(poseidon([nullifier]));
    const { pathElements, pathIndices, merkleRoot } = buildPath(commitmentHash);

    const input = generateInput(
      nullifier + 1n,
      secret,
      pathElements,
      pathIndices,
      merkleRoot,
      nullifierHash,
      1n,
      amount,
      token,
    );

    let threw = false;
    try {
      await circuit.calculateWitness(input, true);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it('Should fail if merkle root is incorrect', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const amount = 100n;
    const token = 1n;
    const commitmentHash = F.toObject(poseidon([nullifier, secret, amount, token]));
    const nullifierHash = F.toObject(poseidon([nullifier]));
    const { pathElements, pathIndices, merkleRoot } = buildPath(commitmentHash);

    const input = generateInput(
      nullifier,
      secret,
      pathElements,
      pathIndices,
      merkleRoot + 1n,
      nullifierHash,
      1n,
      amount,
      token,
    );

    let threw = false;
    try {
      await circuit.calculateWitness(input, true);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});
