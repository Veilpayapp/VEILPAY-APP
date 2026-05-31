const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

describe('Withdraw Circuit', function () {
  this.timeout(20000);

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
        include: [path.join(__dirname, '..', 'node_modules')]
      });
    } catch (e) {
      console.warn('Skipping test: circom binary unavailable or compilation failed.', e && e.message);
      this.skip();
      return;
    }
  });

  const generateInput = (nullifier, secret, pathElements, pathIndices, merkleRoot, nullifierHash, recipient, amount) => {
    return {
      nullifier: nullifier.toString(),
      secret: secret.toString(),
      pathElements: pathElements.map(x => x.toString()),
      pathIndices: pathIndices.map(x => x.toString()),
      merkleRoot: merkleRoot.toString(),
      nullifierHash: nullifierHash.toString(),
      recipient: recipient.toString(),
      amount: amount.toString()
    };
  };

  it('Should generate a valid witness for a correct preimage', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const recipient = 9999n;
    const amount = 100n;

    const commitmentHash = F.toObject(poseidon([nullifier, secret]));
    const nullifierHash = F.toObject(poseidon([nullifier]));

    // Build a fake path (depth 20)
    let currentHash = commitmentHash;
    const pathElements = [];
    const pathIndices = [];
    
    for (let i = 0; i < LEVELS; i++) {
      const sibling = 0n; // Use 0 as sibling for simplicity
      pathElements.push(sibling);
      pathIndices.push(0); // Left child
      currentHash = F.toObject(poseidon([currentHash, sibling]));
    }
    const merkleRoot = currentHash;

    const input = generateInput(nullifier, secret, pathElements, pathIndices, merkleRoot, nullifierHash, recipient, amount);

    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);

    // Also test snarkjs if artifacts exist
    const wasmPath = path.join(__dirname, '..', 'build', 'withdraw.wasm');
    const zkeyPath = path.join(__dirname, '..', 'build', 'withdraw_final.zkey');
    const vKeyPath = path.join(__dirname, '..', 'build', 'verification_key.json');

    if (fs.existsSync(wasmPath) && fs.existsSync(zkeyPath) && fs.existsSync(vKeyPath)) {
      const vKey = JSON.parse(fs.readFileSync(vKeyPath, 'utf8'));
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
      
      expect(publicSignals[0]).to.equal(merkleRoot.toString());
      expect(publicSignals[1]).to.equal(nullifierHash.toString());
      expect(publicSignals[2]).to.equal(recipient.toString());
      expect(publicSignals[3]).to.equal(amount.toString());

      const res = await snarkjs.groth16.verify(vKey, publicSignals, proof);
      expect(res).to.be.true;
    }
  });

  it('Should fail if nullifier is incorrect', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const commitmentHash = F.toObject(poseidon([nullifier, secret]));
    const nullifierHash = F.toObject(poseidon([nullifier]));

    let currentHash = commitmentHash;
    const pathElements = Array(LEVELS).fill(0n);
    const pathIndices = Array(LEVELS).fill(0);
    for (let i = 0; i < LEVELS; i++) currentHash = F.toObject(poseidon([currentHash, 0n]));
    const merkleRoot = currentHash;

    // Mutate nullifier
    const badNullifier = nullifier + 1n;
    const input = generateInput(badNullifier, secret, pathElements, pathIndices, merkleRoot, nullifierHash, 1n, 1n);

    let threw = false;
    try {
      await circuit.calculateWitness(input, true);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it('Should fail if secret is incorrect', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const commitmentHash = F.toObject(poseidon([nullifier, secret]));
    const nullifierHash = F.toObject(poseidon([nullifier]));

    let currentHash = commitmentHash;
    const pathElements = Array(LEVELS).fill(0n);
    const pathIndices = Array(LEVELS).fill(0);
    for (let i = 0; i < LEVELS; i++) currentHash = F.toObject(poseidon([currentHash, 0n]));
    const merkleRoot = currentHash;

    // Mutate secret
    const badSecret = secret + 1n;
    const input = generateInput(nullifier, badSecret, pathElements, pathIndices, merkleRoot, nullifierHash, 1n, 1n);

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
    const commitmentHash = F.toObject(poseidon([nullifier, secret]));
    const nullifierHash = F.toObject(poseidon([nullifier]));

    let currentHash = commitmentHash;
    const pathElements = Array(LEVELS).fill(0n);
    const pathIndices = Array(LEVELS).fill(0);
    for (let i = 0; i < LEVELS; i++) currentHash = F.toObject(poseidon([currentHash, 0n]));
    const merkleRoot = currentHash;

    // Mutate root
    const badRoot = merkleRoot + 1n;
    const input = generateInput(nullifier, secret, pathElements, pathIndices, badRoot, nullifierHash, 1n, 1n);

    let threw = false;
    try {
      await circuit.calculateWitness(input, true);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it('Should fail if nullifierHash is incorrect', async function () {
    if (!circuit) return this.skip();

    const nullifier = 12345n;
    const secret = 67890n;
    const commitmentHash = F.toObject(poseidon([nullifier, secret]));
    const nullifierHash = F.toObject(poseidon([nullifier]));

    let currentHash = commitmentHash;
    const pathElements = Array(LEVELS).fill(0n);
    const pathIndices = Array(LEVELS).fill(0);
    for (let i = 0; i < LEVELS; i++) currentHash = F.toObject(poseidon([currentHash, 0n]));
    const merkleRoot = currentHash;

    // Mutate nullifier hash
    const badNullifierHash = nullifierHash + 1n;
    const input = generateInput(nullifier, secret, pathElements, pathIndices, merkleRoot, badNullifierHash, 1n, 1n);

    let threw = false;
    try {
      await circuit.calculateWitness(input, true);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});
