# Security Fixes: SEC-004, SEC-005, SEC-008

This document describes the three critical security fixes implemented to harden the Veilpay consumer app withdrawal flow against cryptographic and RPC validation attacks.

## SEC-004: Nullifier Hash Validation

**Vulnerability**: When withdrawing, the app passed `nullifierHash` from the commitment record without validating it matches `Poseidon(nullifier)`. A corrupted commitment record could lead to proof generation with semantically incorrect data.

**Fix**: All withdrawal flows now validate that the stored `nullifierHash` matches `Poseidon(nullifier)` before proof generation.

### Implementation

**File**: `src/utils/nullifierHashValidation.ts`

```typescript
import { validateNullifierHash, computeNullifierHash } from './utils/nullifierHashValidation';

// Before proof generation:
validateNullifierHash(commitment.nullifier, commitment.nullifierHash);
```

### Key Functions

- `computeNullifierHash(nullifier: Hex): Hex` — Recomputes the Poseidon hash of a nullifier
- `validateNullifierHash(nullifier: Hex, storedHash: Hex): void` — Throws `NullifierHashError` if mismatch
- `NullifierHashError` — Custom error class for diagnostics

### Testing

**File**: `src/utils/__tests__/nullifierHashValidation.test.ts`

Covers:
- Valid nullifier hash passes validation
- Corrupted hash is rejected
- Different nullifiers produce different hashes
- Property: hash is deterministic

### Usage in Withdrawal

**File**: `src/services/relayerClient.ts` (where withdrawal happens)

```typescript
// Before submitWithdraw():
const commitment = await loadCommitmentRecord(commitmentHash);
validateNullifierHash(commitment.nullifier, commitment.nullifierHash);
// Safe to proceed to proof generation
```

## SEC-005: Production RPC Configuration Validation

**Vulnerability**: If backend RPC proxy was unconfigured, the app silently fell back to public RPC endpoints. Attacker could MITM responses.

**Fix**: In production, the app now requires explicit RPC configuration and throws hard if not set.

### Implementation

**File**: `src/utils/rpcValidation.ts`

```typescript
import { requireProductionRpc } from './utils/rpcValidation';

// App startup or before any blockchain call in production:
requireProductionRpc('ethereum');
```

### Key Functions

- `requireProductionRpc(chainKey: string): void` — Throws if production but RPC unconfigured
- `RpcValidationError` — Custom error class with code and details

### Configuration

**Required Environment Variables**:

For **production builds**, set **at least one** of:

1. **Backend RPC Proxy** (recommended):
   ```
   EXPO_PUBLIC_BACKEND_BASE_URL=https://api.veilpay.io
   ```
   App will use `${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/rpc/${chainKey}`

2. **Chain-Specific Overrides**:
   ```
   EXPO_PUBLIC_RPC_ETHEREUM=https://your-rpc.example.com
   EXPO_PUBLIC_RPC_POLYGON=https://your-rpc.example.com
   EXPO_PUBLIC_RPC_ARBITRUM=https://your-rpc.example.com
   EXPO_PUBLIC_RPC_BASE=https://your-rpc.example.com
   EXPO_PUBLIC_RPC_SEPOLIA=https://your-rpc.example.com
   ```

If **neither** is set in production, the app throws:
```
RpcValidationError: EXPO_PUBLIC_BACKEND_BASE_URL or explicit RPC endpoint required in production
```

### Testing

**File**: `src/utils/__tests__/rpcValidation.test.ts`

Covers:
- Production without config throws hard
- Development degrades gracefully
- Explicit env var overrides work
- Backend proxy URL is constructed correctly
- Chain-specific endpoints are preferred

### Silent Degradation Prevention

**Before (Vulnerable)**:
```
Production + No Backend Config → Silent fallback to public RPC → MITM possible
```

**After (Hardened)**:
```
Production + No Backend Config → Throw RpcValidationError → App fails loudly
```

## SEC-008: Chain ID Validation on RPC Responses

**Vulnerability**: RPC responses were not validated for `chainId`. Attacker could return data from the wrong chain, causing:
- Balance checks on mainnet instead of testnet
- Gas price estimates from different chains
- Transaction confirmation on wrong chain

**Fix**: All RPC responses are now validated to include the correct `chainId` before use.

### Implementation

**File**: `src/utils/rpcValidation.ts`

```typescript
import { validateRpcResponse } from './utils/rpcValidation';

// After every RPC call:
const response = await getBalance(...);
validateRpcResponse(response, expectedChainId, 'ethereum');
```

### Key Functions

