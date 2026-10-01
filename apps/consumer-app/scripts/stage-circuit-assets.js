#!/usr/bin/env node
/**
 * Stage the withdraw-circuit prover assets into apps/consumer-app/assets/circuits/
 * and verify every byte against the SHA-256 pins baked in
 * apps/consumer-app/src/constants/circuit.ts.
 *
 * Staged files (see assets/circuits/README.md):
 *   withdraw.wasm         <- packages/circuits/build/withdraw.wasm
 *   withdraw_final.zkey   <- packages/circuits/build/withdraw_final.zkey
 *   snarkjs.min.js        <- pinned CDN URL (reused from disk when the digest matches)
 *   snarkjs.min.umd       <- byte-identical copy of snarkjs.min.js under a Metro
 *                            asset extension (a .js file cannot ride the asset pipeline)
 *
 * The script FAILS CLOSED on any digest mismatch: it never leaves a staged
 * file whose bytes do not match the baked pins, because release builds load
 * the prover from these files with no remote fallback.
 *
 * Usage (from repo root or from apps/consumer-app):
 *   node apps/consumer-app/scripts/stage-circuit-assets.js
 * Options:
 *   --circuit-build-dir <dir>  source for wasm/zkey (default: packages/circuits/build,
 *                              override: env CIRCUIT_BUILD_DIR)
 *   --offline                  never touch the network; fail if no valid staged
 *                              snarkjs.min.js copy exists locally
 *
 * Exit code 0 = staged and verified; non-zero = failure (nothing partially
 * trusted is left behind: mismatches abort before any file is replaced).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '../..');
const OUT_DIR = path.join(APP_ROOT, 'assets', 'circuits');
const CONSTANTS_FILE = path.join(APP_ROOT, 'src', 'constants', 'circuit.ts');

/** snarkjs version is pinned to the dependency range in package.json (^0.7.2 -> 0.7.2). */
const SNARKJS_CDN_URL =
  'https://cdn.jsdelivr.net/npm/snarkjs@0.7.2/build/snarkjs.min.js';

const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  return null;
}
const OFFLINE = argv.includes('--offline');

