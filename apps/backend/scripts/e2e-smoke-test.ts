// Feature: veilpay-privacy-stack, Task 11.3 — end-to-end smoke test
// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
//
// =============================================================================
// VeilPay Privacy Stack — End-to-End Smoke Test
// =============================================================================
//
// What this script does
// ---------------------
// Exercises the full privacy pipeline programmatically against a real
// chain (Sepolia or a local Anvil fork) and a running relayer:
//
//     deposit  →  prove  →  relay  →  withdraw  →  mark spent
//
// Each step is a real on-chain or HTTP interaction; nothing is mocked.
// The script is the mechanical equivalent of the consumer-app's
// `usePaymentTransaction` `'max'` privacy branch, but driven from Node
// so a CI runner or operator can validate Requirement 9.6's end-to-end
// round-trip without firing up a phone or detox harness.
//
// Why Node + ethers + snarkjs (not detox / WebView)
// -------------------------------------------------
// Task 11.3's intent is to validate the integration of Properties 1, 2, 3,
// 5, 6, 13, and 17 — i.e. the cryptographic and HTTP boundaries between
// circuit, contract, and relayer. None of those properties depend on the
// React Native runtime. Driving the WebView from detox just to run the
// same `snarkjs.groth16.fullProve` call adds enormous flakiness for zero
// additional coverage. Node.js + snarkjs reproduces the exact byte-for-byte
// proof the WebView would generate (snarkjs is the same library on both
// sides), so the smoke test stays deterministic and fast.
//
// What this script does NOT do
// ----------------------------
// - It does NOT redeploy contracts. Task 11.2 must have run first;
//   `deployments/sepolia.json` must contain real addresses.
// - It does NOT start the relayer. The operator must launch it with
//   `RELAYER_PRIVATE_KEY`, `RELAYER_RPC_URL`, and `RELAYER_VEILPOOL_ALLOWLIST`
//   set to the deployed pool.
// - It does NOT mint a test ERC-20. The operator must supply a token
//   the depositor wallet already holds and the relayer can withdraw to.
// - It does NOT compile the circuit. Task 2.2 (`compile.sh`) must have
//   produced `withdraw.wasm`, `withdraw_final.zkey`, and
//   `verification_key.json` under `packages/circuits/build/`.
//
// Exit codes
// ----------
//   0  — every step succeeded (round-trip verified)
//   1  — any step failed; failure is logged with a descriptive message
// =============================================================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
// `snarkjs` ships CommonJS without TS declarations; we use a runtime
// `require` with a narrowed type so the rest of the file stays strict.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs: {
  groth16: {
    fullProve: (
      input: Record<string, string | string[]>,
      wasmPath: string,
      zkeyPath: string
    ) => Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify: (
      vkey: unknown,
      publicSignals: string[],
      proof: Groth16Proof
    ) => Promise<boolean>;
  };
} = require('snarkjs');

// `circomlibjs` lacks TS declarations; same pattern as `merkleTree.ts`.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const circomlibjs: {
  buildPoseidon: () => Promise<PoseidonFn>;
} = require('circomlibjs');

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

interface FieldShape {
  toObject(x: Uint8Array): bigint;
  e(x: bigint | number | string): Uint8Array;
}

interface PoseidonFn {
  (inputs: ReadonlyArray<bigint | number | string>): Uint8Array;
  F: FieldShape;
}

interface SepoliaDeployment {
  groth16Verifier: string;
  veilPool: string;
  stealthAnnouncer: string;
  chainId: number;
  blockNumber: number;
}

