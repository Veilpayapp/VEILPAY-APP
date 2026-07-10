# SPP Phase 0 — Spike Findings (read-only)

> Recorded 2026-07-09. Submodule `packages/vendor/spp` @ `dbe6a98323c954d39bd5204f6ba58905cc27d2d7`.
> These are **facts read from the vendored repo**, correcting several assumptions the integration
> plan and the `stellar-spp-plan` memory locked in. No app code changed.

## Headline: two locked assumptions were WRONG

### 1. Curve is **BN254**, not BLS12-381 ❌→✅
The plan (`§1`, `§2`) and memory both state "SPP/Soroban = BLS12-381 → separate ZK pipeline."
**This is incorrect.** Evidence:
- Workspace `Cargo.toml`s reference `ark-bn254` **11×**, `ark-bls12-381` **0×**.
- On-chain verifier is `contracts/circom-groth16-verifier/`, lib.rs comment: *"BN254 precompile"*,
  imports `crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine}` (Soroban BN254 host fns).
- `circuit-keys` crate depends on `ark-bn254` + `ark-groth16`.

**Consequence:** SPP is the **same curve** as our existing `packages/circuits/withdraw.circom`
(BN254 Groth16). The plan's "separate ZK pipeline, only tooling reuse, not artifacts" framing is
half-right: still a separate *circuit set + keys*, but the **curve, arkworks stack, and Poseidon
family may be far more reusable than assumed.** Worth re-checking whether our existing prover
tooling can be shared rather than duplicated.

### 2. Prover mechanism = **Circom + ark-circom + ark-groth16, compiled to WASM** (resolved, was #1 unknown)
- `sdk/prover` — *"Browser WASM module for ZK proof generation using Groth16"*, deps: `ark-circom`,
  `ark-groth16`, `ark-snark`, `ark-bn254`.
- `sdk/witness` — *"Browser WASM witness generation using ark-circom"*.
- `sdk/web` — `crate-type = ["cdylib", "rlib"]`, `wasm-bindgen` bindings → npm package
  `stellar-private-payments-sdk-web`. Built via **Trunk** (`Trunk.toml`, target `app/index.html`).
- Circuits are real Circom: `circuits/src/*.circom` (policyTransaction, merkleProof, poseidon2, …).

**So: NOT snarkjs, NOT rapidsnark.** It's Rust→WASM via wasm-bindgen for the *browser* demo.
The doc's "snarkjs TypeScript SDK" does not exist. For mobile: compile the same Rust **pool SDK**
natively (JSI/Nitro/Uniffi) — product WebView of `sdk/web` is **rejected** (locked 2026-07-09).

## Other de-risking findings

### 3. A LIVE testnet deployment already ships — we may not need to deploy anything
`deployments/testnet/deployments.json` contains real Stellar **testnet** contract IDs:
- `verifier`: `CCKNCZXDGM7Z7EHL7PVQEYRDK636TZJIDODO5TSAS5BME2JYGMFR3MU3`
- `asp_membership`: `CDSJXWV5JITIQLXNM4AEI53RY2UQLOQBCG6WKYCFPWS5AHBAD3FWAVNH`
- `asp_non_membership`: `CBG3BT6KHJM3UQGSUP2GHPQE5FLPEYBFVF47DCDHH6UOYQ6KDT5URJTI`
- `public_key_registry`: `CB3IAFWZPU5H5MQ4NEMQCWLZJ6PAYZWLAA4DZIRZZCWXSI2WV6C7L556`
- Pools: native XLM (`CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH`) and
  EURC classic asset (`CAS6HJRISNXG72EOJ4V4YIS4TQOJRIRCZSJRPIBEDN2ALZMJEVAIGPWU`).
- deployer/admin: `GDF4BXPQY5N4BEO24UIHM4NVB62MW7HDWH7SVHKLVZAMLP5IIHCFQORC`.

**Consequence:** the "deploy to testnet unmodified" Phase 0 step may reduce to *point the CLI at
these existing IDs and run deposit→transfer→withdraw* — much cheaper. (Verify they're still live /
funded before relying on them; a self-deploy via `deployments/scripts/deploy.sh` is the fallback.)

### 4. Prebuilt proving keys ARE shipped → testnet inherits their trusted setup (no ceremony for v1) ✅
`deployments/testnet/circuit_keys/`:
- `policy_tx_2_2_proving_key.bin` — **7.8 MB** (the main transaction circuit; this is the mobile
  bundle-size + load number to design around).
