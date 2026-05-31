// Feature: veilpay-privacy-stack, Smoke test: compile.sh produces all four artifacts (Requirement 1.9, 3.1)
//
// Verifies that a clean run of `compile.sh` produces the four canonical
// artifacts the rest of the stack depends on:
//
//   1. build/withdraw.wasm                 (witness generator, > 0 bytes)
//   2. build/withdraw_final.zkey           (proving key, > 0 bytes)
//   3. build/verification_key.json         (parses, nPublic === 4, has vk_alpha_1)
//   4. ../contracts-evm/src/Groth16Verifier.sol
//        (declares `contract Groth16Verifier is IGroth16Verifier`,
//         contains the `VEILPAY_WRAPPER_INJECTED` sentinel,
//         no longer contains the pre-compile stub marker)
//
// The smoke test depends on the `circom` and `snarkjs` toolchains. In
// environments without them (CI without circom on PATH, contributor laptops
// before the toolchain has been installed), the test skips rather than
// failing — the goal here is to catch regressions in compile.sh, not to
// re-validate the toolchain itself.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const CIRCUITS_DIR = path.join(__dirname, '..');
const BUILD_DIR = path.join(CIRCUITS_DIR, 'build');
const VERIFIER_PATH = path.join(
  CIRCUITS_DIR,
  '..',
  'contracts-evm',
  'src',
  'Groth16Verifier.sol'
);

function toolchainAvailable() {
  try {
    execSync('circom --version', { stdio: 'ignore' });
  } catch (e) {
    return false;
  }
  try {
    execSync('snarkjs --version', { stdio: 'ignore' });
  } catch (e) {
    return false;
  }
  return true;
}

describe('compile.sh smoke test', function () {
  // Powers-of-tau setup is slow on a cold cache (no pot12_final.ptau yet);
  // 5 minutes covers a realistic worst case on a laptop.
  this.timeout(300_000);

  before(function () {
    if (!toolchainAvailable()) {
      // eslint-disable-next-line no-console
      console.warn(
        'Skipping compile.sh smoke test: circom or snarkjs not on PATH'
      );
      this.skip();
      return;
    }

    try {
      execSync('bash compile.sh', {
        cwd: CIRCUITS_DIR,
        stdio: 'inherit',
      });
    } catch (e) {
      // ENOENT here means `bash` itself is not available (e.g. Windows without
      // Git Bash). Treat that the same as a missing toolchain — skip rather
      // than fail, so this test stays green on misconfigured machines.
      if (e && e.code === 'ENOENT') {
        // eslint-disable-next-line no-console
        console.warn('Skipping compile.sh smoke test: bash not available');
        this.skip();
        return;
      }
      throw e;
    }
  });

  it('produces build/withdraw.wasm with non-zero size', function () {
    const wasmPath = path.join(BUILD_DIR, 'withdraw.wasm');
    expect(fs.existsSync(wasmPath), `${wasmPath} should exist`).to.equal(true);
    expect(fs.statSync(wasmPath).size).to.be.greaterThan(0);
  });

  it('produces build/withdraw_final.zkey with non-zero size', function () {
    const zkeyPath = path.join(BUILD_DIR, 'withdraw_final.zkey');
    expect(fs.existsSync(zkeyPath), `${zkeyPath} should exist`).to.equal(true);
    expect(fs.statSync(zkeyPath).size).to.be.greaterThan(0);
  });

  it('produces build/verification_key.json with nPublic === 4 and a vk_alpha_1 field', function () {
    const vkPath = path.join(BUILD_DIR, 'verification_key.json');
    expect(fs.existsSync(vkPath), `${vkPath} should exist`).to.equal(true);

    const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));

    // Snapshot the public-signal layout: the four declared public inputs
    // (merkleRoot, nullifierHash, recipient, amount) flow through to the
    // verification key as `nPublic = 4`. If this drifts, every consumer
    // (VeilPool.withdraw, the relayer, ZkpProver) silently breaks.
    expect(vk.nPublic).to.equal(4);

    // Sanity check: snarkjs always emits `vk_alpha_1` on a real groth16 vkey.
    // Its presence is a low-cost signal that the export step actually ran.
    expect(vk).to.have.property('vk_alpha_1');
  });

  it('produces a non-stub Groth16Verifier.sol with the canonical wrapper injected', function () {
    expect(
      fs.existsSync(VERIFIER_PATH),
      `${VERIFIER_PATH} should exist`
    ).to.equal(true);

    const source = fs.readFileSync(VERIFIER_PATH, 'utf8');

    // Wrapper hooks the snarkjs-generated verifier into IGroth16Verifier.
    expect(source).to.include('contract Groth16Verifier is IGroth16Verifier {');

    // Idempotency sentinel that compile.sh's post-processing step writes once
    // the wrapper has been injected. Its presence proves we ran the full
    // post-process pipeline, not just the raw snarkjs export.
    expect(source).to.include('VEILPAY_WRAPPER_INJECTED');

    // The pre-compile stub left this exact comment behind. If we still see
    // it, compile.sh did not overwrite the verifier and we are looking at
    // the placeholder, not a real proving key.
    expect(source).to.not.include(
      'Stub: real implementation injected by compile.sh post-processing.'
    );
  });
});