/** Mirrors `apps/consumer-app/src/stores/commitmentStore.ts`'s `CommitmentRecord`. */
interface CommitmentRecord {
  nullifier: string;
  secret: string;
  commitmentHash: string;
  leafIndex: number;
  merkleRoot: string;
  amount: string;
  token: string;
  chainKey: 'evm-sepolia';
  timestamp: number;
  spent: boolean;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * BN254 scalar field size — same as `VeilPool.FIELD_SIZE`. We sample
 * `nullifier` and `secret` modulo this so witness generation never
 * rejects an out-of-range input.
 */
const FIELD_SIZE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/** Tornado-style depth-20 tree, same as `withdraw.circom` and `VeilPool.LEVELS`. */
const LEVELS = 20;

const RELAYER_BASE_URL = process.env.RELAYER_BASE_URL ?? 'http://localhost:3000';
const RELAYER_TIMEOUT_MS = 30_000;
const CONFIRMATION_POLL_INTERVAL_MS = 4_000;
const CONFIRMATION_POLL_TIMEOUT_MS = 180_000;

/**
 * The same minimal ABI the relayer controller uses, extended with `deposit`
 * (so we can fund the pool) and `nullifierSpent` (so we can verify the
 * mark-spent invariant on chain after the withdraw lands).
 */
const VEILPOOL_ABI = [
  'function deposit(bytes32 commitment, address token, uint256 amount) returns (uint32)',
  'function withdraw(bytes32 nullifierHash, bytes proof, bytes32 merkleRoot, address recipient, address token, uint256 amount)',
  'function nullifierSpent(bytes32) view returns (bool)',
  'function feeRecipient() view returns (address)',
  'function WITHDRAW_FEE_BPS() view returns (uint256)',
  'event Deposit(bytes32 indexed commitment, uint32 indexed leafIndex, bytes32 merkleRoot, address indexed token, uint256 amount, address depositor)',
] as const;

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const;

// -----------------------------------------------------------------------------
// Off-chain Merkle tree (port of packages/circuits/test/merkleTree.ts)
// -----------------------------------------------------------------------------
//
// We re-implement the reference incremental tree here instead of importing
// the test helper for two reasons:
//
//   1. `packages/circuits/test/merkleTree.ts` is in `devDependencies` of
//      the `@veilpay/circuits` package; importing it from the backend
//      would introduce a fragile dev-only cross-package link.
//   2. Keeping the smoke test self-contained means an operator can run it
//      from a checkout where only the build artifacts (wasm/zkey/vkey)
//      are present — the test harness itself never has to be installed.
//
// The hashing function and zero ladder match the on-chain pool exactly
// (Properties 2 and 3 already validate this equivalence in Foundry; we
// rely on that invariant here rather than re-deriving it).

class IncrementalMerkleTree {
  readonly levels: number;
  private readonly poseidon: PoseidonFn;
  private readonly F: FieldShape;
  private readonly zeros: bigint[];
  private readonly filledSubtrees: bigint[];
  private readonly nodes: Map<number, bigint>[];
  private currentRoot: bigint;
  private nextIndex = 0;

  constructor(poseidon: PoseidonFn, levels: number = LEVELS) {
    this.levels = levels;
    this.poseidon = poseidon;
    this.F = poseidon.F;

    this.zeros = new Array(levels + 1);
    this.zeros[0] = 0n;
    for (let i = 1; i <= levels; i++) {
      this.zeros[i] = this.hashPair(this.zeros[i - 1], this.zeros[i - 1]);
    }

    this.filledSubtrees = new Array(levels);
    for (let i = 0; i < levels; i++) this.filledSubtrees[i] = this.zeros[i];

    this.nodes = new Array(levels + 1).fill(null).map(() => new Map<number, bigint>());
    this.currentRoot = this.zeros[levels];
  }

  insert(leaf: bigint): void {
    if (this.nextIndex >= 2 ** this.levels) {
      throw new Error('IncrementalMerkleTree: tree is full');
    }
    let currentIndex = this.nextIndex;
    let currentHash = leaf;
    this.nodes[0].set(currentIndex, leaf);
    for (let i = 0; i < this.levels; i++) {
      let left: bigint;
      let right: bigint;
      if ((currentIndex & 1) === 0) {
        left = currentHash;
        right = this.zeros[i];
        this.filledSubtrees[i] = currentHash;
      } else {
        left = this.filledSubtrees[i];
        right = currentHash;
      }
      currentHash = this.hashPair(left, right);
      currentIndex >>= 1;
      this.nodes[i + 1].set(currentIndex, currentHash);
    }
    this.currentRoot = currentHash;
    this.nextIndex += 1;
  }

  root(): bigint {
    return this.currentRoot;
  }

  path(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = new Array(this.levels);
    const pathIndices: number[] = new Array(this.levels);
    let currentIndex = index;
    for (let i = 0; i < this.levels; i++) {
      const sideBit = currentIndex & 1;
      pathIndices[i] = sideBit;
      const siblingIndex = currentIndex ^ 1;
      const sibling = this.nodes[i].get(siblingIndex);
      pathElements[i] = sibling !== undefined ? sibling : this.zeros[i];
      currentIndex >>= 1;
    }
    return { pathElements, pathIndices };
  }

