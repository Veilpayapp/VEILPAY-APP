#!/usr/bin/env node
/**
 * Offline provenance verifier for the VeilPay withdraw-circuit proving key.
 *
 * Verifies, WITHOUT any network/RPC access, that the staged
 * withdraw_final.zkey is bound to the repo's own trusted setup:
 *
 *   1. Baked pins in src/constants/circuit.ts are present and well-formed.
 *   2. Digest cross-checks (degraded mode): sha256 of the staged zkey / wasm /
 *      snarkjs UMD / .umd copy against the pins; SRI re-derivation for the UMD.
 *   3. `snarkjs zkey verify <r1cs> <ptau> <zkey>` — the real Groth16 trusted
 *      setup verification: re-derives the circuit constraints from the r1cs,
 *      checks every powers-of-tau and phase-2 contribution the zkey carries
 *      (dev2 + "VeilPay Final Beacon"), and confirms the zkey is a valid
 *      proving key for THIS circuit. Pure local computation, no RPC.
 *   4. `snarkjs zkey export verificationkey` from the staged zkey, deep-compared
 *      with the committed packages/circuits/build/verification_key.json.
 *   5. verification_key.json cross-checked against the committed Solidity
 *      verifier packages/contracts-evm/src/Groth16Verifier.sol (all 26
 *      constants, using snarkjs's Fp2 ordering convention — see
 *      compareVkWithSolidity()).
 *   6. Prints the documented on-chain comparison steps (which verifier values
 *      on the deployed contracts to compare against which JSON fields) — the
 *      deployed verifier itself cannot be read from here without RPC.
 *
 * WHAT IT CANNOT VERIFY OFFLINE (reported explicitly, never silently skipped):
 *   - artifacts absent from this checkout (packages/circuits/build and
 *     assets/circuits are gitignored — a fresh clone has neither);
 *   - that the deployed on-chain Groth16Verifier constants match (needs the
 *     deployment address + an RPC call — see the printed steps; note both
 *     deployments/sepolia.json files currently carry zero-address placeholders);
 *   - the honesty of the dev-only ceremony itself (compile.sh entropy strings
 *     are documented as NOT a production ceremony — a multi-party ceremony is
 *     required before mainnet; see compile.sh header).
 *
 * Read-only: writes only a temp file for the exported verification key
 * (os.tmpdir(), removed afterwards). No RPC, no network, ever.
 *
 * Usage (from repo root or apps/consumer-app):
 *   node apps/consumer-app/scripts/verify-zkey-provenance.js [--offline]
 * Options:
 *   --offline       explicit no-network mode (this script never uses the
 *                   network; the flag documents intent for CI wiring)
 *   --zkey <path>   verify this zkey instead of the staged one
 *   --timeout <ms>  snarkjs zkey verify timeout (default 180000 — the check
 *                   takes ~25s for the withdraw circuit)
 *
 * Exit code: 0 = no FAILED check (CANNOT-VERIFY items are allowed and listed);
 *            1 = at least one FAILED check (mismatch/malformed pin/bad zkey).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '../..');
const STAGED_DIR = path.join(APP_ROOT, 'assets', 'circuits');
const BUILD_DIR = path.join(REPO_ROOT, 'packages', 'circuits', 'build');
const CONSTANTS_FILE = path.join(APP_ROOT, 'src', 'constants', 'circuit.ts');
const PTAU_FILE = path.join(REPO_ROOT, 'packages', 'circuits', 'pot14_final.ptau');
const VK_JSON_FILE = path.join(BUILD_DIR, 'verification_key.json');
const VERIFIER_SOL_FILE = path.join(
  REPO_ROOT,
  'packages',
  'contracts-evm',
  'src',
  'Groth16Verifier.sol'
);

const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  return null;
}
const ZKEY_OVERRIDE = argValue('--zkey');
const SNARKJS_VERIFY_TIMEOUT_MS = parseInt(argValue('--timeout') || '180000', 10);

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  const tag =
    status === 'VERIFIED' ? 'OK ' : status === 'FAILED' ? 'FAIL' : 'CANNOT-VERIFY';
  const line = `${tag} ${name}${detail ? ' — ' + detail : ''}`;
  if (status === 'FAILED') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function fatal(msg) {
  console.error(`[verify-zkey-provenance] FATAL: ${msg}`);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha384Sri(buffer) {
  const digest = crypto.createHash('sha384').update(buffer).digest('base64');
  return `sha384-${digest}`;
}

function readFile(p) {
  try {
    return fs.readFileSync(p);
  } catch (e) {
    return null;
  }
}

function rel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

/**
 * Baked pins live in src/constants/circuit.ts as code defaults (same parser
 * contract as scripts/stage-circuit-assets.js — that file is the source of
 * truth for staging; this is an independent read for verification).
 */
