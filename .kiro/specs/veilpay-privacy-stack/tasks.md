# Implementation Plan: VeilPay Privacy Stack

## Overview

This plan completes the four-layer privacy stack so the end-to-end flow (deposit → prove → relay → withdraw, plus the orthogonal stealth-send / stealth-scan path) actually works. The load-bearing fix is aligning the public-input ordering `(merkleRoot, nullifierHash, recipient, amount)` across the circuit, the `Groth16Verifier`, and `VeilPool.withdraw`. Work is layered bottom-up — circuit first, then contracts, then relayer, then mobile — and each layer includes property tests for the universal correctness properties declared in the design.

The implementation languages are fixed by the design: Circom 2.0 for the circuit, Solidity (Foundry) for contracts, TypeScript (Express) for the relayer, and TypeScript (React Native / Expo) for the mobile app.

## Tasks

- [x] 1. Establish shared canonical-ordering anchors and project scaffolding
  - [x] 1.1 Add canonical public-input ordering header comment to circuit, verifier wrapper, pool, relayer schema, and ZkpProver input object
    - Add `// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract` header at every site that constructs or consumes the public-signal array
    - Touch `packages/circuits/withdraw.circom`, `packages/contracts-evm/src/Groth16Verifier.sol` (post-process step in compile.sh), `packages/contracts-evm/src/VeilPool.sol`, `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/components/ZkpProver.tsx`
    - _Requirements: 1.3, 2.5, 3.2_

  - [x] 1.2 Create `packages/contracts-evm/deployments/sepolia.json` placeholder file with the three address keys initialized to the zero address
    - File serves as the build-time import target for `apps/consumer-app/src/constants/contracts.ts`
    - Keys: `groth16Verifier`, `veilPool`, `stealthAnnouncer`, `chainId`, `blockNumber`
    - _Requirements: 5.2, 13.1_

- [x] 2. Implement Layer 2 — ZK circuit and compile pipeline
  - [x] 2.1 Replace `packages/circuits/withdraw.circom` stub with the full Withdraw template
    - Import `circomlib/circuits/poseidon.circom` and `circomlib/circuits/merkletree.circom`
    - Declare private inputs `nullifier`, `secret`, `pathElements[20]`, `pathIndices[20]`
    - Declare public inputs (in order) `merkleRoot`, `nullifierHash`, `recipient`, `amount`
    - Constrain `Poseidon(nullifier, secret) === MerkleTreeChecker.leaf`
    - Constrain `Poseidon(nullifier) === nullifierHash`
    - Wire `MerkleTreeChecker(20)` over `pathElements` / `pathIndices` to `merkleRoot`
    - Add quadratic binding constraints `recipient * recipient` and `amount * amount` so they cannot be post-substituted
    - Declare `component main {public [merkleRoot, nullifierHash, recipient, amount]} = Withdraw(20);`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 2.2 Rewrite `packages/circuits/compile.sh` as a hardened, atomic build pipeline
    - Run circom compile, powers-of-tau setup, zkey beacon, verification-key export, solidity-verifier export against a `build.tmp/` directory
    - Move `build.tmp/*` → `build/` only after every step succeeds; overwrite `packages/contracts-evm/src/Groth16Verifier.sol` last
    - Append idempotent post-processing pass that renames the generated `verifyProof` to `_verifyProofRaw` and adds the `verifyProof(bytes, bytes32[])` wrapper
    - Exit non-zero with the failing step printed to stderr on any error; never partially overwrite
    - Produce `build/withdraw.wasm`, `withdraw_final.zkey`, `verification_key.json`, and updated `Groth16Verifier.sol`
    - _Requirements: 1.9, 1.10, 3.1_

  - [x] 2.3 Add an off-chain reference incremental Merkle tree helper in `packages/circuits/test/merkleTree.ts`
    - Tornado-style depth-20 incremental tree using the same Poseidon hash as the circuit
    - Exposes `insert(leaf)`, `root()`, `path(index) → { pathElements, pathIndices }`
    - Used by both circuit tests and pool tests as the correctness oracle
    - _Requirements: 1.11, 2.1, 2.2_

  - [x] 2.4 Write property test for the circuit round-trip (Property 1)
    - **Property 1: Merkle membership proof round-trip**
    - **Validates: Requirements 1.4, 1.5, 1.6, 1.7, 1.8, 1.11, 2.5, 3.3, 9.6**
    - Use `circom_tester` for witness generation and `fast-check` to generate random commitment trees and choose a leaf
    - Generate proof with `snarkjs.groth16.fullProve` and verify against the deployed `Groth16Verifier` (Foundry harness or `snarkjs.groth16.verify` against the same vkey)
    - Mutate single bytes of `pathElements`, `pathIndices`, `nullifier`, `secret`, `merkleRoot`, `nullifierHash`, `recipient`, `amount` and assert either witness-gen failure or verifier returns `false`
    - 25 iterations (proof generation is expensive)
    - File header comment: `// Feature: veilpay-privacy-stack, Property 1: Merkle membership proof round-trip`

  - [x] 2.5 Write smoke test that `compile.sh` produces all four artifacts
    - Snapshot `verification_key.json`'s `nPublic` and public-signal layout
    - Assert `build/withdraw.wasm`, `withdraw_final.zkey`, `verification_key.json`, and a non-stub `Groth16Verifier.sol` all exist after a clean run
    - _Requirements: 1.9, 3.1_