  private hashPair(left: bigint, right: bigint): bigint {
    return this.F.toObject(this.poseidon([left, right]));
  }
}

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

function log(step: string, message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[${step}] ${message}`);
}

function logError(step: string, message: string): void {
  // eslint-disable-next-line no-console
  console.error(`[${step}] ✗ ${message}`);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(
      `Missing required env var: ${name}. See e2e-smoke-test.README.md.`
    );
  }
  return v;
}

function toBytes32Hex(value: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

/**
 * Sample a field element uniformly modulo `FIELD_SIZE`. Rejection sampling
 * over 256-bit randomness would be more uniform, but the bias from a single
 * `mod` step on a 256-bit input is negligible for our purposes (~2^-253).
 */
function randomFieldElement(): bigint {
  const bytes = ethers.randomBytes(32);
  return BigInt(ethers.hexlify(bytes)) % FIELD_SIZE;
}

async function loadDeployment(): Promise<SepoliaDeployment> {
  // The script lives at apps/backend/scripts/; the deployments file lives
  // at packages/contracts-evm/deployments/. Resolve relative to this file
  // rather than `process.cwd()` so the test runs the same regardless of
  // where the operator invokes it.
  const here = __dirname;
  const deploymentsPath = path.resolve(
    here,
    '..',
    '..',
    '..',
    'packages',
    'contracts-evm',
    'deployments',
    'sepolia.json'
  );
  const raw = await fs.readFile(deploymentsPath, 'utf8');
  const parsed = JSON.parse(raw) as SepoliaDeployment;

  const ZERO = '0x0000000000000000000000000000000000000000';
  const ADDR = /^0x[a-fA-F0-9]{40}$/;
  for (const key of ['groth16Verifier', 'veilPool', 'stealthAnnouncer'] as const) {
    const value = parsed[key];
    if (typeof value !== 'string' || !ADDR.test(value) || value === ZERO) {
      throw new Error(
        `Deployment field ${key} is missing or zero in ${deploymentsPath}. ` +
          'Run task 11.2 (DeployPrivacyStack.s.sol) first.'
      );
    }
  }
  return parsed;
}

async function loadCircuitArtifacts(): Promise<{
  wasmPath: string;
  zkeyPath: string;
  vkey: unknown;
}> {
  const here = __dirname;
  const buildDir = path.resolve(
    here,
    '..',
    '..',
    '..',
    'packages',
    'circuits',
    'build'
  );
  const wasmPath = path.join(buildDir, 'withdraw.wasm');
  const zkeyPath = path.join(buildDir, 'withdraw_final.zkey');
  const vkeyPath = path.join(buildDir, 'verification_key.json');
  for (const p of [wasmPath, zkeyPath, vkeyPath]) {
    try {
      await fs.access(p);
    } catch {
      throw new Error(
        `Circuit artifact missing: ${p}. Run \`pnpm --filter @veilpay/circuits compile\` first.`
      );
    }
  }
  const vkey = JSON.parse(await fs.readFile(vkeyPath, 'utf8')) as unknown;
  return { wasmPath, zkeyPath, vkey };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Step implementations
// -----------------------------------------------------------------------------

interface DepositResult {
  record: CommitmentRecord;
  recordPath: string;
  txHash: string;
  blockNumber: number;
}

