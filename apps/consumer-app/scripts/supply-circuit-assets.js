#!/usr/bin/env node
/**
 * Supply the withdraw-circuit prover binaries from a configurable pinned
 * source, digest-verify them against the SHA-256 pins baked in
 * apps/consumer-app/src/constants/circuit.ts, and hand off to the existing
 * staging path (scripts/stage-circuit-assets.js).
 *
 * WHY THIS EXISTS: packages/circuits/build/ and
 * apps/consumer-app/assets/circuits/ are both gitignored, so a fresh
 * checkout (CI runner, EAS build) has none of the ~10MB of prover
 * binaries. Until now the only sources were (a) compile the circuit
 * locally, or (b) commit the binaries to git. This script adds (c): fetch
 * them once from a pinned remote source (e.g. a GitHub release), with the
 * baked pins — not the transport — deciding whether the bytes are trusted.
 *
 * SOURCE (env CIRCUIT_ARTIFACTS_URL, or --source <value> on the CLI):
 *   1. An https/http BASE URL: each artifact is fetched at
 *      `<base>/<artifact-name>`, so a GitHub release works by setting the
 *      base to  https://github.com/<owner>/<repo>/releases/download/<tag>
 *      (asset names must be withdraw.wasm, withdraw_final.zkey, and
 *      snarkjs.min.js — for the UMD, snarkjs.min.umd is also accepted as
 *      an alias, so a plain mirror of assets/circuits/ works too).
 *      Redirects are followed (GitHub release assets 302 to a CDN).
 *   2. A local directory (plain path, or a file:// URL): the artifacts are
 *      read in place; no network is used at all.
 *
 * FAIL-CLOSED CONTRACT (mirrors stage-circuit-assets.js):
 *   - Every artifact's SHA-256 is verified against the baked pins BEFORE
 *     anything is trusted or staged: all three are fetched/read first,
 *     then all three digests are checked, and only then does any byte land
 *     in apps/consumer-app/assets/circuits/.
 *   - Unset/unconfigured source, unreachable source, HTTP error, or ANY
 *     digest mismatch => exit 1 and NOTHING is staged (the staged
 *     directory is left byte-identical to how it was found).
 *
 * PIN VERIFICATION IS DELIBERATELY DONE TWICE (supply + staging): the
 * supply half refuses to trust or stage bytes that do not match the pins
 * BEFORE anything is written, and the staging half re-verifies every byte
 * it writes (plus a post-write read-back). Defense in depth: a bug or
 * tamper in either layer alone cannot land wrong bytes in a build.
 *
 * Pin READING is duplicated from stage-circuit-assets.js (same regexes)
 * because that script executes main() at require time and cannot be
 * imported as a library without running. Both parsers read the same
 * single source of truth — the pins in src/constants/circuit.ts — so the
 * digests themselves are never duplicated; a parser regression in either
 * script fails loudly (both fatal() on an unparsable/missing pin).
 *
 * Usage (repo root or apps/consumer-app):
 *   CIRCUIT_ARTIFACTS_URL=<base-url-or-dir> node apps/consumer-app/scripts/supply-circuit-assets.js
 *   node apps/consumer-app/scripts/supply-circuit-assets.js --source <base-url-or-dir>
 * Exit code 0 = supplied, digest-verified, and staged; 1 = failure
 * (nothing partially trusted is left behind).
 *
 * Tests (scripts/__tests__/supply-circuit-assets.test.js) require this
 * module and inject a fake fetch/spawn/pins — the CLI always reads the
 * real baked pins from src/constants/circuit.ts (opts.pins exists for
 * in-process tests only and is not reachable from the command line).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '../..');
const OUT_DIR = path.join(APP_ROOT, 'assets', 'circuits');
const CONSTANTS_FILE = path.join(APP_ROOT, 'src', 'constants', 'circuit.ts');
const STAGE_SCRIPT = path.join(__dirname, 'stage-circuit-assets.js');

const ENV_VAR = 'CIRCUIT_ARTIFACTS_URL';

/** Per-artifact download timeout (the zkey is ~5.4MB). */
const FETCH_TIMEOUT_MS = 120_000;