- `selectiveDisclosure_{1..4}_proving_key.bin` — 1.1 / 2.2 / 3.0 / 4.4 MB.
- Matching `*_vk.json`, `*_vk_soroban.bin`, `*_vk_const.rs`.
Keys are arkworks-serialized (`circuit-keys/src/lib.rs::write_proving_key_bin`), with soroban VK
export helpers. **~19 MB total** proving-key payload — real but shippable; the 7.8 MB tx key is the
one that matters for the withdraw/transfer UX.

### 5. Licensing — clean for a closed mobile binary ✅
- Root `LICENSE` = **Apache-2.0**.
- `circuits/LICENSE` legal-nuance doc clarifies:
  - `circuits/build.rs` links iden3 `circom` (**GPLv3**) but is **build-time only, not compiled into
    artifacts → no contamination**.
  - `.circom` files import `circomlib` (**LGPLv3**); compiled `.r1cs`/`.wasm` statically link it, so
    **distribution of compiled circuit artifacts must honor LGPLv3** (allow user to re-link a
    modified circomlib). Apache-2.0 source + LGPLv3 lib is a supported combo.
  - `deployments/legal/` ships the distribution notice templates to bundle into `dist/`.
- **Action for us:** if we ship the compiled circuit WASM/keys in the app, include the LGPLv3
  notice + offer re-link capability (documented obligation, not a blocker). Note in our `SECURITY.md`.

## Toolchain confirmed on this machine
Rust 1.96.1 (default host), SPP pin `rust-toolchain.toml` → **1.92.0**, cargo, stellar-cli 27.0.0
(Soroban), git 2.54 w/ submodules. `Makefile` targets: `build`, `release`, `serve`, `circuits-build`,
`sdk-web-build`, `install`, `doc`. `circomlib.lock` pins circuit deps.

CLI package name: **`stellar-private-payments-cli`** (binary `spp`), not cargo `-p spp`.

## Product architecture decision (2026-07-09) — native mobile, not product WebView
Shipping SPP as a **browser-style WebView** of `sdk/web` is rejected for full mobile integration.
Target: wrap **native** `stellar-private-payments-sdk` (`sdk/pool`, same as CLI) via JSI/Nitro/Uniffi
into RN. Pure RN UI + app SQLite + biometric signing. WebView only optional for throwaway spikes.

## Phase 0 progress (this session)

### ✅ 0.3 Testnet contracts still live
`stellar contract info interface --network testnet` succeeded for:
- Pool (native XLM): `CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH` — has `transact`, `get_root`
- Verifier: `CCKNCZXDGM7Z7EHL7PVQEYRDK636TZJIDODO5TSAS5BME2JYGMFR3MU3` — has `verify(Groth16Proof, …)`
- Public key registry: `CB3IAFWZPU5H5MQ4NEMQCWLZJ6PAYZWLAA4DZIRZZCWXSI2WV6C7L556` — has `register(Account)`

Self-deploy not required for testnet dogfood (unless funds/admin later missing).

### ✅ 0.1 Native `cargo build` unblocked (2026-07-09)

**What was wrong:** no MSVC `link.exe`.  
**What we did:** installed **Visual Studio 2022 Build Tools** (`Microsoft.VisualStudio.2022.BuildTools`
+ VCTools workload) via winget.

**Next failure:** `circuits` build-script `STATUS_STACK_OVERFLOW` on Windows (circom parse).  
**Fix:** build with enlarged PE stack:

```bat
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set RUSTFLAGS=-C link-arg=/STACK:0x20000000
cd packages/vendor/spp
cargo build -p stellar-private-payments-sdk --release
cargo build -p stellar-private-payments-cli --release
```

**Result:** both packages **Finished `release`**. Binary:

- `packages/vendor/spp/target/release/spp.exe` — runs (`spp --version` / `--help` OK)

Also copied shipped proving keys into `packages/vendor/spp/testdata/` from
`deployments/testnet/circuit_keys/` (build wanted that path).

**Recipe for future Windows builds:** always open **x64 Native Tools / vcvars64** + set
`RUSTFLAGS=-C link-arg=/STACK:0x20000000` for the circuits crate.

### ✅ 0.2 CLI E2E on testnet (2026-07-09) — PASS

**Accounts** (Stellar CLI identities on testnet, friendbot-funded):
- `alice` `GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME`
- `bob` `GDJR23EHU3ATYSMOW2PUTU3KNYVLC7FFP5LNYBSRUNTPZJ4OEJZ2DWYO`