async function stepDeposit(args: {
  pool: ethers.Contract;
  token: ethers.Contract;
  poolAddress: string;
  tokenAddress: string;
  amount: bigint;
  depositor: ethers.Wallet;
  poseidon: PoseidonFn;
  tree: IncrementalMerkleTree;
}): Promise<DepositResult> {
  const { pool, token, poolAddress, tokenAddress, amount, depositor, poseidon, tree } = args;

  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  const commitmentBn = poseidon.F.toObject(poseidon([nullifier, secret]));
  const commitmentHex = toBytes32Hex(commitmentBn);

  log('deposit', `commitment = ${commitmentHex}`);

  // Approve the pool for the exact deposit amount. We deliberately do NOT
  // use `MaxUint256`: the test models a real user flow where allowances
  // are scoped to the deposit.
  const approveTx = await token.approve(poolAddress, amount);
  await approveTx.wait();
  log('deposit', `approve tx ${approveTx.hash} confirmed`);

  const tx = await pool.deposit(commitmentHex, tokenAddress, amount);
  const receipt = await tx.wait();
  if (receipt === null || receipt.status !== 1) {
    throw new Error(`deposit tx ${tx.hash} did not succeed`);
  }

  // Pull the assigned leafIndex / merkleRoot from the emitted Deposit
  // event so the off-chain commitment record matches what the pool just
  // stamped on chain. We use `pool.interface.parseLog` instead of a raw
  // topic match because the ABI is the source of truth here.
  const iface = pool.interface;
  let leafIndex: number | undefined;
  let merkleRoot: string | undefined;
  for (const lg of receipt.logs as ethers.Log[]) {
    if (lg.address.toLowerCase() !== poolAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: [...lg.topics], data: lg.data });
      if (parsed?.name === 'Deposit') {
        leafIndex = Number(parsed.args.leafIndex);
        merkleRoot = parsed.args.merkleRoot as string;
        break;
      }
    } catch {
      // not our event; keep scanning
    }
  }
  if (leafIndex === undefined || merkleRoot === undefined) {
    throw new Error('Deposit event was not emitted by the pool');
  }
  log('deposit', `leafIndex=${leafIndex}, merkleRoot=${merkleRoot}`);

  // Mirror the on-chain insert in the off-chain reference tree; the
  // post-insert root MUST match. This is Property 2 / 3 in miniature —
  // a smoke test that validates the off-chain prover and the on-chain
  // pool agree on the root before we go through the (expensive) prove
  // step.
  tree.insert(commitmentBn);
  const localRoot = toBytes32Hex(tree.root());
  if (localRoot.toLowerCase() !== merkleRoot.toLowerCase()) {
    throw new Error(
      `Off-chain tree root ${localRoot} does not match on-chain root ${merkleRoot}. ` +
        'Did the Poseidon hasher diverge between Layer 1 and Layer 2?'
    );
  }

  const record: CommitmentRecord = {
    nullifier: toBytes32Hex(nullifier),
    secret: toBytes32Hex(secret),
    commitmentHash: commitmentHex,
    leafIndex,
    merkleRoot,
    amount: amount.toString(),
    token: tokenAddress,
    chainKey: 'evm-sepolia',
    timestamp: Math.floor(Date.now() / 1000),
    spent: false,
  };

  // Emulate SecureStore by serialising the record to a JSON file scoped
  // to the depositor's address. This file is the artifact that the
  // mark-spent step rewrites at the end of the run.
  const recordPath = path.resolve(
    process.cwd(),
    `.smoke-${depositor.address.toLowerCase()}-${commitmentHex.slice(2, 10)}.json`
  );
  await fs.writeFile(recordPath, JSON.stringify(record, null, 2), 'utf8');
  log('deposit', `record persisted to ${recordPath}`);

  return {
    record,
    recordPath,
    txHash: tx.hash as string,
    blockNumber: Number(receipt.blockNumber),
  };
}

interface ProveResult {
  proof: Groth16Proof;
  publicSignals: string[];
  proofBytes: string;
  nullifierHashHex: string;
}

async function stepProve(args: {
  record: CommitmentRecord;
  recipient: string;
  tree: IncrementalMerkleTree;
  poseidon: PoseidonFn;
  wasmPath: string;
  zkeyPath: string;
  vkey: unknown;
}): Promise<ProveResult> {
  const { record, recipient, tree, poseidon, wasmPath, zkeyPath, vkey } = args;

  const nullifier = BigInt(record.nullifier);
  const secret = BigInt(record.secret);
  const amount = BigInt(record.amount);

  const nullifierHashBn = poseidon.F.toObject(poseidon([nullifier]));
  const nullifierHashHex = toBytes32Hex(nullifierHashBn);

  const { pathElements, pathIndices } = tree.path(record.leafIndex);

  // The input shape here is the exact shape `ZkpProver` posts into
  // snarkjs's `fullProve`. Keeping it byte-identical guarantees we are
  // generating the same proof the WebView would. (Property 12.)
  const input: Record<string, string | string[]> = {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices: pathIndices.map((x) => x.toString()),
    merkleRoot: BigInt(record.merkleRoot).toString(),
    nullifierHash: nullifierHashBn.toString(),
    recipient: BigInt(recipient).toString(),
    amount: amount.toString(),
  };

  log('prove', 'generating Groth16 proof (this is the slow step)…');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );
  log('prove', `proof generated; publicSignals=${JSON.stringify(publicSignals)}`);

  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  if (!ok) {
    throw new Error('Local snarkjs.groth16.verify rejected the freshly generated proof');
  }
  log('prove', 'local snarkjs verify ✓');

  // ABI-encode the Groth16 proof to match the wrapper installed by
  // `compile.sh` post-processing: `(uint256[2], uint256[2][2], uint256[2])`.
  // The wrapper decodes this exact shape; any mismatch causes the verifier
  // to return `false` and `VeilPool.withdraw` to revert with `InvalidProof`.
  const a: [string, string] = [proof.pi_a[0], proof.pi_a[1]];
  // snarkjs emits pi_b in (X, Y) coordinate order; the on-chain pairing
  // expects each G2 element with the imaginary component first, so we
  // swap each pair before encoding.
  const b: [[string, string], [string, string]] = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c: [string, string] = [proof.pi_c[0], proof.pi_c[1]];

  const proofBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256[2]', 'uint256[2][2]', 'uint256[2]'],
    [a, b, c]
  );

  return { proof, publicSignals, proofBytes, nullifierHashHex };
}