- [x] 3. Implement Layer 1 — VeilPool, Groth16Verifier wrapper, StealthAnnouncer, and deploy script
  - [x] 3.1 Implement `IGroth16Verifier` interface and the wrapper hook in compile.sh's post-processing step
    - Define `interface IGroth16Verifier { function verifyProof(bytes, bytes32[]) external view returns (bool); }` in `packages/contracts-evm/src/IGroth16Verifier.sol`
    - The post-processing wrapper added to the generated `Groth16Verifier.sol` returns `false` on length mismatch or decode error (no revert)
    - Wrapper decodes `proof` as `(uint256[2], uint256[2][2], uint256[2])` and casts each `bytes32` public input to `uint256` in canonical order
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Implement `VeilPool.sol` storage, errors, and `_insert` / `_isKnownRoot` helpers
    - Constants `LEVELS = 20`, `ROOT_HISTORY = 30`, `WITHDRAW_FEE_BPS` (constructor-configurable)
    - Storage: `bytes32[LEVELS] filledSubtrees`, `bytes32[LEVELS] zeros`, `uint32 nextLeafIndex`, `bytes32[ROOT_HISTORY] roots`, `uint8 currentRootIndex`, `mapping(bytes32 => bool) nullifierSpent`
    - Custom errors `InvalidMerkleRoot`, `InvalidProof`, `NullifierAlreadySpent`, `TreeFull`
    - `_insert` performs Tornado-style incremental hash, advances `currentRootIndex = (currentRootIndex + 1) % 30`, writes into `roots`
    - `_isKnownRoot` walks the ring buffer backwards from `currentRootIndex`, ignores zero entries
    - Constructor wires `IGroth16Verifier verifier`, `feeRecipient`, `WITHDRAW_FEE_BPS`; initializes `roots[0]` to the empty-tree root
    - _Requirements: 2.1, 2.3_

  - [x] 3.3 Implement `VeilPool.deposit(bytes32 commitment, address token, uint256 amount)`
    - Pull tokens with `IERC20.safeTransferFrom`
    - Call `_insert(commitment)`; revert `TreeFull` when `nextLeafIndex == 2 ** LEVELS`
    - Emit `Deposit(commitment, leafIndex, merkleRoot, token, amount, msg.sender)`
    - _Requirements: 2.2, 2.11_

  - [x] 3.4 Implement `VeilPool.withdraw(bytes32 nullifierHash, bytes proof, bytes32 merkleRoot, address recipient, address token, uint256 amount)`
    - Revert `InvalidMerkleRoot` if `!_isKnownRoot(merkleRoot)`
    - Revert `NullifierAlreadySpent` if `nullifierSpent[nullifierHash]`
    - Build `bytes32[] pub` in canonical order `[merkleRoot, nullifierHash, bytes32(uint256(uint160(recipient))), bytes32(amount)]` and call `verifier.verifyProof(proof, pub)`
    - Revert `InvalidProof` if verifier returns `false`
    - Mark nullifier spent, transfer `amount - fee` to `recipient` and `fee` to `feeRecipient`, emit `Withdrawal`
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [x] 3.5 Write property test for the incremental Merkle tree (Property 2)
    - **Property 2: VeilPool incremental Merkle tree correctness**
    - **Validates: Requirements 2.1, 2.2**
    - Use Foundry fuzz testing (`forge-config: default.fuzz.runs = 256`) with random `(commitment_i, amount_i)` sequences
    - Compare `VeilPool` root after each deposit against the off-chain reference tree from task 2.3
    - Assert the leaf at index `i` equals `commitment_i`

  - [x] 3.6 Write property test for the root history window (Property 3)
    - **Property 3: Root history window correctness**
    - **Validates: Requirements 2.3, 2.4**
    - Foundry fuzz test: deposit `n` random commitments, then assert `_isKnownRoot(roots_k)` is true for `k ∈ [max(1, n - 29), n]` and false for older roots, the zero hash, and uniformly random `bytes32`

  - [x] 3.7 Write property test for the verifier wrapper rejecting garbage (Property 4)
    - **Property 4: Verifier rejects malformed and invalid proofs without reverting**
    - **Validates: Requirements 3.4, 3.5**
    - Foundry fuzz test over `(proof, publicInputs)` with random byte content and random length; assert `verifyProof` returns `false` and the call does not revert
    - Include a case where the proof was generated for a different circuit's zkey

  - [x] 3.8 Write property test for nullifier double-spend prevention (Property 5)
    - **Property 5: Nullifier double-spend prevention**
    - **Validates: Requirements 2.7, 2.8, 2.10**
    - Foundry test: generate a valid proof, withdraw successfully, then attempt to withdraw again with the same `nullifierHash` (varying other args) and assert `NullifierAlreadySpent` revert each time

  - [x] 3.9 Write property test for fee math conservation (Property 6)
    - **Property 6: Fee math conservation**
    - **Validates: Requirements 2.9**
    - Foundry fuzz test over `amount` and `WITHDRAW_FEE_BPS`: assert `recipient` delta = `amount - amount * bps / 10_000`, `feeRecipient` delta = `amount * bps / 10_000`, sum = `amount`

  - [x] 3.10 Update `packages/contracts-evm/src/StealthAnnouncer.sol` with input validation
    - Add custom errors `EmptyEphemeralKey()`, `ZeroStealthAddress()`
    - Revert `EmptyEphemeralKey` when `ephemeralPubKey.length == 0`
    - Revert `ZeroStealthAddress` when `stealthAddress == address(0)`
    - Emit ERC-5564 `Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata)` on success
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 3.11 Write property test for announcer event fidelity (Property 8)
    - **Property 8: Announcer event fidelity**
    - **Validates: Requirements 4.5**
    - Foundry fuzz test over `(schemeId, stealthAddress, ephemeralPubKey, metadata)` with `stealthAddress != 0` and `ephemeralPubKey.length > 0`; assert exactly one `Announcement` is emitted whose decoded fields equal the inputs and `caller == msg.sender`

  - [x] 3.12 Write Foundry unit tests for each custom error
    - One test per error: `InvalidMerkleRoot`, `InvalidProof`, `NullifierAlreadySpent`, `TreeFull`, `EmptyEphemeralKey`, `ZeroStealthAddress`
    - Assert revert selector with `vm.expectRevert(SelectorName.selector)`
    - _Requirements: 2.4, 2.6, 2.7, 2.10, 2.11, 4.3, 4.4_

  - [x] 3.13 Implement `packages/contracts-evm/script/DeployPrivacyStack.s.sol`
    - Pre-flight read of `vm.envAddress("FEE_RECIPIENT")` and `vm.envUint("DEPLOYER_PK")`
    - Deploy in order: `Groth16Verifier` → `VeilPool(verifier, feeRecipient, FEE_BPS)` → `StealthAnnouncer`
    - Write checksummed addresses, `chainId = 11155111`, and `block.number` to `deployments/sepolia.json` only after all three deploys succeed
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 3.14 Write Foundry integration test for the deploy script
    - Run script in dry-run mode against a local Anvil instance
    - Assert deployment order Verifier → Pool → Announcer and `VeilPool._verifier == address(Groth16Verifier)`
    - Assert produced `sepolia.json` has all three checksummed 42-char addresses
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 4. Checkpoint — Layer 1 + Layer 2 integration
  - Run `compile.sh` end-to-end and execute the Foundry test suite (unit + fuzz + invariant). Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Layer 3 — Relayer backend
  - [x] 5.1 Define `WithdrawRequestSchema` zod schema in `apps/backend/src/schemas/withdrawRequest.ts`
    - Fields: `nullifierHash` (bytes32 hex), `proof` (hex), `publicSignals` (length-4 hex array), `merkleRoot` (bytes32 hex), `recipient` (address), `token` (address), `amount` (positive decimal string), `chainKey` (`'evm-sepolia'` literal), `contractAddress` (address)
    - Export both the schema and the inferred TypeScript type
    - _Requirements: 6.8, 8.2_

  - [x] 5.2 Add module-load-time allowlist initialization in `apps/backend/src/controllers/relayerController.ts`
    - Parse `RELAYER_VEILPOOL_ALLOWLIST` env (comma-separated), lowercase, regex-validate each entry, freeze into a `Set<string>`
    - Cache `RELAYER_PRIVATE_KEY` presence; cache 30-second timeout constant
    - _Requirements: 6.3, 6.5_

  - [x] 5.3 Rewrite `handleWithdraw` to call `VeilPool.withdraw` via ethers and never call the verifier
    - Return 503 `{error: 'Relayer not configured'}` if `RELAYER_PRIVATE_KEY` unset
    - Return 400 `{error: 'validation', details}` on schema failure
    - Return 400 `{error: 'contract not allowlisted'}` if `contractAddress.toLowerCase()` not in allowlist
    - Construct ethers `Contract(body.contractAddress, VEILPOOL_ABI, signer)` and call `pool.withdraw(nullifierHash, proof, merkleRoot, recipient, token, amount, {gasLimit})`
    - On success return 200 `{success: true, txHash: tx.hash}`
    - On revert use ethers v6 `Interface.parseError` to extract the custom-error name; return 422 `{success: false, error: <reason or "transaction reverted">}` and do not retry
    - Use `staticCall` before broadcast so a failed simulation does not consume gas
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 5.4 Wire the `POST /api/v1/relayer/withdraw` route in the relayer router
    - Register the controller at `apps/backend/src/routes/relayer.ts` (or existing equivalent)
    - Ensure JSON body parsing middleware is applied
    - _Requirements: 6.1_

  - [x] 5.5 Write property test for relayer forwarding behavior (Property 13)
    - **Property 13: Relayer forwards valid requests to allowlisted pools and never calls the verifier**
    - **Validates: Requirements 6.1, 6.2, 6.7**
    - Use `fast-check` to generate request bodies satisfying the schema with `contractAddress` drawn from a configured allowlist
    - Mock the JSON-RPC layer with `nock`/`undici`; use ethers `Interface` to assert calldata matches `withdraw(nullifierHash, proof, merkleRoot, recipient, token, amount)`
    - Assert no calldata targets `Groth16Verifier.verifyProof`
    - Assert HTTP 200 response shape `{success: true, txHash: <0x hex 66 chars>}`

  - [x] 5.6 Write property test for relayer validation and allowlist (Property 14)
    - **Property 14: Relayer rejects malformed and non-allowlisted requests with 400 and zero pool calls**
    - **Validates: Requirements 6.4, 6.8**
    - `fast-check` generates corruption-mutated bodies (missing fields, malformed hex, non-positive amount) and bodies with non-allowlisted `contractAddress`
    - Assert HTTP 400 and zero pool calls observed by the RPC mock

  - [x] 5.7 Write property test for relayer 503 when key unset (Property 15)
    - **Property 15: Relayer 503 when private key is unset**
    - **Validates: Requirements 6.5**
    - With `process.env.RELAYER_PRIVATE_KEY` cleared, post arbitrary bodies (well-formed and not) and assert HTTP 503 with `{error: 'Relayer not configured'}` regardless of body

  - [x] 5.8 Write property test for relayer revert mapping (Property 16)
    - **Property 16: Relayer maps on-chain reverts to HTTP 422**
    - **Validates: Requirements 6.6**
    - Mock the pool to revert with various reason strings (including empty); assert HTTP 422 and body `{success: false, error: <reason | "transaction reverted">}` and no retry