- `validateRpcResponse(response: any, expectedChainId: number, chainKey: string): void` — Throws if `chainId` mismatch
- Zod schema validation for structured responses
- Detects responses missing `chainId` field (logs warning)

### RPC Methods Protected

All calls through `rpcPool.ts` are wrapped:

- `getBalance()` — Validate chainId in account state
- `getGasPrice()` — Validate chainId before using estimate
- `getTransactionReceipt()` — Validate before confirming withdrawal
- `waitForTransactionReceipt()` — Validate before marking withdrawal spent

### Testing

**File**: `src/utils/__tests__/rpcValidation.test.ts`

Covers:
- Legitimate response passes validation
- Wrong chainId is rejected
- Missing chainId is logged with warning
- MITM scenarios (mainnet→testnet, polygon→ethereum, etc.)
- Gas price from wrong chain is rejected
- Transaction status from wrong chain is rejected

### Error Details

When validation fails, `RpcValidationError` includes:

```typescript
{
  code: 'CHAIN_ID_MISMATCH',
  message: 'RPC returned chainId 56, expected 11155111 (evm-sepolia)',
  details: {
    expected: 11155111,
    received: 56,
    chainKey: 'evm-sepolia'
  }
}
```

## Integration Flow

The withdrawal flow now follows this secure sequence:

```
1. Load commitment from SecureStore
   ↓
2. SEC-004: Validate nullifierHash matches Poseidon(nullifier)
   ↓
3. SEC-005: Check production RPC is configured
   ↓
4. Generate zero-knowledge proof
   ↓
5. Submit to relayer
   ↓
6. Relayer queries RPC (balance, gas price, etc.)
   ↓
7. SEC-008: Validate every RPC response for correct chainId
   ↓
8. Confirm withdrawal on correct chain only
```

## Attack Scenarios Prevented

### Scenario 1: Corrupted Commitment Record (SEC-004)

**Attack**: Attacker modifies commitment's `nullifierHash` field
```
Before: nullifierHash = 0xabcd...
After:  nullifierHash = 0xffff... (wrong)
```

**Prevention**: `validateNullifierHash()` recomputes hash and detects mismatch, throws before proof generation.

**Result**: Withdrawal fails immediately, no proof generated.

### Scenario 2: Missing Backend Config (SEC-005)

**Attack**: Backend RPC proxy is removed or never configured
```
Production app + No EXPO_PUBLIC_BACKEND_BASE_URL → Falls back to public RPC
```

**Prevention**: `requireProductionRpc()` throws hard in production if not configured.

**Result**: App fails with clear error. Operator knows to set env var.

### Scenario 3: MITM Chain ID Swap (SEC-008)

**Attack**: Attacker intercepts RPC call, returns data from wrong chain
```
App queries: "Get balance on Sepolia (chainId 11155111)"
Attacker responds: "Here's balance on Ethereum mainnet (chainId 1)"
```

**Prevention**: `validateRpcResponse()` checks `chainId` in response, throws if wrong.

**Result**: Response rejected, app never uses wrong chain's data.

## Testing

Run all security tests:

```bash
npm test -- nullifierHashValidation.test.ts
npm test -- rpcValidation.test.ts
npm test -- securityFixes.integration.test.ts
```

Integration test verifies the complete flow:
```bash
npm test -- securityFixes.integration.test.ts
```

## Deployment Checklist

### Before Production Deployment

- [ ] Set `EXPO_PUBLIC_BACKEND_BASE_URL` to your backend RPC proxy
- [ ] OR set explicit chain RPC endpoints (e.g., `EXPO_PUBLIC_RPC_ETHEREUM`)
- [ ] Verify production builds have `NODE_ENV=production`
- [ ] Run full test suite: `npm test`
- [ ] Integration test passes all scenarios
- [ ] Relayer validates withdrawal requests end-to-end

### Monitoring

Add alerts for:

```typescript
// Log all SEC-004 validation failures
console.error('[SEC-004] Nullifier hash mismatch');

// Log all SEC-005 configuration issues
console.error('[SEC-005] RPC configuration missing in production');

// Log all SEC-008 chain ID mismatches
console.error('[SEC-008] RPC chainId mismatch');
```

## References

- **Circuit Design**: `packages/circuits/docs/CIRCUIT_SECURITY.md`
- **Withdrawal Request Schema**: `src/schemas/withdrawRequest.ts`
- **Relayer Integration**: `src/services/relayerClient.ts`
- **RPC Pool**: `src/utils/rpcPool.ts`
- **Commitment Store**: `src/stores/commitmentStore.ts`

## Questions?

Contact: [security team]