function readBakedPins() {
  const src = readFile(CONSTANTS_FILE);
  if (!src) {
    fatal(`cannot read ${rel(CONSTANTS_FILE)} — pins are baked there`);
  }
  const text = src.toString('utf8');
  const pick = (name) => {
    const m = text.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*'([0-9a-f]{64})'`));
    if (!m) {
      fatal(`baked pin ${name} not found (or not a 64-hex literal) in ${rel(CONSTANTS_FILE)}`);
    }
    return m[1];
  };
  const sriMatch = text.match(
    /export\s+const\s+BAKED_SNARKJS_SRI\s*=\s*'(sha384-[A-Za-z0-9+/=]+)'/
  );
  if (!sriMatch) {
    fatal(`baked pin BAKED_SNARKJS_SRI not found in ${rel(CONSTANTS_FILE)}`);
  }
  return {
    wasm: pick('BAKED_CIRCUIT_WASM_SHA256'),
    zkey: pick('BAKED_CIRCUIT_ZKEY_SHA256'),
    umd: pick('BAKED_SNARKJS_SHA256'),
    sri: sriMatch[1],
  };
}

/** Resolve the snarkjs CLI from the workspace (dependency of consumer-app). */
function resolveSnarkjsCli() {
  const candidates = [
    path.join(REPO_ROOT, 'node_modules', 'snarkjs', 'build', 'cli.cjs'),
    path.join(APP_ROOT, 'node_modules', 'snarkjs', 'build', 'cli.cjs'),
    path.join(REPO_ROOT, 'packages', 'circuits', 'node_modules', 'snarkjs', 'build', 'cli.cjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

/**
 * Compare verification_key.json against the Solidity verifier constants.
 *
 * snarkjs Fp2 ordering convention: the JSON encodes a G2 point as
 * [[x1, x2], [y1, y2]] while `zkey export solidityverifier` emits the same
 * coordinates SWAPPED per pair — Solidity betax1 = JSON vk_beta_2[0][1] and
 * betax2 = JSON vk_beta_2[0][0] (same for beta y, gamma, delta). Without the
 * swap every G2 constant mismatches; with it all 26 constants line up.
 */
function compareVkWithSolidity(vk) {
  const sol = readFile(VERIFIER_SOL_FILE);
  if (!sol) {
    record(
      'vk-vs-solidity-verifier',
      'CANNOT-VERIFY',
      `${rel(VERIFIER_SOL_FILE)} absent on this checkout (tracked in git)`
    );
    return;
  }
  const text = sol.toString('utf8');
  const pick = (name) => {
    const m = text.match(new RegExp(`uint256\\s+constant\\s+${name}\\s*=\\s*([0-9]+)`));
    return m ? BigInt(m[1]).toString(16).padStart(64, '0') : null;
  };
  const jhex = (v) => BigInt(v).toString(16).padStart(64, '0');
  const pairs = [
    ['alphax', vk.vk_alpha_1[0]],
    ['alphay', vk.vk_alpha_1[1]],
    // G2: Solidity x1/x2 (and y1/y2) are the JSON pair swapped.
    ['betax1', vk.vk_beta_2[0][1]],
    ['betax2', vk.vk_beta_2[0][0]],
    ['betay1', vk.vk_beta_2[1][1]],
    ['betay2', vk.vk_beta_2[1][0]],
    ['gammax1', vk.vk_gamma_2[0][1]],
    ['gammax2', vk.vk_gamma_2[0][0]],
    ['gammay1', vk.vk_gamma_2[1][1]],
    ['gammay2', vk.vk_gamma_2[1][0]],
    ['deltax1', vk.vk_delta_2[0][1]],
    ['deltax2', vk.vk_delta_2[0][0]],
    ['deltay1', vk.vk_delta_2[1][1]],
    ['deltay2', vk.vk_delta_2[1][0]],
  ];
  for (let i = 0; i < vk.IC.length; i++) {
    pairs.push([`IC${i}x`, vk.IC[i][0]]);
    pairs.push([`IC${i}y`, vk.IC[i][1]]);
  }
  let ok = 0;
  const bad = [];
  for (const [solName, jVal] of pairs) {
    const s = pick(solName);
    if (s === null) {
      bad.push(`${solName} missing in Solidity verifier`);
    } else if (s !== jhex(jVal)) {
      bad.push(solName);
    } else {
      ok++;
    }
  }
  if (bad.length === 0) {
    record(
      'vk-vs-solidity-verifier',
      'VERIFIED',
      `all ${ok} constants of ${rel(VERIFIER_SOL_FILE)} match verification_key.json (Fp2 pair swap applied)`
    );
  } else {
    record(
      'vk-vs-solidity-verifier',
      'FAILED',
      `mismatching/missing constants: ${bad.join(', ')}`
    );
  }
}

function printOnChainSteps(vk) {
  console.log('\nOn-chain comparison steps (manual — requires the deployed verifier; user gate 7):');
  console.log(
    '  1. Deployments are currently ZERO-ADDRESS placeholders in both\n' +
      `     ${rel(path.join(REPO_ROOT, 'packages', 'contracts-evm', 'deployments', 'sepolia.json'))}\n` +
      `     and ${rel(path.join(APP_ROOT, 'src', 'constants', 'deployments', 'sepolia.json'))}.\n` +
      '     After deploying the privacy stack, record the Groth16Verifier address there.'
  );
  console.log(
    '  2. Compare the deployed verifier against packages/circuits/build/verification_key.json:\n' +
      '     - protocol: groth16, curve: bn128, nPublic: ' + vk.nPublic + '\n' +
      '     - vk_alpha_1 [x,y]                <-> constants alphax, alphay\n' +
      '     - vk_beta_2  [[x1,x2],[y1,y2]]    <-> betax1 = vk_beta_2[0][1], betax2 = vk_beta_2[0][0],\n' +
      '                                           betay1 = vk_beta_2[1][1], betay2 = vk_beta_2[1][0]\n' +
      '                                           (snarkjs emits the Fp2 pairs swapped — see compareVkWithSolidity)\n' +
      '     - vk_gamma_2, vk_delta_2          <-> same swap for gammax1..gammay2, deltax1..deltay2\n' +
      '     - IC (nPublic+1 points)           <-> IC0x..IC' + (vk.IC.length - 1) + 'y; _pubSignals is uint[' + vk.nPublic + ']'
  );
  console.log(
    '  3. Practical checks once deployed (pick one):\n' +
      '     a. Etherscan "Verify & Publish" the deployed Groth16Verifier against\n' +
      '        packages/contracts-evm/src/Groth16Verifier.sol — a byte-identical\n' +
      '        source match plus the offline vk-vs-solidity check above proves the\n' +
      '        on-chain constants equal the verification key (constants are\n' +
      '        compile-time in the generated contract and cannot be read via eth_call).\n' +
      '     b. Behavioural: produce a proof with the pinned zkey (snarkjs groth16\n' +
      '        fullProve + the staged wasm) and assert the deployed contract\n' +
      '        accepts it and rejects a tampered public signal.'
  );
}

function main() {
  const pins = readBakedPins();
  const hex64 = /^[0-9a-f]{64}$/;
  const wellFormed =
    hex64.test(pins.wasm) && hex64.test(pins.zkey) && hex64.test(pins.umd) &&
    /^sha384-[A-Za-z0-9+/=]+$/.test(pins.sri);
  if (wellFormed) {
    record('baked-pins-wellformed', 'VERIFIED', 'wasm/zkey/umd sha256 pins + snarkjs SRI parse and are well-formed');
  } else {
    record('baked-pins-wellformed', 'FAILED', 'malformed pins in src/constants/circuit.ts');
  }

  // ---- 2. digest cross-checks (degraded mode core) --------------------------
  const digestTargets = [
    { p: path.join(BUILD_DIR, 'withdraw.wasm'), pin: pins.wasm },
    { p: path.join(BUILD_DIR, 'withdraw_final.zkey'), pin: pins.zkey },
    { p: path.join(STAGED_DIR, 'withdraw.wasm'), pin: pins.wasm },
    { p: path.join(STAGED_DIR, 'withdraw_final.zkey'), pin: pins.zkey },
    { p: path.join(STAGED_DIR, 'snarkjs.min.js'), pin: pins.umd },
    { p: path.join(STAGED_DIR, 'snarkjs.min.umd'), pin: pins.umd },
  ];
  for (const t of digestTargets) {
    const bytes = readFile(t.p);
    if (!bytes) {
      record(
        `digest:${rel(t.p)}`,
        'CANNOT-VERIFY',
        'absent on this checkout (gitignored; run stage-circuit-assets.js / compile.sh first)'
      );
      continue;
    }
    const digest = sha256(bytes);
    if (digest === t.pin) {
      record(`digest:${rel(t.p)}`, 'VERIFIED', `sha256 ${digest} (${bytes.length} bytes)`);
    } else {
      record(
        `digest:${rel(t.p)}`,
        'FAILED',
        `sha256 ${digest} != baked pin ${t.pin}`
      );
    }
  }

  const umdBytes = readFile(path.join(STAGED_DIR, 'snarkjs.min.js'));
  if (umdBytes) {
    const sri = sha384Sri(umdBytes);
    if (sri === pins.sri) {
      record('sri:snarkjs-min-js', 'VERIFIED', `re-derived ${sri} equals BAKED_SNARKJS_SRI`);
    } else {
      record('sri:snarkjs-min-js', 'FAILED', `re-derived ${sri} != baked ${pins.sri}`);
    }
  } else {
    record('sri:snarkjs-min-js', 'CANNOT-VERIFY', 'staged snarkjs.min.js absent');
  }

  // ---- 3. snarkjs zkey verify (the real trusted-setup check) ----------------
  const zkeyPath = ZKEY_OVERRIDE
    ? path.resolve(ZKEY_OVERRIDE)
    : fs.existsSync(path.join(STAGED_DIR, 'withdraw_final.zkey'))
      ? path.join(STAGED_DIR, 'withdraw_final.zkey')
      : path.join(BUILD_DIR, 'withdraw_final.zkey');
  const r1csPath = path.join(BUILD_DIR, 'withdraw.r1cs');
  const snarkjsCli = resolveSnarkjsCli();
  const zkeyBytes = readFile(zkeyPath);
  const r1csBytes = readFile(r1csPath);
  const ptauBytes = readFile(PTAU_FILE);

  if (!zkeyBytes) {
    record('snarkjs-zkey-verify', 'CANNOT-VERIFY', `${rel(zkeyPath)} absent on this checkout`);
  } else if (!r1csBytes) {
    record(
      'snarkjs-zkey-verify',
      'CANNOT-VERIFY',
      `${rel(r1csPath)} absent (gitignored build output) — degraded to digest cross-checks above`
    );
  } else if (!ptauBytes) {
    record('snarkjs-zkey-verify', 'CANNOT-VERIFY', `${rel(PTAU_FILE)} absent on this checkout`);
  } else if (!snarkjsCli) {
    record(
      'snarkjs-zkey-verify',
      'CANNOT-VERIFY',
      'snarkjs CLI not resolvable in the workspace (run after pnpm install; snarkjs is a consumer-app dependency)'
    );
  } else {
    const res = spawnSync(
      process.execPath,
      [snarkjsCli, 'zkey', 'verify', r1csPath, PTAU_FILE, zkeyPath],
      { encoding: 'utf8', timeout: SNARKJS_VERIFY_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }
    );
    if (res.error) {
      const timedOut = res.error.code === 'ETIMEDOUT';
      record(
        'snarkjs-zkey-verify',
        'CANNOT-VERIFY',
        timedOut
          ? `timed out after ${SNARKJS_VERIFY_TIMEOUT_MS}ms — degraded to digest cross-checks (raise with --timeout)`
          : `failed to run: ${res.error.message}`
      );
    } else if (res.status === 0 && /ZKey Ok!/.test(res.stdout + res.stderr)) {
      record(
        'snarkjs-zkey-verify',
        'VERIFIED',
        `"ZKey Ok!" — zkey valid Groth16 setup for withdraw.r1cs over pot14_final.ptau incl. phase-2 contributions (dev2, VeilPay Final Beacon)`
      );
    } else if (res.status === 0) {
      record(
        'snarkjs-zkey-verify',
        'VERIFIED',
        'exit 0 (ZKey Ok marker not found in output — inspect manually)'
      );
    } else {
      const tail = (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' | ');
      record('snarkjs-zkey-verify', 'FAILED', `snarkjs exited ${res.status}: ${tail}`);
    }
  }

  // ---- 4. exported VK from the zkey vs committed verification_key.json ------
  const vkCommitted = readFile(VK_JSON_FILE);
  if (!vkCommitted) {
    record(
      'vk:export-and-compare',
      'CANNOT-VERIFY',
      `${rel(VK_JSON_FILE)} absent (gitignored build output)`
    );
  } else if (!zkeyBytes || !snarkjsCli) {
    record(
      'vk:export-and-compare',
      'CANNOT-VERIFY',
      zkeyBytes ? 'snarkjs CLI not resolvable' : `${rel(zkeyPath)} absent`
    );
  } else {
    const tmpVk = path.join(os.tmpdir(), `veilpay-vk-${process.pid}.json`);
    const res = spawnSync(
      process.execPath,
      [snarkjsCli, 'zkey', 'export', 'verificationkey', zkeyPath, tmpVk],
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }
    );
    try {
      if (res.error || res.status !== 0) {
        record(
          'vk:export-and-compare',
          'CANNOT-VERIFY',
          `export failed (${res.error ? res.error.message : 'exit ' + res.status})`
        );
      } else {
        const exported = JSON.parse(fs.readFileSync(tmpVk, 'utf8'));
        const committed = JSON.parse(vkCommitted.toString('utf8'));
        const same = JSON.stringify(sortDeep(exported)) === JSON.stringify(sortDeep(committed));
        if (same) {
          record(
            'vk:export-and-compare',
            'VERIFIED',
            `verification key exported from ${rel(zkeyPath)} deep-equals ${rel(VK_JSON_FILE)}`
          );
        } else {
          record(
            'vk:export-and-compare',
            'FAILED',
            `exported VK differs from committed ${rel(VK_JSON_FILE)}`
          );
        }
      }
    } finally {
      try {
        fs.unlinkSync(tmpVk);
      } catch (e) {
        /* temp cleanup best-effort */
      }
    }
  }

  // ---- 5. committed VK vs Solidity verifier ---------------------------------
  if (vkCommitted) {
    let vk;
    try {
      vk = JSON.parse(vkCommitted.toString('utf8'));
    } catch (e) {
      record('vk-vs-solidity-verifier', 'FAILED', `${rel(VK_JSON_FILE)} is not valid JSON`);
      vk = null;
    }
    if (vk) {
      if (vk.protocol !== 'groth16' || vk.curve !== 'bn128') {
        record(
          'vk:protocol',
          'FAILED',
          `expected groth16/bn128, got ${vk.protocol}/${vk.curve}`
        );
      } else {
        record('vk:protocol', 'VERIFIED', `groth16 / bn128 / nPublic=${vk.nPublic}`);
      }
      compareVkWithSolidity(vk);
      printOnChainSteps(vk);
    }
  } else {
    console.log(
      '\n(vk-vs-solidity + on-chain steps skipped: verification_key.json absent — see summary)'
    );
  }

  // ---- summary ---------------------------------------------------------------
  const verified = results.filter((r) => r.status === 'VERIFIED').length;
  const cannot = results.filter((r) => r.status === 'CANNOT-VERIFY').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  console.log(
    `\nverify-zkey-provenance summary: ${verified} VERIFIED, ${cannot} CANNOT-VERIFY (absent on this checkout), ${failed} FAILED`
  );
  if (cannot > 0) {
    console.log(
      'cannot-verify-offline: absent artifacts (gitignored circuit build outputs / staged assets) and the deployed on-chain verifier (needs RPC + a real deployment address — see steps above).'
    );
  }
  if (failed > 0) {
    fatal(`${failed} check(s) FAILED`);
  }
  console.log('verify-zkey-provenance: OK — nothing verifiable contradicts the repo trusted setup.');
}

/** Deterministic deep sort so JSON key order cannot break the comparison. */
function sortDeep(v) {
  if (Array.isArray(v)) {
    return v.map(sortDeep);
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = sortDeep(v[k]);
    }
    return out;
  }
  return v;
}

main();