/**
 * The three pinned binaries. `aliases` are the file names accepted from
 * the source (snarkjs.min.umd is byte-identical to snarkjs.min.js by
 * design — same pin — so a mirror of the staged directory works as a
 * source without renaming).
 */
const ARTIFACTS = [
  {
    name: 'withdraw.wasm',
    pinKey: 'wasm',
    aliases: ['withdraw.wasm'],
  },
  {
    name: 'withdraw_final.zkey',
    pinKey: 'zkey',
    aliases: ['withdraw_final.zkey'],
  },
  {
    name: 'snarkjs.min.js',
    pinKey: 'umd',
    aliases: ['snarkjs.min.js', 'snarkjs.min.umd'],
  },
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Parse a source spec (see header). Returns null when the value is empty.
 *   { kind: 'url',  base }  — https(s) base URL, artifacts at base/<name>
 *   { kind: 'local', dir }  — local directory (plain path or file:// URL)
 */
function parseSource(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  if (v === '') return null;
  if (/^https?:\/\//i.test(v)) {
    return { kind: 'url', base: v.replace(/\/+$/, ''), raw: v };
  }
  if (/^file:\/\//i.test(v)) {
    let p = v.slice('file://'.length);
    // file:///D:/dir -> D:/dir (Windows drive letter); file:///dir -> /dir
    if (/^\/[A-Za-z]:([\/\\]|$)/.test(p)) p = p.slice(1);
    return { kind: 'local', dir: path.resolve(p), raw: v };
  }
  return { kind: 'local', dir: path.resolve(v), raw: v };
}

/**
 * Read the pins baked in src/constants/circuit.ts. Duplicated from
 * stage-circuit-assets.js on purpose (see header comment): the pins live
 * in the TypeScript constants file, which stays the single source of
 * truth for both scripts.
 */
function readBakedPins() {
  let text;
  try {
    text = fs.readFileSync(CONSTANTS_FILE, 'utf8');
  } catch (e) {
    throw new Error(
      `cannot read ${path.relative(REPO_ROOT, CONSTANTS_FILE)} — the pins are baked there: ${e.message}`
    );
  }
  const pick = (name) => {
    const m = text.match(
      new RegExp(`export\\s+const\\s+${name}\\s*=\\s*'([0-9a-f]{64})'`)
    );
    if (!m) {
      throw new Error(
        `baked pin ${name} not found (or not a 64-hex literal) in ${path.relative(REPO_ROOT, CONSTANTS_FILE)}`
      );
    }
    return m[1];
  };
  const sri = text.match(
    /export\s+const\s+BAKED_SNARKJS_SRI\s*=\s*'(sha384-[A-Za-z0-9+/=]+)'/
  );
  if (!sri) {
    throw new Error(
      `baked pin BAKED_SNARKJS_SRI not found in ${path.relative(REPO_ROOT, CONSTANTS_FILE)}`
    );
  }
  return {
    wasm: pick('BAKED_CIRCUIT_WASM_SHA256'),
    zkey: pick('BAKED_CIRCUIT_ZKEY_SHA256'),
    umd: pick('BAKED_SNARKJS_SHA256'),
    sri: sri[1],
  };
}

/** Fetch one artifact from the base URL, trying each alias in order. */
async function fetchArtifact(fetchImpl, base, aliases) {
  let lastError = null;
  for (const alias of aliases) {
    const url = `${base}/${alias}`;
    let res;
    try {
      res = await fetchImpl(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`fetch failed for ${url}: ${e.message}`);
    }
    if (res && res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      return { name: alias, url, bytes };
    }
    lastError = new Error(
      `HTTP ${res && res.status} fetching ${url}`
    );
  }
  throw lastError || new Error(`no artifact fetched from ${base}`);
}

/** Read one artifact from a local directory, trying each alias in order. */
function readLocalArtifact(dir, aliases) {
  for (const alias of aliases) {
    const p = path.join(dir, alias);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return { name: alias, path: p, bytes: fs.readFileSync(p) };
    }
  }
  return null;
}

/**
 * Verify every artifact's digest BEFORE anything is staged. Returns the
 * verified artifacts keyed by canonical name; throws on any mismatch.
 */
function verifyAll(supplied, pins) {
  for (const artifact of ARTIFACTS) {
    const got = supplied[artifact.name];
    if (!got) {
      throw new Error(
        `artifact ${artifact.name} was not supplied — refusing to stage anything`
      );
    }
    const digest = sha256(got.bytes);
    if (digest !== pins[artifact.pinKey]) {
      throw new Error(
        `${artifact.name} digest mismatch.\n` +
          `  expected (pin): ${pins[artifact.pinKey]}\n` +
          `  actual:          ${digest}\n` +
          `  source:          ${got.url || got.path}\n` +
          `Refusing to stage: the source does not serve the pinned bytes ` +
          `(wrong release/tag, renamed asset, or a tampered source).`
      );
    }
  }
}

/**
 * Stage the (already digest-verified) snarkjs UMD where the staging
 * script will reuse it, then hand off to stage-circuit-assets.js with
 * --circuit-build-dir pointing at the supplied wasm/zkey. The staging
 * script re-verifies every byte it writes (deliberate double check, see
 * header) and runs --offline so the supply path never falls back to the
 * CDN — the pinned source is the only source here.
 */
function handOffToStaging({ spawnImpl, stageScript, outDir, sourceDir }) {
  const result = spawnImpl(
    process.execPath,
    [stageScript, '--circuit-build-dir', sourceDir, '--offline'],
    { stdio: 'inherit', env: process.env, cwd: APP_ROOT }
  );
  if (result.error) {
    throw new Error(
      `failed to spawn staging script ${stageScript}: ${result.error.message}`
    );
  }
  const status = result.status === null ? 1 : result.status;
  if (status !== 0) {
    throw new Error(
      `staging hand-off failed (exit ${status}) — nothing partially trusted is left behind`
    );
  }
}

/**
 * Main entry. opts (for in-process tests ONLY; the CLI path always uses
 * the real defaults):
 *   fetchImpl   — function(url, init) => Promise<Response-like {ok, status, arrayBuffer}>
 *   spawnImpl   — spawnSync-compatible
 *   outDir      — staging destination (default apps/consumer-app/assets/circuits)
 *   stageScript — path handed to spawnImpl
 *   pins        — pin map (default: read from src/constants/circuit.ts)
 *   source      — source spec value (default: --source arg, else env CIRCUIT_ARTIFACTS_URL)
 */
async function main(opts = {}) {
  const fetchImpl =
    opts.fetchImpl ||
    (typeof fetch === 'function'
      ? fetch
      : null);
  const spawnImpl = opts.spawnImpl || spawnSync;
  const outDir = opts.outDir || OUT_DIR;
  const stageScript = opts.stageScript || STAGE_SCRIPT;
  const pins = opts.pins || readBakedPins();
  const sourceValue =
    opts.source !== undefined && opts.source !== null
      ? opts.source
      : argvSource(process.argv.slice(2)) ?? process.env[ENV_VAR];

  const spec = parseSource(sourceValue);
  if (!spec) {
    throw new Error(
      `no circuit artifact source configured. Set ${ENV_VAR} (e.g. the download base URL of the ` +
        `GitHub release holding withdraw.wasm / withdraw_final.zkey / snarkjs.min.js, or a local ` +
        `directory with them) or pass --source <url-or-dir>. See docs/reference/circuit-asset-supply.md.`
    );
  }

  let sourceDir; // where the wasm/zkey come from for the staging hand-off
  let supplied; // canonical name -> {bytes, url|path}
  let tempDir = null;

  if (spec.kind === 'local') {
    if (!fs.existsSync(spec.dir) || !fs.statSync(spec.dir).isDirectory()) {
      throw new Error(
        `local source is not an existing directory: ${spec.dir} (${ENV_VAR}=${spec.raw})`
      );
    }
    sourceDir = spec.dir;
    supplied = {};
    for (const artifact of ARTIFACTS) {
      const got = readLocalArtifact(spec.dir, artifact.aliases);
      if (!got) {
        throw new Error(
          `local source ${spec.dir} is missing ${artifact.name} ` +
            `(accepted names: ${artifact.aliases.join(', ')}) — refusing to stage anything`
        );
      }
      supplied[artifact.name] = got;
    }
    console.log(
      `[supply-circuit-assets] source: local directory ${spec.dir} (no network)`
    );
  } else {
    if (!fetchImpl) {
      throw new Error(
        `no fetch implementation available (Node >= 18 required for a URL source)`
      );
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veilpay-circuit-supply-'));
    sourceDir = tempDir;
    supplied = {};
    try {
      for (const artifact of ARTIFACTS) {
        const got = await fetchArtifact(fetchImpl, spec.base, artifact.aliases);
        fs.writeFileSync(path.join(tempDir, artifact.name), got.bytes);
        supplied[artifact.name] = got;
      }
      console.log(
        `[supply-circuit-assets] source: ${spec.base} (downloaded to ${tempDir})`
      );
    } catch (e) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw e;
    }
  }

  try {
    // 1) Verify EVERY digest BEFORE anything is trusted or staged.
    verifyAll(supplied, pins);
    for (const artifact of ARTIFACTS) {
      const got = supplied[artifact.name];
      console.log(
        `OK ${artifact.name} (${got.bytes.length} bytes, sha256 ${pins[artifact.pinKey]}) from ${got.url || got.path}`
      );
    }

    // 2) Only now stage the verified UMD where staging will reuse it.
    fs.mkdirSync(outDir, { recursive: true });
    const umdPath = path.join(outDir, 'snarkjs.min.js');
    fs.writeFileSync(umdPath, supplied['snarkjs.min.js'].bytes);
    const readBack = fs.readFileSync(umdPath);
    if (sha256(readBack) !== pins.umd) {
      throw new Error(`post-write verification failed for ${umdPath}`);
    }
    console.log(
      `OK snarkjs.min.js staged (${readBack.length} bytes, sha256 ${pins.umd}) — staging will reuse it offline`
    );

    // 3) Hand off: stage script re-verifies and stages wasm/zkey (+ .umd copy).
    handOffToStaging({ spawnImpl, stageScript, outDir, sourceDir });

    console.log(
      `\nSupplied + digest-verified prover assets -> ${path.relative(REPO_ROOT, outDir)}`
    );
    console.log(
      `Every byte matched the pins in src/constants/circuit.ts; the staging script re-verified at write time.`
    );
    return { ok: true, source: spec.raw, sourceDir, outDir };
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/** --source <value> from an argv array (null when absent). */
function argvSource(argv) {
  const i = argv.indexOf('--source');
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  return null;
}

/** CLI runner: prints, maps failures to exit 1, exit 0 on success. */
function run() {
  main()
    .then((r) => {
      console.log(`[supply-circuit-assets] OK (${r.source})`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`[supply-circuit-assets] FATAL: ${e.message}`);
      process.exit(1);
    });
}

if (require.main === module) {
  run();
}

module.exports = {
  main,
  run,
  parseSource,
  readBakedPins,
  verifyAll,
  fetchArtifact,
  readLocalArtifact,
  sha256,
  ARTIFACTS,
  ENV_VAR,
  OUT_DIR,
  STAGE_SCRIPT,
};