interface RelayResult {
  txHash: string;
}

async function stepRelay(args: {
  record: CommitmentRecord;
  recipient: string;
  proofBytes: string;
  publicSignals: string[];
  nullifierHashHex: string;
  poolAddress: string;
}): Promise<RelayResult> {
  const { record, recipient, proofBytes, publicSignals, nullifierHashHex, poolAddress } = args;

  // Convert publicSignals to bytes32 hex form for the relayer schema.
  // The schema requires hex strings; snarkjs returns decimal strings.
  const publicSignalsHex = publicSignals.map((sig) => toBytes32Hex(BigInt(sig)));

  const body = {
    nullifierHash: nullifierHashHex,
    proof: proofBytes,
    publicSignals: publicSignalsHex,
    merkleRoot: record.merkleRoot,
    recipient,
    token: record.token,
    amount: record.amount,
    chainKey: 'evm-sepolia' as const,
    contractAddress: poolAddress,
  };

  const url = `${RELAYER_BASE_URL}/api/v1/relayer/withdraw`;
  log('relay', `POST ${url}`);
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    RELAYER_TIMEOUT_MS
  );
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(`Relayer responded ${res.status}: ${text}`);
  }
  const parsed = JSON.parse(text) as { success?: boolean; txHash?: string };
  if (parsed.success !== true || typeof parsed.txHash !== 'string') {
    throw new Error(`Relayer success path returned unexpected body: ${text}`);
  }
  log('relay', `accepted; txHash=${parsed.txHash}`);
  return { txHash: parsed.txHash };
}

async function stepWithdrawConfirmation(args: {
  provider: ethers.Provider;
  txHash: string;
  token: ethers.Contract;
  pool: ethers.Contract;
  recipient: string;
  amount: bigint;
}): Promise<{ feeRecipient: string; fee: bigint; payout: bigint }> {
  const { provider, txHash, token, pool, recipient, amount } = args;

  const recipientBalanceBefore = (await token.balanceOf(recipient)) as bigint;
  const feeRecipient = (await pool.feeRecipient()) as string;
  const feeBps = (await pool.WITHDRAW_FEE_BPS()) as bigint;
  const feeRecipientBalanceBefore = (await token.balanceOf(feeRecipient)) as bigint;

  const fee = (amount * feeBps) / 10_000n;
  const payout = amount - fee;

  // Poll for the receipt rather than blocking on `tx.wait`, since we did
  // not broadcast the tx ourselves and have no `TransactionResponse` in
  // hand from the relayer.
  const start = Date.now();
  let receipt: ethers.TransactionReceipt | null = null;
  while (Date.now() - start < CONFIRMATION_POLL_TIMEOUT_MS) {
    receipt = await provider.getTransactionReceipt(txHash);
    if (receipt !== null) break;
    await new Promise((r) => setTimeout(r, CONFIRMATION_POLL_INTERVAL_MS));
  }
  if (receipt === null) {
    throw new Error(`Withdraw tx ${txHash} did not confirm within ${CONFIRMATION_POLL_TIMEOUT_MS}ms`);
  }
  if (receipt.status !== 1) {
    throw new Error(`Withdraw tx ${txHash} reverted on chain`);
  }
  log('withdraw', `tx ${txHash} confirmed in block ${receipt.blockNumber}`);

  const recipientBalanceAfter = (await token.balanceOf(recipient)) as bigint;
  const feeRecipientBalanceAfter = (await token.balanceOf(feeRecipient)) as bigint;

  const recipientDelta = recipientBalanceAfter - recipientBalanceBefore;
  const feeDelta = feeRecipientBalanceAfter - feeRecipientBalanceBefore;

  if (recipientDelta !== payout) {
    throw new Error(
      `Recipient balance delta ${recipientDelta} does not equal expected payout ${payout}`
    );
  }
  if (feeDelta !== fee) {
    throw new Error(
      `Fee recipient balance delta ${feeDelta} does not equal expected fee ${fee}`
    );
  }
  log('withdraw', `recipient +${payout}, feeRecipient +${fee} (Property 6 ✓)`);

  return { feeRecipient, fee, payout };
}

