# Withdraw-circuit assets (Groth16 max-privacy prover)

Staged binaries for `ZkpProver` (the WebView-hosted snarkjs bridge used by the
`'max'` privacy payment flow). Staged on disk by
[`scripts/stage-circuit-assets.js`](../../scripts/stage-circuit-assets.js) and
**gitignored** — nothing in this directory is committed except `.gitignore`
and this `README.md` (mirrors `assets/spp/circuits/`).

## Files

| File | ~Size | Role |
|------|-------|------|
| `withdraw.wasm` | 2.6 MB | Circom witness generator for `withdraw.circom` |
| `withdraw_final.zkey` | 5.4 MB | Groth16 proving key (powers-of-tau + phase-2 beacon) |
| `snarkjs.min.js` | 0.7 MB | snarkjs **0.7.2** UMD (reference copy, digest-pinned) |
| `snarkjs.min.umd` | 0.7 MB | Byte-identical copy of `snarkjs.min.js` staged under a Metro **asset** extension — a `.js` file cannot ride the Metro asset pipeline, so the `.umd` copy is what `ZkpProver` requires and inlines into the WebView |

## Sources (all digest-verified at stage time)

- `withdraw.wasm`, `withdraw_final.zkey` — copied from
  `packages/circuits/build/` (output of `packages/circuits/compile.sh`).
  Override the source dir with `CIRCUIT_BUILD_DIR` if needed.
- `snarkjs.min.js` / `snarkjs.min.umd` — the pinned
  `https://cdn.jsdelivr.net/npm/snarkjs@0.7.2/build/snarkjs.min.js`
  (0.7.2 is the version the app's `package.json` depends on). The staging
  script reuses an already-staged copy when its digest matches, otherwise it
  downloads exactly this URL.

## Pinned SHA-256 digests

Baked into `src/constants/circuit.ts` (`BAKED_CIRCUIT_WASM_SHA256`,
`BAKED_CIRCUIT_ZKEY_SHA256`, `BAKED_SNARKJS_SHA256`, `BAKED_SNARKJS_SRI`) and
enforced by the staging script (fails on mismatch):

```
withdraw.wasm        4292cc33840274ba8bbd9ce19fb5f2b371215af23d8e184b57824654ad9835a8
withdraw_final.zkey  2269a668ed5076dcb3fbcacd58613ba796d6231ab85a71b4f613bcbb6b5898b3
snarkjs.min.js       ed55d1f120a0333de24a8b632737e3244331e819d7d6411d75b3c0b0a91ea9ac
snarkjs SRI          sha384-GKtjkchdpNyrZRMyv1vJbvxxe5DWCz50yHyXQkbRumBABaTfx7yBR5fAGk6pUD//
```

## Build implications

- **Release builds REQUIRE these staged files.** `ZkpProver` statically
  requires `withdraw.wasm` / `withdraw_final.zkey` / `snarkjs.min.umd` (via
  `metro.config.js` `assetExts` additions `wasm`/`zkey`/`umd`), so Metro fails
  the bundle when they are missing — there is no remote fallback. In release
  the prover is **off the CDN**: the snarkjs UMD is inlined into the WebView
  HTML from the bundled asset and the wasm/zkey are loaded from the device
  filesystem; a build whose integrity pins (`SNARKJS_SRI` /
  `CIRCUIT_WASM_SHA256` / `CIRCUIT_ZKEY_SHA256`) are empty or do not match the
  baked digests throws `CIRCUIT_PINS_NOT_ENFORCED` (fail closed) before any
  proof is attempted.
- **Dev builds** also need the files staged (same Metro requirement), but the
  dev prover path may still fetch remote artifacts overridable via
  `EXPO_PUBLIC_CIRCUIT_WASM_URL` / `EXPO_PUBLIC_CIRCUIT_ZKEY_URL` /
  `EXPO_PUBLIC_SNARKJS_URL`, with REQUIRED-IF-CONFIGURED pin checks.
- After a fresh clone, run once:
  `node apps/consumer-app/scripts/stage-circuit-assets.js`
- EAS archives pack from the git root; the app `.easignore` re-includes this
  directory so staged binaries ship in the build archive. Note that the EAS
  build worker still needs `packages/circuits/build` (or another source) to
  stage from — see the staging script's `--circuit-build-dir` flag.

## License note

Compiled circom artifacts include circomlib (LGPLv3), as with the SPP circuit
assets — bundle the notices when shipping in a release APK.
