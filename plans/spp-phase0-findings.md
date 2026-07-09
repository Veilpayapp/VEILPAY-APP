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

**So: NOT snarkjs, NOT rapidsnark.** It's Rust→WASM via wasm-bindgen. The doc's "snarkjs TypeScript
SDK" does not exist. For mobile (React Native, no DOM), integration = host the wasm-bindgen module
in a WebView bridge (model on our `ZkpProver.tsx`), OR compile the same Rust crates for a native
JSI module. WebView-first is the lower-risk path.

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
Rust 1.96.1, cargo 1.96.1, stellar-cli 27.0.0 (Soroban), git 2.54 w/ submodules. `Makefile` targets:
`build`, `release`, `serve`, `circuits-build`, `sdk-web-build`, `install`, `doc`. `rust-toolchain.toml`
pins the toolchain; `circomlib.lock` pins circuit deps.

## Remaining Phase 0 work (not yet done)
- [ ] **Run the CLI E2E** (deposit→transfer→withdraw) against the existing testnet IDs via `cli/`.
      Confirm the shipped keys + live contracts actually transact. This is the real gate.
- [ ] **Build `sdk-web`** (`make sdk-web-build`) to confirm the WASM prover compiles here, then
      **benchmark proof-gen** for `policy_tx_2_2` (time + peak memory) — ideally on/near a low-end
      Android profile. The make-or-break UX number; escalate if >~10s or OOM.
- [ ] Confirm the existing testnet contracts are still live/funded (else self-deploy via
      `deployments/scripts/deploy.sh`).

## Net assessment
Phase 0 is **substantially de-risked**: prover mechanism known (Rust/ark-circom→WASM), curve known
(BN254, possibly more reuse than planned), keys prebuilt, contracts already live on testnet, license
clean. The two open items are both *empirical* (does the CLI transact E2E; is on-device proof-gen
fast enough) rather than *unknown-architecture*. The plan + memory need correcting on the curve.