function fatal(msg) {
  console.error(`[stage-circuit-assets] FATAL: ${msg}`);
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

/**
 * The pins live in src/constants/circuit.ts as code defaults. Parse them from
 * the TypeScript source (a plain Node script cannot import the TS module) and
 * fail if any is missing — an unpinned build must never stage silently.
 */
function readBakedPins() {
  const src = readFile(CONSTANTS_FILE);
  if (!src) {
    fatal(`cannot read ${path.relative(REPO_ROOT, CONSTANTS_FILE)} — pins are baked there`);
  }
  const text = src.toString('utf8');
  const pick = (name) => {
    const m = text.match(
      new RegExp(`export\\s+const\\s+${name}\\s*=\\s*'([0-9a-f]{64})'`)
    );
    if (!m) {
      fatal(`baked pin ${name} not found (or not a 64-hex literal) in ${CONSTANTS_FILE}`);
    }
    return m[1];
  };
  const sriMatch = text.match(
    /export\s+const\s+BAKED_SNARKJS_SRI\s*=\s*'(sha384-[A-Za-z0-9+/=]+)'/
  );
  if (!sriMatch) {
    fatal(`baked pin BAKED_SNARKJS_SRI not found in ${CONSTANTS_FILE}`);
  }
  return {
    wasm: pick('BAKED_CIRCUIT_WASM_SHA256'),
    zkey: pick('BAKED_CIRCUIT_ZKEY_SHA256'),
    umd: pick('BAKED_SNARKJS_SHA256'),
    sri: sriMatch[1],
  };
}

/** Download the pinned UMD from the pinned URL. Rejects on any non-200. */
function downloadPinnedUmd() {
  return new Promise((resolve, reject) => {
    const req = https.get(SNARKJS_CDN_URL, { timeout: 30_000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching ${SNARKJS_CDN_URL}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => {
      req.destroy(new Error(`timeout fetching ${SNARKJS_CDN_URL}`));
    });
    req.on('error', reject);
  });
}

async function main() {
  const pins = readBakedPins();

  const buildDirArg =
    argValue('--circuit-build-dir') || process.env.CIRCUIT_BUILD_DIR || null;
  const buildDir = buildDirArg
    ? path.resolve(buildDirArg)
    : path.join(REPO_ROOT, 'packages', 'circuits', 'build');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---- wasm + zkey: local circuit build outputs ----------------------------
  const binaries = [
    { name: 'withdraw.wasm', pin: pins.wasm },
    { name: 'withdraw_final.zkey', pin: pins.zkey },
  ];
  for (const { name, pin } of binaries) {
    const src = path.join(buildDir, name);
    const bytes = readFile(src);
    if (!bytes) {
      fatal(
        `${path.relative(REPO_ROOT, src)} not found. Run packages/circuits/compile.sh ` +
          `or pass --circuit-build-dir / set CIRCUIT_BUILD_DIR to the build output.`
      );
    }
    const digest = sha256(bytes);
    if (digest !== pin) {
      fatal(
        `${name} digest mismatch.\n  expected (pin): ${pin}\n  actual:          ${digest}\n` +
          `Refusing to stage: either the circuit changed (update the pins in ` +
          `src/constants/circuit.ts deliberately) or the source file is wrong.`
      );
    }
    const dst = path.join(OUT_DIR, name);
    fs.writeFileSync(dst, bytes);
    const staged = readFile(dst);
    if (!staged || sha256(staged) !== pin) {
      fatal(`post-write verification failed for ${dst}`);
    }
    console.log(
      `OK ${name} (${bytes.length} bytes, sha256 ${digest}) from ${path.relative(REPO_ROOT, src)}`
    );
  }

  // ---- snarkjs UMD: reuse a valid staged copy, else pinned download ---------
  const umdPath = path.join(OUT_DIR, 'snarkjs.min.js');
  const umdCopyPath = path.join(OUT_DIR, 'snarkjs.min.umd');
  let umdBytes = readFile(umdPath);
  if (umdBytes && sha256(umdBytes) === pins.umd) {
    console.log(
      `OK snarkjs.min.js reused from ${path.relative(REPO_ROOT, umdPath)} (sha256 ${pins.umd})`
    );
  } else {
    if (OFFLINE) {
      fatal(
        `--offline: no digest-valid snarkjs.min.js at ${path.relative(REPO_ROOT, umdPath)} ` +
          `and network use is disabled.`
      );
    }
    console.log(`downloading pinned UMD ${SNARKJS_CDN_URL} ...`);
    try {
      umdBytes = await downloadPinnedUmd();
    } catch (e) {
      fatal(`download failed: ${e.message}`);
    }
    const digest = sha256(umdBytes);
    if (digest !== pins.umd) {
      fatal(
        `snarkjs.min.js digest mismatch.\n  expected (pin): ${pins.umd}\n  actual:          ${digest}\n` +
          `The pinned URL no longer serves the pinned bytes (or a proxy tampered them).`
      );
    }
    fs.writeFileSync(umdPath, umdBytes);
    console.log(
      `OK snarkjs.min.js (${umdBytes.length} bytes, sha256 ${digest}) from ${SNARKJS_CDN_URL}`
    );
  }

  // SRI re-derivation: the sha384 SRI baked into the constants must match the
  // exact UMD bytes we just verified by sha256.
  const sri = sha384Sri(umdBytes);
  if (sri !== pins.sri) {
    fatal(
      `BAKED_SNARKJS_SRI mismatch.\n  expected: ${pins.sri}\n  actual:   ${sri}`
    );
  }
  console.log(`OK snarkjs SRI verified: ${sri}`);

  // ---- Metro asset copy (.umd extension) ------------------------------------
  fs.writeFileSync(umdCopyPath, umdBytes);
  const copyBytes = readFile(umdCopyPath);
  if (!copyBytes || sha256(copyBytes) !== pins.umd) {
    fatal(`post-write verification failed for ${umdCopyPath}`);
  }
  console.log(
    `OK snarkjs.min.umd (${copyBytes.length} bytes, sha256 ${pins.umd}) — Metro asset copy of snarkjs.min.js`
  );

  console.log(`\nStaged + digest-verified prover assets -> ${path.relative(REPO_ROOT, OUT_DIR)}`);
  console.log(
    `Release builds bundle these (no remote fallback); Metro requires them to be present.`
  );
}

main().catch((e) => {
  fatal(e && e.stack ? e.stack : String(e));
});
