# Circuit asset supply and pinning

How the Veilpay consumer app gets its Groth16 withdraw-circuit prover
binaries onto a machine that has none of them — without committing ~10MB of
binaries to git — and how the SHA-256 pins baked in the app guarantee the
bytes no matter where they came from.

The three artifacts:

| Artifact | Size (current pin) | Role |
| --- | --- | --- |
| `withdraw.wasm` | ~2.6 MB | circuit witness generator |
| `withdraw_final.zkey` | ~5.4 MB | proving key (post powers-of-tau + beacon) |
| `snarkjs.min.js` | ~0.7 MB | snarkjs 0.7.2 UMD (the prover itself) |

Both `packages/circuits/build/` (the compile outputs) and
`apps/consumer-app/assets/circuits/` (the staged copies Metro bundles) are
gitignored, so a fresh clone starts with none of these files.

## The guarantee: pins, not transport

The SHA-256 digest of each artifact is baked as a code default in
[`apps/consumer-app/src/constants/circuit.ts`](../../apps/consumer-app/src/constants/circuit.ts)
(`BAKED_CIRCUIT_WASM_SHA256`, `BAKED_CIRCUIT_ZKEY_SHA256`,
`BAKED_SNARKJS_SHA256`, plus the snarkjs SRI hash). Release builds enforce
these pins at runtime configuration level (`assertCircuitIntegrityPinned`),
and every staging/supply path verifies every byte against them **before
anything is staged**:

- Digest mismatch → the script exits 1 and **stages nothing** (the staged
  directory is left byte-identical to how it was found).
- Missing or unconfigured source → exit 1, nothing staged.
- A build can therefore never bundle prover bytes that do not match the
  pins, regardless of where the bytes came from (local compile, a GitHub
  release, or any other mirror).

Pin verification is deliberately performed twice — once by the supply path
before anything is trusted or staged, and again by the staging script when
the bytes are written (including a post-write read-back). A bug or tamper
in either layer alone cannot land wrong bytes in a build.

## Ways to get the artifacts

1. **Compile the circuit** (developer machines):
   `packages/circuits/compile.sh` produces `withdraw.wasm` and
   `withdraw_final.zkey` in `packages/circuits/build/`; then stage:
   `node apps/consumer-app/scripts/stage-circuit-assets.js`
   (or `pnpm --filter consumer-app circuits:stage`). The snarkjs UMD is
   reused from a valid staged copy or downloaded from the pinned CDN URL.

2. **Supply from a pinned source** (CI runners, fresh checkouts, build
   machines): set `CIRCUIT_ARTIFACTS_URL` to a source and run
   `node apps/consumer-app/scripts/supply-circuit-assets.js`
   (or `pnpm --filter consumer-app circuits:supply`).

## The supply source: `CIRCUIT_ARTIFACTS_URL`

Accepted values:

- **An `https` base URL** — each artifact is fetched at
  `<base>/<artifact-name>`. For a GitHub release, set the base to the
  release's download URL prefix:
  `https://github.com/<owner>/<repo>/releases/download/<tag>`
  (redirects are followed; release assets 302 to a CDN). Asset names must
  be `withdraw.wasm`, `withdraw_final.zkey`, and `snarkjs.min.js`
  (`snarkjs.min.umd` is accepted as an alias for the UMD, so a plain
  mirror of `apps/consumer-app/assets/circuits/` also works).
- **A local directory** (plain path or `file://` URL) containing the three
  files — no network is used at all.

### One-time setup (the user gate)

1. Upload the three binaries to a GitHub release (or any other pinned
   https source you control). Tag suggestion: a dedicated tag such as
   `circuits-v1` so the URL is stable.
2. Set the repository **variable** (not a secret — the URL is not
   sensitive; the pins, not the URL, provide the integrity guarantee):
   GitHub → Settings → Secrets and variables → Actions → Variables →
   `CIRCUIT_ARTIFACTS_URL` = the download base URL from step 1.

That is the entire one-time action: the binaries stay out of git, and
every future fresh runner supplies them from the pinned source.

### What the supply script does

1. Resolves the source (env `CIRCUIT_ARTIFACTS_URL` or `--source <value>`).
2. Fetches (or reads) **all three** artifacts.
3. Verifies **every** SHA-256 against the baked pins — before anything is
   trusted or staged; a mismatch exits 1 with nothing staged.
4. Stages the verified snarkjs UMD where the staging script will reuse it,
   then hands off to `scripts/stage-circuit-assets.js`
   (`--circuit-build-dir <supplied dir> --offline`) which re-verifies and
   stages `withdraw.wasm` / `withdraw_final.zkey` / the `.umd` Metro asset
   copy. The CDN is never used in the supply path.

## Where this runs

- **`.github/workflows/android-build.yml`** (the Android APK build):
  stage/supply runs immediately before the EAS local build. Order of
  resolution: local `packages/circuits/build` outputs if present, else the
  supply script with the `CIRCUIT_ARTIFACTS_URL` repository variable
  (`vars.CIRCUIT_ARTIFACTS_URL`). If neither source works, the workflow
  fails closed — no APK is built with missing or wrong prover bytes.
- **EAS builds** (the `eas-build-post-install` npm hook,
  `apps/consumer-app/eas-hooks/stage-circuits.js`): re-verifies every
  archived staged asset against the baked pins, offline, and fails the
  build on any mismatch. In CI the workflow has already supplied/staged
  the assets before the EAS build archive is created.
- **`.github/workflows/ci.yml`** (`circuits-sanity` job): offline
  `--verify-pins` mode — the baked pins parse, and every circuit artifact
  present on the checkout matches its pin.

## Rotating the circuit

When the circuit changes deliberately, the pins change with it: update the
digests in `apps/consumer-app/src/constants/circuit.ts` (the file documents
how to recompute them), re-upload the binaries, and keep
`CIRCUIT_ARTIFACTS_URL` pointed at a source serving the new bytes. Old
sources serving old bytes will fail closed against the new pins — that is
the guarantee working, not a bug.