- [x] 6. Checkpoint — Layer 3 ready
  - Ensure all relayer tests pass, ask the user if questions arise.

- [x] 7. Implement Layer 4 — mobile app crypto and storage primitives
  - [x] 7.1 Port `apps/indexer/src/stealth/crypto.ts` to `apps/consumer-app/src/utils/stealthEngine.ts`
    - Identical signatures: `generateStealthKeyPair`, `deriveStealthAddress`, `recoverStealthPrivateKey`, `checkStealthAddressMatch`
    - Use `@noble/secp256k1` (already a dependency in the monorepo)
    - Compressed ephemeral public keys (33 bytes, `0x02`/`0x03` prefix) byte-compatible with the indexer scanner
    - _Requirements: 10.1, 10.2_

  - [x] 7.2 Write property test for stealth ECDH round-trip (Property 7)
    - **Property 7: Stealth ECDH round-trip**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.6**
    - `fast-check` generates random keypairs, derives stealth addresses, asserts `checkStealthAddressMatch` returns `true` for the matching `viewingPriv` and `false` for an independently generated keypair
    - Assert derived `stealthAddress` matches `^0x[0-9a-fA-F]{40}$` and is non-zero
    - 25 iterations (key-gen heavy)

  - [x] 7.3 Implement `apps/consumer-app/src/stores/commitmentStore.ts`
    - `saveCommitmentRecord`, `loadCommitmentRecord`, `markSpent` keyed by `veilpay.commitment.<commitmentHash>`
    - Use `SecureStore.setItemAsync` with `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`
    - Serialize the entire record as one JSON blob; `nullifier` and `secret` are `0x`-prefixed hex strings, `amount` is a decimal string
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

  - [x] 7.4 Wire post-deposit save flow with persistent error banner and retry-on-launch
    - On `VeilPool.deposit` confirmation, call `saveCommitmentRecord`
    - On failure: queue an in-memory pending record, render a persistent banner ("Funds at risk — commitment not saved")
    - On next app launch, retry the queued write before the privacy flow becomes available
    - _Requirements: 7.7_

  - [x] 7.5 Write property test for CommitmentRecord SecureStore round-trip (Property 10)
    - **Property 10: CommitmentRecord SecureStore round-trip**
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.5**
    - `fast-check` generates random valid records (using an in-memory SecureStore mock); assert save → load returns a deep-equal record; assert `markSpent` flips `spent` and preserves all other fields

  - [x] 7.6 Write property test for sensitive-key isolation (Property 11)
    - **Property 11: Sensitive-key isolation**
    - **Validates: Requirements 7.6**
    - Spy on `AsyncStorage`, `transactionStore`, all non-SecureStore-backed Zustand slices, and `fetch` request bodies during a deposit / withdraw / stealth-send flow
    - Assert that `nullifier` and `secret` strings never appear in any captured payload, except inside the relayer withdraw request to the configured `RELAYER_BASE_URL` (where `nullifierHash` is allowed but `nullifier` and `secret` are not)