async function stepMarkSpent(args: {
  pool: ethers.Contract;
  nullifierHashHex: string;
  recordPath: string;
  record: CommitmentRecord;
}): Promise<void> {
  const { pool, nullifierHashHex, recordPath, record } = args;
  const onChainSpent = (await pool.nullifierSpent(nullifierHashHex)) as boolean;
  if (onChainSpent !== true) {
    throw new Error(
      `On-chain nullifierSpent[${nullifierHashHex}] is false; expected true after withdraw`
    );
  }
  log('mark-spent', `pool.nullifierSpent[nullifierHash] = true ✓`);

  const updated: CommitmentRecord = { ...record, spent: true };
  await fs.writeFile(recordPath, JSON.stringify(updated, null, 2), 'utf8');
  log('mark-spent', `local record at ${recordPath} updated with spent=true`);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  log('setup', `relayer base url: ${RELAYER_BASE_URL}`);

  const rpcUrl = requireEnv('E2E_RPC_URL');
  const depositorPk = requireEnv('E2E_DEPOSITOR_PK');
  const tokenAddress = requireEnv('E2E_TOKEN_ADDRESS');
  const recipient = requireEnv('E2E_RECIPIENT_ADDRESS');
  const amountRaw = requireEnv('E2E_AMOUNT');
  if (!/^[1-9][0-9]*$/.test(amountRaw)) {
    throw new Error(
      `E2E_AMOUNT must be a positive decimal string (got ${amountRaw}); use the token's smallest unit.`
    );
  }
  const amount = BigInt(amountRaw);
  if (!ethers.isAddress(recipient)) {
    throw new Error(`E2E_RECIPIENT_ADDRESS is not a valid address: ${recipient}`);
  }
  if (!ethers.isAddress(tokenAddress)) {
    throw new Error(`E2E_TOKEN_ADDRESS is not a valid address: ${tokenAddress}`);
  }

  const deployment = await loadDeployment();
  log('setup', `pool=${deployment.veilPool}`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const depositor = new ethers.Wallet(depositorPk, provider);
  log('setup', `depositor=${depositor.address}`);

  const pool = new ethers.Contract(deployment.veilPool, VEILPOOL_ABI, depositor);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, depositor);

  const depositorBalance = (await token.balanceOf(depositor.address)) as bigint;
  if (depositorBalance < amount) {
    throw new Error(
      `Depositor ${depositor.address} has ${depositorBalance} of token ${tokenAddress}, ` +
        `but the smoke test needs ${amount}. Fund the wallet before re-running.`
    );
  }

  const { wasmPath, zkeyPath, vkey } = await loadCircuitArtifacts();
  log('setup', `wasm=${wasmPath}`);
  log('setup', `zkey=${zkeyPath}`);

  const poseidon = await circomlibjs.buildPoseidon();
  const tree = new IncrementalMerkleTree(poseidon, LEVELS);

  // Step 1 — Deposit
  const deposit = await stepDeposit({
    pool,
    token,
    poolAddress: deployment.veilPool,
    tokenAddress,
    amount,
    depositor,
    poseidon,
    tree,
  });

  // Step 2 — Prove
  const prove = await stepProve({
    record: deposit.record,
    recipient,
    tree,
    poseidon,
    wasmPath,
    zkeyPath,
    vkey,
  });

  // Step 3 — Relay
  const relay = await stepRelay({
    record: deposit.record,
    recipient,
    proofBytes: prove.proofBytes,
    publicSignals: prove.publicSignals,
    nullifierHashHex: prove.nullifierHashHex,
    poolAddress: deployment.veilPool,
  });

  // Step 4 — Withdraw confirmation (balances + on-chain receipt)
  await stepWithdrawConfirmation({
    provider,
    txHash: relay.txHash,
    token: new ethers.Contract(tokenAddress, ERC20_ABI, provider),
    pool: new ethers.Contract(deployment.veilPool, VEILPOOL_ABI, provider),
    recipient,
    amount,
  });

  // Step 5 — Mark spent (on chain + local record)
  await stepMarkSpent({
    pool,
    nullifierHashHex: prove.nullifierHashHex,
    recordPath: deposit.recordPath,
    record: deposit.record,
  });

  log('done', 'end-to-end smoke test passed ✓');
}

main().catch((err) => {
  logError('fatal', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
