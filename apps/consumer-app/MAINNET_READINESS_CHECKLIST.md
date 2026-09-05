# SPP Mainnet Build & Test Readiness Checklist

## ✅ What's Ready Now (Preview APK Build)

### Environment Validation
- [x] `EXPO_PUBLIC_BACKEND_BASE_URL` — validated in Doppler hook
- [x] `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` — validated in Doppler hook

### SPP Testnet (Works Out of Box)
- [x] Deployment IDs hardcoded in `src/constants/spp.ts`
- [x] Soroban testnet RPC: `https://soroban-testnet.stellar.org`
- [x] No additional secrets needed — testnet is always enabled

### Native Module (Rust SPP Circuit)
- [x] Compiles to `libspp_native.so` during EAS build
- [x] `policy_tx_2_2` circuit artifacts vendored in `packages/vendor/spp/`
- [x] No URLs needed — built into native module

---

## ⚠️ What You Need for Mainnet Testing

### Doppler Configuration (`veilpay/prd`)

Only ONE variable is required:

| Variable | Required | Format | Source |
|----------|----------|--------|--------|
| `EXPO_PUBLIC_SPP_MAINNET_MANIFEST` | **Yes** | JSON object | Stellar mainnet SPP deployment manifest |

### Manifest Structure

The JSON must contain all these fields:

```json
{
  "network": "mainnet",
  "deployer": "GXXX...",
  "admin": "GXXX...",
  "poolId": "CXXX...",
  "verifierId": "CXXX...",
  "aspMembershipId": "CXXX...",
  "aspNonMembershipId": "CXXX...",
  "registryId": "CXXX...",
  "nativeTokenContractId": "CXXX...",
  "horizonUrl": "https://horizon.stellar.org",
  "sorobanRpcUrl": "https://soroban-mainnet.stellar.org",
  "networkPassphrase": "Public Global Stellar Network ; September 2015",
  "explorerBaseUrl": "https://stellar.expert/explorer/public",
  "deploymentLedger": <number>,
  "maxDepositStroops": "<number>"
}
```

### Set in Doppler

```bash
# Escape the JSON and set as a single secret value
doppler secret set EXPO_PUBLIC_SPP_MAINNET_MANIFEST '{"network":"mainnet","deployer":"GXXX...","admin":"GXXX...","poolId":"CXXX...","verifierId":"CXXX...","aspMembershipId":"CXXX...","aspNonMembershipId":"CXXX...","registryId":"CXXX...","nativeTokenContractId":"CXXX...","horizonUrl":"https://horizon.stellar.org","sorobanRpcUrl":"https://soroban-mainnet.stellar.org","networkPassphrase":"Public Global Stellar Network ; September 2015","explorerBaseUrl":"https://stellar.expert/explorer/public","deploymentLedger":<number>,"maxDepositStroops":"<number>"}'
```

---

## 🔬 Testing Checklist

### Pre-Build (Before Running `eas build`)

- [ ] **Doppler manifest is valid JSON:**
  ```bash
  doppler secrets get EXPO_PUBLIC_SPP_MAINNET_MANIFEST | jq .
  ```
  Should output structured JSON, not an error.

- [ ] **All required fields present in manifest:**
  ```bash
  doppler secrets get EXPO_PUBLIC_SPP_MAINNET_MANIFEST | jq '.poolId, .verifierId, .sorobanRpcUrl, .networkPassphrase'
  ```
  Should return 4 non-empty values.

### During EAS Build

- [ ] **Doppler hook succeeds:**
  ```
  [doppler-hook] Starting Doppler secret injection...
  [doppler-hook] Successfully injected secrets from Doppler
  ```

- [ ] **No validation errors:**
  ```
  [doppler-hook] Variables present (names only):
    - EXPO_PUBLIC_BACKEND_BASE_URL
    - EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID
    - EXPO_PUBLIC_SPP_MAINNET_MANIFEST
  ```

- [ ] **Native module compiles:**
  ```
  [spp-native-ndk] OK — 1 ABI(s)
  [spp-native-ndk] ✓ libspp_native.so (arm64-v8a) produced
  ```

### After Installing APK on Phone

- [ ] **App launches without errors:**
  - No "Configuration" errors
  - No "SPP is not configured for Stellar mainnet" error
  - Dashboard loads

- [ ] **Mainnet SPP visible:**
  - Navigate to Privacy screen
  - "Stellar" chain shows SPP enabled
  - Can select "Shield" or "Transfer" for privacy flow

- [ ] **Native module works:**
  - Attempt first privacy transaction
  - App does NOT crash with native library errors
  - Proving engine initializes (may take 10-30s first time)

- [ ] **Transaction succeeds on mainnet:**
  - Complete shield, transfer, or unshield
  - Transaction hash appears in history
  - Can view on stellar.expert (mainnet explorer)

---

## 📋 Troubleshooting

### Build Phase Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `[doppler-hook] ERROR: Required secrets missing` | `EXPO_PUBLIC_BACKEND_BASE_URL` or `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` unset | Check Doppler `veilpay/prd` config |
| `[spp-native-ndk] ERROR: cargo-ndk installation failed` | NDK toolchain issue on EAS | Check full build logs; may need larger instance |
| Build succeeds but app won't start | `EXPO_PUBLIC_SPP_MAINNET_MANIFEST` is invalid JSON | Validate in Doppler: `doppler secrets get EXPO_PUBLIC_SPP_MAINNET_MANIFEST \| jq .` |

### Runtime Errors (On Device)

| Error | Cause | Fix |
|-------|-------|-----|
| "SPP is not configured for Stellar mainnet" | Manifest missing or invalid | Verify `EXPO_PUBLIC_SPP_MAINNET_MANIFEST` in Doppler |
| App crashes during proving | Native module load failed | Check Logcat: `adb logcat \| grep spp_native` |
| Transaction rejected: contract not allowlisted | Backend relayer not configured | Backend team needs to allowlist pool contract |
| "NullifierAlreadySpent" | Commitment already spent | Use fresh wallet or deposit to different address |

---

## 🚀 Build Flow for Mainnet APK

```
npm run eas:preview:android:ci
  ↓
EAS receives code + Doppler token
  ↓
[1] Pre-install: Doppler hook downloads secrets
    ✅ EXPO_PUBLIC_BACKEND_BASE_URL (validated)
    ✅ EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID (validated)
    ✅ EXPO_PUBLIC_SPP_MAINNET_MANIFEST (downloaded)
  ↓
[2] Prebuild: Expo resolves plugins
  ↓
[3] Post-install: NDK builds libspp_native.so
  ↓
[4] Gradle compiles APK
  ↓
[5] At app startup on device:
    - App parses EXPO_PUBLIC_SPP_MAINNET_MANIFEST
    - If invalid JSON → error screen
    - If valid → mainnet SPP enabled
  ↓
App ready to test on mainnet
```

---

## 📝 Notes

- **Manifest source:** Must come from official Stellar SPP mainnet deployment
- **No URLs needed:** SPP circuit is built into the native Rust module (vendored)
- **Testnet always available:** Doesn't require the mainnet manifest
- **Do not commit secrets:** `.env` and Doppler values stay off git
- **Test preview first:** Verify testnet flows before attempting mainnet
- **Manifest changes:** If deployment updates, rebuild and redistribute APK