- [x] 8. Implement Layer 4 — circuit prover and contract constants
  - [x] 8.1 Create `apps/consumer-app/src/constants/circuit.ts`
    - Export `CIRCUIT_WASM_URL` and `CIRCUIT_ZKEY_URL` from environment (`process.env.EXPO_PUBLIC_CIRCUIT_WASM_URL` etc.) with documented fallbacks
    - _Requirements: 9.1_

  - [x] 8.2 Create `apps/consumer-app/src/constants/contracts.ts`
    - Import `packages/contracts-evm/deployments/sepolia.json`
    - Export `VEIL_POOL_ADDRESS`, `STEALTH_ANNOUNCER_ADDRESS`, `GROTH16_VERIFIER_ADDRESS`
    - Export `isPrivacyStackConfigured()` returning true only when all three pass `^0x[a-fA-F0-9]{40}$` and are non-zero
    - _Requirements: 5.5, 5.6, 13.1, 13.2, 13.3_

  - [x] 8.3 Add `apps/consumer-app/src/hooks/useNetworkPrivacySupport.ts`
    - Returns `{ supported: boolean, reason?: string }` based on active `chainId` (Sepolia = 11155111) and `isPrivacyStackConfigured()`
    - _Requirements: 13.4_

  - [x] 8.4 Rewrite `apps/consumer-app/src/components/ZkpProver.tsx`
    - Bundle snarkjs UMD into the WebView HTML
    - Define and implement the `PROVE` / `PROOF_SUCCESS` / `PROOF_ERROR` / `READY` postMessage protocol
    - On `PROVE`, call `snarkjs.groth16.fullProve({nullifier, secret, pathElements, pathIndices, merkleRoot, nullifierHash, recipient, amount}, CIRCUIT_WASM_URL, CIRCUIT_ZKEY_URL)`
    - Post `PROOF_SUCCESS {proof, publicSignals}` on resolution
    - Post `PROOF_ERROR {error}` on `fetch` failure of either artifact URL or any throw from `fullProve`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.5 Write property test for ZkpProver postMessage protocol fidelity (Property 12)
    - **Property 12: ZkpProver postMessage protocol fidelity**
    - **Validates: Requirements 9.3, 9.4**
    - Mock `snarkjs.groth16.fullProve` inside the WebView; `fast-check` generates random input objects
    - Assert `fullProve` is called with the same eight key/value pairs and the resulting `PROOF_SUCCESS` payload contains `proof` and `publicSignals` unchanged

