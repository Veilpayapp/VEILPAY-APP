const { expect } = require('chai');
const path = require('path');

describe('Deposit Circuit', function () {
  this.timeout(20000);

  let circomlibjs;
  let wasmTester;
  let poseidon;
  let F;
  let circuit;

  before(async function () {
    try {
      circomlibjs = require('circomlibjs');
      const circom_tester = require('circom_tester');
      wasmTester = circom_tester.wasm;
      poseidon = await circomlibjs.buildPoseidon();
      F = poseidon.F;
      circuit = await wasmTester(path.join(__dirname, '..', 'deposit.circom'), {
        include: [path.join(__dirname, '..', 'node_modules')],
      });
    } catch (e) {
      console.warn('Skipping deposit tests:', e && e.message);
      this.skip();
      return;
    }
  });

  it('accepts a well-formed commitment for (amount, token)', async function () {
    if (!circuit) return this.skip();

    const nullifier = 11n;
    const secret = 22n;
    const amount = 1000n;
    const token = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48n;
    const commitment = F.toObject(poseidon([nullifier, secret, amount, token]));

    const witness = await circuit.calculateWitness(
      {
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        commitment: commitment.toString(),
        amount: amount.toString(),
        token: token.toString(),
      },
      true,
    );
    await circuit.checkConstraints(witness);
  });

  it('rejects overstated amount (deposit integrity)', async function () {
    if (!circuit) return this.skip();

    const nullifier = 11n;
    const secret = 22n;
    const amount = 1000n;
    const token = 1n;
    // Commitment for amount=1000 but claim public amount=1_000_000
    const commitment = F.toObject(poseidon([nullifier, secret, amount, token]));

    let threw = false;
    try {
      await circuit.calculateWitness(
        {
          nullifier: nullifier.toString(),
          secret: secret.toString(),
          commitment: commitment.toString(),
          amount: (amount * 1000n).toString(),
          token: token.toString(),
        },
        true,
      );
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it('rejects zero amount', async function () {
    if (!circuit) return this.skip();

    const nullifier = 1n;
    const secret = 2n;
    const amount = 0n;
    const token = 1n;
    const commitment = F.toObject(poseidon([nullifier, secret, amount, token]));

    let threw = false;
    try {
      await circuit.calculateWitness(
        {
          nullifier: nullifier.toString(),
          secret: secret.toString(),
          commitment: commitment.toString(),
          amount: '0',
          token: token.toString(),
        },
        true,
      );
    } catch (e) {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});
