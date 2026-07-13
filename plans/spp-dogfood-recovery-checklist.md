# SPP dogfood checklist (Phase 2 exit)

Run on a **pool-ops** Android preview APK (`SPP_NATIVE_POOL_OPS=1`, appVersion bumped).  
Stellar **testnet** only. Do **not** use mainnet.

## Preflight

- [ ] Hub / diagnostic: `poolOps: ready` (or open session after disclaimer)
- [ ] Circuits seeded (bundled or `adb push` per OTA handoff)
- [ ] Wallet restored with Stellar G… address that previously shielded (or fresh for full loop)

## Happy path (pool-ops)

1. Select pXLM / enter private mode  
2. **Shield** small amount (e.g. 1 XLM)  
3. Confirm private balance shows amount  
4. Optional: **private transfer** / **unshield** subset  
5. Force recovery: clear SecureStore notes **or** reinstall APK (same seed)  
6. Cold start → background recovery runs → private balance **restored**  
7. Unshield residual if needed  

## Fail-closed (non–pool-ops / OTA-safe APK)

- [ ] Private privacy chip **disabled** (pool-ops copy)  
- [ ] Send with forced `private` does **not** public-send; toast + failed status  
- [ ] Standard public XLM still works  

## DATA-002

- [ ] Max privacy option disabled on Sepolia  
- [ ] `EVM_MAX_PRIVACY_WITHDRAW_READY === false` in build  

## Record

| Field | Value |
|-------|--------|
| APK version / SHA | |
| Device | |
| Date | |
| Recovery result | |
| Notes | |