- [x] 9. Implement Layer 4 — relayer client and payment dispatcher
  - [x] 9.1 Add relayer client `apps/consumer-app/src/services/relayerClient.ts`
    - `submitWithdraw(body)` POSTs to `${RELAYER_BASE_URL}/api/v1/relayer/withdraw` with a 30-second `AbortController` timeout
    - Body conforms to the relayer `WithdrawRequestSchema` (mirror the schema definition for compile-time safety)
    - Surface a typed `RelayerError` distinguishing HTTP-non-2xx, timeout, and network failure
    - _Requirements: 8.1, 8.2, 8.5_

  - [x] 9.2 Modify `apps/consumer-app/src/hooks/usePaymentTransaction.ts` with a single `switch (privacyLevel)` dispatcher
    - `'standard'` → existing direct transfer; do not call announcer or pool
    - `'stealth'` → `deriveStealthAddress` → fund stealth address → after on-chain confirmation, call `StealthAnnouncer.announce(1, stealthAddress, ephemeralPubKey, '0x')`; on `announce` failure, surface a toast but keep underlying tx successful
    - `'max'` → load `CommitmentRecord` (or guide user back to deposit if missing) → run `ZkpProver` → call `relayerClient.submitWithdraw`; on success, poll `txHash` and `markSpent` on confirmation
    - Fail-fast guard at flow start: bail with a config-error toast when `!isPrivacyStackConfigured()`
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8, 7.3, 7.4, 8.1, 8.3, 8.4, 12.4, 12.5_

  - [x] 9.3 Add a `WithdrawRequestSchema` mirror in `apps/consumer-app/src/schemas/withdrawRequest.ts`
    - Validate the body before posting to the relayer; reject locally with a UI error if it fails
    - _Requirements: 8.2_

  - [x] 9.4 Write property test for stealth-announcer dispatch gating (Property 9)
    - **Property 9: Stealth announcer is invoked iff privacy level is 'stealth'**
    - **Validates: Requirements 4.1, 4.6, 4.7, 12.4, 12.5**
    - `fast-check` generates random `(recipient, amount, token, privacyLevel)` triples; mock contracts and observe call counts
    - Assert `announce` call count is `1` for `'stealth'` and `0` otherwise; for `'stealth'`, assert `announce` is observed strictly before the local "confirmed" transition

  - [x] 9.5 Write property test for the mobile-relayer request shape and HTTP failure handling (Property 17)
    - **Property 17: Mobile-relayer request shape and HTTP failure handling**
    - **Validates: Requirements 8.1, 8.2, 8.3**
    - `fast-check` generates `'max'`-privacy payment inputs; intercept `fetch` and assert exactly one POST to `${RELAYER_BASE_URL}/api/v1/relayer/withdraw` with a body matching `WithdrawRequestSchema`
    - For each non-2xx mocked response, assert `txStatus === 'failed'` and the rendered error string contains the response status