**Local data** (not in git): `D:\Veilpay\.local\spp-phase0\{alice,bob}` with
`circuits/` = `policy_tx_2_2.{wasm,r1cs}` + proving key from vendor artifacts.

**Gate: ASP membership required before any prove/transact.**  
Deposit initially failed with `ASP membership sync required: RegisterAtASP`. On this
live testnet, ASP membership `insert_leaf` is **permissionless** (alice could insert).
Leaf = `poseidon2_hash2(note_pubkey, membership_blinding, domain=1)` (see
`sdk/prover::crypto::asp_membership_leaf`). Inserted via:

```text
stellar contract invoke --id CDSJXWV5… --network testnet --source alice -- insert_leaf --leaf <dec>
```

**E2E txs (native XLM pool `CCR7KZOF…`):**

| Step | Amount | Result | Explorer |
|------|--------|--------|----------|
| Deposit | 1 XLM | ok | `347642282d2bb983…` |
| Transfer alice→bob | 0.5 XLM (note+enc keys) | ok | `0ee209504bcdf255…` |
| Withdraw | 0.5 XLM → alice G… | ok | `7445081391bd34f6…` |

Post-conditions: alice pool balance **0**; bob pool balance **0.5 XLM** after sync.
Extra deposits (0.1 / 0.05) also confirmed.

**Event retention:** deployment ledger ~3_479_862 vs tip ~3_519_xxx (~2 days) — **within**
RPC 7-day window; full event replay worked. Re-check before relying on this deployment
after ~5 more days; self-deploy is the fallback.

**CLI gotchas (Windows):**
- Release `spp.exe` needs `--circuits-dir` with wasm+r1cs+proving key (default
  `data_dir/circuits` uses `$HOME/.local/share/...` which is empty when `HOME` unset).
- `onboard --accept --no-bootnode --no-register` still prompts for explorer URL in TTY;
  pipe empty line or use non-interactive stdin.
- Transfer recipient: `--note-key` + `--encryption-key` (hex) works without registry;
  `--to G…` needs prior `spp register`.

### ✅ 0.4 Desktop prove bench (policy_tx_2_2) — partial (desktop only)

Wall-clock for **full op** (WASM compile/load + prove + sign + submit + confirm) on this
Windows host, release `spp.exe`:

| Op | Wall time | Notes |
|----|-----------|-------|
| Deposit 1 XLM (after ASP) | ~11 s | First successful prove path |
| Transfer 0.5 | ~9.5 s | |
| Withdraw 0.5 | ~13 s | |
| Deposit 0.1 (repeat) | ~21 s | Peak WorkingSet sample ~101 MB |
| Deposit 0.05 (repeat) | ~13 s | Peak WorkingSet sample ~107 MB |

**Interpretation:** desktop prove is **comfortable for dogfood** (order ~10 s/tx including
network). Peak RSS samples ~100 MB are lower bounds (polling WorkingSet; not a full
allocator trace). **Still needed for Phase 1 gate:** mid/low-end **Android** on-device
prove time + RSS (handoff item; not done this session).

### ✅ 0.5 `packages/spp-native` hello-world scaffolded

- Rust `cdylib`: `spp_native_version`, `spp_native_ping`, `spp_native_string_free`
- TS stub: `packages/spp-native/ts/index.ts` (`version()` / `ping()`)
- **Not** wired into RN yet; no product WebView; no full pool ops

### Remaining Phase 0 / next
- [x] **0.1** Native release build of SDK + CLI
- [x] **0.2** CLI E2E deposit → transfer → withdraw
- [x] **0.3** Testnet contracts live
- [x] **0.4** Desktop prove wall times (Android device still open)
- [x] **0.5** Scaffold `packages/spp-native` FFI hello-world
- [x] **0.6** Plan docs updated

### Phase 1 started (2026-07-09)
- [x] `constants/spp.ts` — testnet IDs + mainnet fail-closed
- [x] `stores/sppNoteStore.ts` — SecureStore note summaries
- [x] `utils/stellarSpp/*` — client scaffold (`SPP_OPS_NOT_READY` until native poolOps)
- [x] `StellarSppScreen` + Settings → Private XLM + nav
- [x] `packages/shared` `stellar-testnet` + optional `spp?` field
- [x] `spp_native_capabilities()` bitmask (ping only)
- [x] **Home UX:** Token Selector **[ PRIVACY ]** section + Home assets Privacy row;
      selecting Private XLM adapts balance card (shielded amount) + quick actions
      (SHIELD / TRANSFER / UNSHIELD / PUBLIC) with same UI chrome
