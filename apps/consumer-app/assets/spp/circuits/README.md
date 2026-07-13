# SPP circuit assets (policy_tx_2_2)

Required for native prove/submit (`CAP_POOL_OPS`):

| File | ~Size | Role |
|------|-------|------|
| `policy_tx_2_2_proving_key.bin` | 7.8 MB | Groth16 proving key (testnet trusted setup) |
| `policy_tx_2_2.wasm` | ~0.6 MB | Circom witness WASM |
| `policy_tx_2_2.r1cs` | ~5 MB | R1CS for ark-circom |

## Stage from repo (dev machine)

```powershell
# From monorepo root
.\packages\spp-native\scripts\stage-circuit-assets.ps1
```

Copies from Phase 0 dogfood (`.local/spp-phase0/alice/circuits`) or vendor testdata into this directory.

## Runtime paths

- **Desktop / env override:** `EXPO_PUBLIC_SPP_CIRCUITS_DIR=<absolute path>`
- **Device:** `{appDataDir}/spp/circuits/` from `SppNative.appDataDir()` (Android external files) — see `sppPoolSession.getSppCircuitsDir()`
- **adb dogfood:**
  ```text
  adb shell mkdir -p /sdcard/Android/data/com.veilpay.consumer/files/spp/circuits
  adb push policy_tx_2_2_proving_key.bin policy_tx_2_2.wasm policy_tx_2_2.r1cs \
    /sdcard/Android/data/com.veilpay.consumer/files/spp/circuits/
  ```

## License note

Compiled circuit artifacts include circomlib (LGPLv3). Bundle the notices under
`packages/vendor/spp/deployments/legal/` when shipping in a release APK.
See `plans/spp-phase0-findings.md` §5.