- [x] 10. Implement Layer 4 — stealth scanner and privacy-level UI
  - [x] 10.1 Create `apps/consumer-app/src/hooks/useStealthScanner.ts`
    - Read `lastScannedBlock` from SecureStore on mount; fall back to deployment-time start block
    - Subscribe to `AppState`; pause the polling timer on `background`, resume on `active`
    - Every `intervalMs` (default 60s): query `Announcement` logs from `lastScannedBlock + 1` to current head; for each log, run `checkStealthAddressMatch`; on match, append to transaction history with status `'incoming_stealth'`
    - Persist `lastScannedBlock = head` only after a successful query; `console.warn` on RPC failure and keep the cursor in place
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 10.2 Write property test for stealth scanner completeness (Property 18)
    - **Property 18: Stealth scanner completeness within two polling intervals**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.6, 11.7**
    - Model-based `fast-check` test: generate a random sequence of `(blockHeight, isMatch)` events plus a sequence of polling ticks (some with simulated RPC failures); simulate the scanner over the model
    - Assert every matching event appears in transaction history within two successful ticks of its block being ≤ chain head
    - Assert `lastScannedBlock` never advances past a block whose `getLogs` call rejected

  - [x] 10.3 Update `PrivacyLevel` union and `PrivacyLevelScreen`
    - In `apps/consumer-app/src/stores/settingsStore.ts`, add `'stealth'` to the `PrivacyLevel` union
    - In `apps/consumer-app/src/screens/PrivacyLevelScreen.tsx`, render three options (`'standard'`, `'stealth'`, `'max'`)
    - Stealth description: "One-time stealth address. The recipient discovers the payment via an announcement event; on-chain it looks like a transfer to a fresh address."
    - When `useNetworkPrivacySupport()` reports unsupported, render `'stealth'` and `'max'` rows disabled with the explanatory message
    - Pre-select the option matching `defaultPrivacyLevel` from `settingsStore`
    - On confirm, navigate to the payment confirmation screen with the selected `privacyLevel`
    - _Requirements: 12.1, 12.2, 12.3, 12.6, 12.7, 13.4_

  - [x] 10.4 Write property test for network gating (Property 19)
    - **Property 19: Network gating disables stealth and max levels off Sepolia**
    - **Validates: Requirements 13.4**
    - `fast-check` over `chainId` values and `isPrivacyStackConfigured()` boolean: render `PrivacyLevelScreen` with React Testing Library; assert `'stealth'` and `'max'` rows are disabled when `chainId !== 11155111`, selectable when `chainId === 11155111 && isPrivacyStackConfigured()`

  - [x] 10.5 Write RN unit tests for AppState pause/resume and post-deposit error banner
    - Verify scanner timer stops on `background` and restarts on `active`
    - Verify the persistent banner renders on SecureStore write failure and the queued retry runs on next mount
    - _Requirements: 7.7, 11.5_