- [x] Privacy Level on send flow: Standard vs Private for Stellar
      (`usePrivacyOptions` + `privacyLevel: 'private'` → SPP transfer path)
- [x] Native op **stubs** (C ABI deposit/transfer/withdraw/ensure_asp JSON) +
      `prepareSppOp` checklist + ASP CLI dogfood hint on hub; Send prefers Private
      when pXLM / home privacy mode selected
- [x] **Expo module install / autolink (2026-07-09 cont.):**
      `npm install` → `@veilpay/expo-spp-native` junction to `modules/spp-native`;
      `expo-modules-autolinking resolve --platform android` lists
      `veilpay-expo-spp-native` + `SppNativeModule`. package-lock updated.
- [x] **NDK/JNI scaffold (not yet built on device):**
      - Kotlin `SppNativeRust` + module prefers Rust when `libspp_native.so` loads
      - Rust `android-jni` feature + JNI exports (`cargo check --features android-jni` OK)
      - `packages/spp-native/scripts/build-android-ndk.{ps1,sh}` → module `jniLibs/`
      - **Blocked here:** no Android SDK / `adb` / JDK on this Windows host →
        cannot run `expo run:android` to confirm hub `backend: native` on hardware
- [x] **EAS NDK package** (`eas-build-post-install` + poseidon2 vendored under `packages/spp-native/vendor/`) — confirm on device hub after commit + preview build
- [ ] Device: hub shows crate version `0.1.0` + `aspLeaf: true` (not Kotlin stub)
- [ ] Link `sdk/pool`: real prove/submit (flip `CAP_POOL_OPS` / `poolOps`)
- [x] **ASP path (app orchestration, 2026-07-10):**
      - `sppAccountStore` + sign `Privacy Pool Key Derivation [v1]`
      - Soroban `insert_leaf` submit helper (needs `aspLeafDecimal`)
      - Privacy setup on **pXLM select** (Token Selector / Home) — no Enable detour
      - Status hub diagnostics only
- [x] **Native ASP leaf compute (2026-07-10):**
      - `packages/spp-native` Poseidon2 derive (`spp_native_derive_keys`) + `CAP_ASP_LEAF`
      - Kotlin/Swift + bridge `deriveKeys`; auto insert_leaf when leaf returned
      - On-device derive needs `libspp_native.so` (EAS post-install or local cargo-ndk)
- [x] Confirm EAS preview APK loads Rust `.so` on device hub (`version: 0.1.0`, `ASP leaf: ok`)
- [x] Pool-ops **validation + readiness FFI** (`pool_ops.rs`, feature `pool-ops` gate)
- [x] **ASP insert retry** — `ensureSppAccountReady` no longer skips insert when leaf exists;
      hub **Register ASP membership** button; higher Soroban fee for insert_leaf
- [x] Link real `sdk/pool` prove/submit (feature `pool-ops` + session FFI + circuit stage)
      Desktop: `cargo check --features pool-ops` OK (2026-07-10). Device needs 1.1.0 APK
      with `SPP_NATIVE_POOL_OPS=1` when EAS quota returns (~Aug 1).
- [x] Lifecycle E2E **Jest** shield→transfer→unshield (mock CAP_POOL_OPS)
- [ ] On-device E2E with real prove (blocked: EAS free Android until ~Aug 1)
- [ ] On-device Android prove bench
- [x] Privacy mode **switch animation** (Home Moti keys + badge/actions)

### Phase 1c order (current)

1. ~~EAS NDK hook + vendored poseidon2~~ — commit Phase 1 native sources, then preview APK.
2. Commit (at least): `packages/spp-native`, `apps/consumer-app/modules/spp-native`,
   `eas-hooks/build-spp-native-android.*`, `package.json` post-install, `.easignore`.
3. `npm run eas:preview:android` → hub: `version: 0.1.0` (Rust), `aspLeaf: true`, `poolOps: not ready`.
4. Link `sdk/pool` deposit→transfer→withdraw (`CAP_POOL_OPS`); device E2E.
5. Privacy switch animation (deferred); Android prove RSS/time bench.
6. Local alt (optional): Android SDK + `packages/spp-native/scripts/build-android-ndk.ps1`.

## Net assessment
**Phase 0 CLI gate met.** Phase 1 **product shell + send path + Expo native module +
JNI + EAS NDK packaging** in place. Next gate: **preview APK on device** shows Rust
version + `aspLeaf`. Ops still fail closed with structured `SPP_OPS_NOT_READY` until
`sdk/pool` is linked (`CAP_POOL_OPS`).