- [x] 11. Final integration and end-to-end wiring
  - [x] 11.1 Wire `apps/consumer-app/src/screens/PrivacyLevelScreen.tsx` and `usePaymentTransaction` into the existing send flow
    - Replace any prior mock dispatch with the new `switch (privacyLevel)` path
    - Ensure the deposit flow writes `CommitmentRecord` before the user can withdraw
    - Confirm no zero-address fallbacks remain in the payment or scanning flows
    - _Requirements: 5.5, 13.2, 13.3_

  - [x] 11.2 Run `compile.sh` against deployed circuit, deploy to Sepolia with `DeployPrivacyStack.s.sol`, populate `sepolia.json`, and confirm `isPrivacyStackConfigured()` returns true in the app
    - Update `RELAYER_VEILPOOL_ALLOWLIST` env entry on the relayer to include the deployed `VeilPool` address
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.3, 13.1_

  - [x] 11.3 Write a scripted end-to-end smoke test covering deposit → prove → relay → withdraw → mark spent
    - Use a real WebView in a detox-style harness, the deployed verifier on Sepolia (or a local Anvil fork), and the running relayer
    - Validates Requirement 9.6 round-trip and the full integration of Properties 1, 2, 3, 5, 6, 13, 17
    - _Requirements: 3.6, 9.6_

- [x] 12. Final checkpoint — full stack
  - Ensure all property tests, unit tests, and the smoke test pass; ensure `forge test`, `pnpm --filter backend test`, and `pnpm --filter consumer-app test` all succeed. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. They cover unit, integration, and property-based tests.
- Property test sub-tasks are placed adjacent to the implementation they validate so failures are caught early.
- Each property sub-task explicitly references its property number and the requirement clauses it validates, traceable back to `design.md` §Correctness Properties.
- Checkpoints (tasks 4, 6, 12) are stop-points for confirming layer integrity before moving on; they involve no new code.
- The canonical public-input ordering `(merkleRoot, nullifierHash, recipient, amount)` is the load-bearing invariant; task 1.1 anchors it in code comments at every site so future drift is hard to introduce silently.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.3", "3.1", "3.10", "5.1", "7.1", "7.3", "8.1", "8.2", "9.3"] },
    { "id": 2, "tasks": ["2.2", "3.2", "3.11", "5.2", "7.2", "7.4", "7.5", "7.6", "8.3", "9.1", "10.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "3.3", "3.4", "3.12", "5.3", "8.4", "10.1", "10.4"] },
    { "id": 4, "tasks": ["3.5", "3.6", "3.7", "3.8", "3.9", "3.13", "5.4", "8.5", "9.2", "10.2", "10.5"] },
    { "id": 5, "tasks": ["3.14", "5.5", "5.6", "5.7", "5.8", "9.4", "9.5", "11.1"] },
    { "id": 6, "tasks": ["11.2"] },
    { "id": 7, "tasks": ["11.3"] }
  ]
}
```
