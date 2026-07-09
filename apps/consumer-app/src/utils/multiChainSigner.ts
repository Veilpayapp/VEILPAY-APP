/**
 * Veilpay Multi-Chain Signer
 *
 * Implements native transaction signing and broadcasting for non-EVM chains
 * using the same signing closure pattern as secureSigner.ts.
 *
 * SECURITY DESIGN:
 * - Mnemonic is retrieved from SecureStore, used to derive chain-specific keys,
 *   sign and broadcast — all within a single async scope.
 * - No key material is ever returned to the caller.
 * - Derived keys are local to each function's stack frame and eligible for GC.
 *
 * Supported chains:
 * - SVM  (Solana): Ed25519 + @solana/web3.js
 * - MVM  (Aptos):  Ed25519 + REST API transactions
 * - XLM  (Stellar): Ed25519 + Horizon API transactions (needs stellar-sdk)
 */

import { keccak256, stringToBytes, toBytes } from 'viem';
import TweetNacl from 'tweetnacl';
import { Buffer } from 'buffer/';
import { getRpcUrl } from './rpc';
import { captureError, addBreadcrumb } from './sentry';
import { getStoredMnemonic, TransactionError } from './transactions';
import { mnemonicToSeed } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import type { GasEstimate } from './gasEstimator';
import { withTimeout } from './timing';
import { validateAddress as sharedValidateAddress } from './validation';

// ─── Lazy-loaded module caches ──────────────────────────────────────────────

let solanaWeb3Promise: Promise<typeof import('@solana/web3.js')> | null = null;
let stellarSdkPromise: Promise<typeof import('stellar-sdk')> | null = null;

/** Deduplicate concurrent lazy imports */
function getSolanaWeb3(): Promise<typeof import('@solana/web3.js')> {
  if (!solanaWeb3Promise) {
    solanaWeb3Promise = import('@solana/web3.js');
  }
  return solanaWeb3Promise;
}

function getStellarSdk(): Promise<typeof import('stellar-sdk')> {
  if (!stellarSdkPromise) {
    stellarSdkPromise = import('stellar-sdk');
  }
  return stellarSdkPromise;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChainSignerParams {
  /** Recipient address (chain-specific format) */
  to: string;
  /** Amount as a human-readable string (e.g. '0.01') */
  value: string;
  /** Optional memo / reference note */
  memo?: string;
}

export interface ChainSignerResult {
  hash: string;
  chainId: string | number;
  gasEstimate: GasEstimate;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

const NATIVE_DECIMALS: Record<string, number> = {
  solana: 9,
  'solana-devnet': 9,
  aptos: 8,
  stellar: 7,
  'stellar-testnet': 7,
};

function getNativeDecimals(chainKey: string): number {
  return NATIVE_DECIMALS[chainKey] ?? 9;
}

function getChainType(chainKey: string): 'svm' | 'mvm' | 'xlm' {
  if (chainKey.startsWith('solana')) return 'svm';
  if (chainKey === 'aptos') return 'mvm';
  if (chainKey.startsWith('stellar')) return 'xlm';
  throw new TransactionError(`Unsupported non-EVM chain: ${chainKey}`, 'UNKNOWN');
}

function isSupportedNonEvmChain(chainKey: string): boolean {
  return ['solana', 'solana-devnet', 'aptos', 'stellar', 'stellar-testnet'].includes(chainKey);
}

// Key derivation is now handled securely inside each chain's specific function
// using genuine cryptographic paths rather than SLIP-0010 hashing.

/**
 * Convert a decimal string to the chain-native atomic unit.
 * Throws if the input contains invalid characters.
 */
function toAtomicUnits(value: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new TransactionError(`Invalid amount format: ${value}`, 'UNKNOWN');
  }
  const [whole, frac = ''] = value.split('.');
  const padded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + padded);
}

// ─── Solana (SVM) ────────────────────────────────────────────────────────────

async function sendSolanaTransaction(
  params: ChainSignerParams,
  chainKey: string,
  mnemonicWords: string[],
  ethPrice?: number
): Promise<ChainSignerResult> {
  const rpcUrl = getRpcUrl(chainKey);
  // These two are independent — load the web3 lib and derive the seed in parallel.
  const [{ PublicKey, Transaction, SystemProgram, Connection, Keypair }, seed] = await Promise.all([
    getSolanaWeb3(),
    mnemonicToSeed(mnemonicWords.join(' ')),
  ]);
  const derivedSeed = derivePath("m/44'/501'/0'/0'", Buffer.from(seed).toString('hex')).key;
  const solanaKeypair = Keypair.fromSeed(derivedSeed);

  const connection = new Connection(rpcUrl, 'confirmed');
  const fromKeypair = {
    publicKey: solanaKeypair.publicKey,
    secretKey: solanaKeypair.secretKey,
  };

  const toPublicKey = new PublicKey(params.to);
  const lamports = toAtomicUnits(params.value, getNativeDecimals(chainKey));

  if (lamports <= 0n) {
    throw new TransactionError(`Invalid SOL amount: ${params.value}`, 'UNKNOWN');
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toPublicKey,
      lamports: Number(lamports),
    })
  );

  const { blockhash, lastValidBlockHeight } = await withTimeout(
    connection.getLatestBlockhash('confirmed'),
    10_000
  );

  tx.recentBlockhash = blockhash;
  tx.feePayer = fromKeypair.publicKey;

  // Sign with native Ed25519 keypair
  tx.sign({ publicKey: fromKeypair.publicKey, secretKey: fromKeypair.secretKey });

  const rawTx = tx.serialize();
  const signature = await withTimeout(
    connection.sendRawTransaction(rawTx, { skipPreflight: false, maxRetries: 3 }),
    30_000
  );

  const gasEstimate: GasEstimate = {
    gasLimit: 0n,
    maxFeePerGas: 5000n,
    maxPriorityFeePerGas: 0n,
    gasPrice: 5000n,
    estimatedCostWei: 5000n,
    estimatedCostEth: '0.000005',
    estimatedCostUsd: ethPrice ? (0.000005 * ethPrice).toFixed(4) : null,
    isStale: false,
    fetchedAt: Date.now(),
  };

  return { hash: signature, chainId: chainKey, gasEstimate };
}

// ─── Aptos (MVM) ────────────────────────────────────────────────────────────

async function sendAptosTransaction(
  params: ChainSignerParams,
  chainKey: string,
  mnemonicWords: string[],
  ethPrice?: number
): Promise<ChainSignerResult> {
  const rpcUrl = getRpcUrl(chainKey);
  const toAddress = params.to.toLowerCase();
  
  // We use ts-sdk dynamically to avoid bloating initial bundle if not used
  const { Ed25519Account } = await import('@aptos-labs/ts-sdk');
  const aptosAccount = Ed25519Account.fromDerivationPath({ 
    path: "m/44'/637'/0'/0'/0'", 
    mnemonic: mnemonicWords.join(' ') 
  });
  
  const fromAddress = aptosAccount.accountAddress.toString();

  const amountOctas = toAtomicUnits(params.value, getNativeDecimals(chainKey));
  if (amountOctas <= 0n) {
    throw new TransactionError(`Invalid APT amount: ${params.value}`, 'UNKNOWN');
  }

  const { Aptos, AptosConfig } = await import('@aptos-labs/ts-sdk');
  const aptosConfig = new AptosConfig({ fullnode: rpcUrl });
  const aptosClient = new Aptos(aptosConfig);
  
  const transaction = await aptosClient.transaction.build.simple({
    sender: fromAddress,
    data: {
      function: '0x1::aptos_account::transfer',
      functionArguments: [toAddress, amountOctas]
    }
  });

  const senderAuthenticator = aptosClient.transaction.sign({
    signer: aptosAccount,
    transaction,
  });

  const submitRes = await aptosClient.transaction.submit.simple({
    transaction,
    senderAuthenticator,
  });

  const txHash = submitRes.hash;
  if (!txHash) {
    throw new TransactionError('Aptos transaction missing hash in response', 'UNKNOWN');
  }

  const gasEstimate: GasEstimate = {
    gasLimit: 2000n,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 0n,
    gasPrice: 100n,
    estimatedCostWei: 200000n,
    estimatedCostEth: '0.0002',
    estimatedCostUsd: ethPrice ? (0.0002 * ethPrice).toFixed(4) : null,
    isStale: false,
    fetchedAt: Date.now(),
  };

  return { hash: txHash, chainId: chainKey, gasEstimate };
}

// ─── Stellar (XLM) ────────────────────────────────────────────────────────

async function sendStellarTransaction(
  params: ChainSignerParams,
  chainKey: string,
  mnemonicWords: string[],
  ethPrice?: number
): Promise<ChainSignerResult> {
  const { Keypair, TransactionBuilder, Operation, Networks, Asset, Memo, Account, Horizon } = await getStellarSdk();

  const isTestnet = chainKey === 'stellar-testnet';
  const horizonUrl = isTestnet
    ? 'https://horizon-testnet.stellar.org'
    : 'https://horizon.stellar.org';
  const networkPassphrase = isTestnet ? Networks.TESTNET : Networks.PUBLIC;

  const toAddress = params.to;
  
  const seed = await mnemonicToSeed(mnemonicWords.join(' '));
  const stellarDerivedSeed = derivePath("m/44'/148'/0'", Buffer.from(seed).toString('hex')).key;
  const fromKeypair = Keypair.fromRawEd25519Seed(stellarDerivedSeed as any);
  const fromAddress = fromKeypair.publicKey();

  const amountStroops = toAtomicUnits(params.value, getNativeDecimals(chainKey));
  if (amountStroops <= 0n) {
    throw new TransactionError(`Invalid XLM amount: ${params.value}`, 'UNKNOWN');
  }

  // Use the official Horizon SDK server instance for account lookup and submission
  const server = new Horizon.Server(horizonUrl);

  let accountData;
  try {
    accountData = await withTimeout(server.loadAccount(fromAddress), 10_000);
  } catch (e: any) {
    throw new TransactionError(
      `Stellar account not found or network unreachable: ${e?.message || e}`,
      'NETWORK_ERROR'
    );
  }

  // Check balance — reserve scales with subentries (trustlines/offers/etc).
  // Formula matches stellarSigner.computeStellarMinReserveXlm; inlined here so
  // this module does not eagerly import stellar-sdk via stellarSigner.
  // A flat 1 XLM reserve under-counts multi-subentry accounts and lets Horizon
  // reject the tx with tx_insufficient_balance.
  const nativeBal = accountData.balances.find((b: any) => b.asset_type === 'native');
  const currentBalance = parseFloat((nativeBal as any)?.balance || '0');
  const sendAmount = parseFloat(params.value);
  const subentryRaw = (accountData as { subentry_count?: unknown }).subentry_count;
  const subentryCount =
    typeof subentryRaw === 'number' && Number.isFinite(subentryRaw)
      ? Math.max(0, Math.floor(subentryRaw))
      : 0;
  const reserveXlm = (2 + subentryCount) * 0.5;
  const feeXlm = 0.01; // matches fee: '100000' stroops below
  const requiredXlm = sendAmount + reserveXlm + feeXlm;
  if (currentBalance < requiredXlm) {
    throw new TransactionError(
      `Insufficient funds. Need ${requiredXlm} XLM (including reserve), have ${currentBalance} XLM.`,
      'INSUFFICIENT_FUNDS'
    );
  }

  const txBuilder = new TransactionBuilder(accountData, {
    fee: '100000',
    networkPassphrase,
  }).addOperation(
    Operation.payment({
      destination: toAddress,
      asset: Asset.native(),
      amount: params.value,
    })
  );

  if (params.memo) {
    txBuilder.addMemo(Memo.text(params.memo));
  }

  const tx = txBuilder.setTimeout(30).build();
  tx.sign(fromKeypair);

  // Submit using the official SDK — this handles XDR encoding and error parsing correctly
  let submitResult: any;
  try {
    submitResult = await withTimeout(server.submitTransaction(tx), 20_000);
  } catch (e: any) {
    // Horizon errors contain a structured response
    const horizonError = e?.response?.data?.extras?.result_codes;
    const detail = horizonError
      ? JSON.stringify(horizonError)
      : e?.message || 'Unknown Horizon submission error';
    throw new TransactionError(`Stellar send failed: ${detail}`, 'NETWORK_ERROR');
  }

  const txHash = submitResult?.hash;
  if (!txHash) {
    throw new TransactionError('Stellar transaction missing hash in response', 'UNKNOWN');
  }

  const gasEstimate: GasEstimate = {
    gasLimit: 0n,
    maxFeePerGas: 100000n,
    maxPriorityFeePerGas: 0n,
    gasPrice: 100000n,
    estimatedCostWei: 100000n,
    estimatedCostEth: '0.00001',
    estimatedCostUsd: ethPrice ? (0.00001 * ethPrice).toFixed(4) : null,
    isStale: false,
    fetchedAt: Date.now(),
  };

  return { hash: txHash, chainId: isTestnet ? 'stellar-testnet' : 'stellar-mainnet', gasEstimate };
}


// ─── Public API ─────────────────────────────────────────────────────────────

/** Checks if a chain is a non-EVM chain that this signer supports. */
export function isNonEvmChain(chainKey: string): boolean {
  return isSupportedNonEvmChain(chainKey);
}

/**
 * Signs and broadcasts a transaction on a non-EVM chain.
 *
 * @param params    - Transaction parameters (to, value, memo)
 * @param chainKey  - Chain to send on (e.g. 'solana', 'aptos', 'stellar')
 * @param ethPrice  - Current ETH price for USD gas estimate (optional)
 * @throws TransactionError on validation, signing, or broadcast failure
 */
export async function signAndSendNonEvmTransaction(
  params: ChainSignerParams,
  chainKey: string,
  ethPrice?: number
): Promise<ChainSignerResult> {
  addBreadcrumb('Non-EVM transaction signing initiated', 'transaction', { chain: chainKey });

  const chainType = getChainType(chainKey);

  if (!sharedValidateAddress(params.to, chainType)) {
    const chainLabel = chainType === 'svm' ? 'Solana' : chainType === 'mvm' ? 'Aptos' : 'Stellar';
    throw new TransactionError(`Invalid ${chainLabel} address: ${params.to}`, 'INVALID_ADDRESS');
  }

  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) {
    throw new TransactionError('No wallet found. Please create or import a wallet first.', 'UNKNOWN');
  }

  try {
    switch (chainType) {
      case 'svm':
        return await sendSolanaTransaction(params, chainKey, mnemonicWords, ethPrice);
      case 'mvm':
        return await sendAptosTransaction(params, chainKey, mnemonicWords, ethPrice);
      case 'xlm':
        return await sendStellarTransaction(params, chainKey, mnemonicWords, ethPrice);
    }
  } catch (error) {
    if (error instanceof TransactionError) throw error;
    const message = (error as any)?.message || `Unknown ${chainType} signing error`;
    captureError(new Error(message), { scope: 'multi-chain-signer', chain: chainKey });
    throw new TransactionError(message, 'UNKNOWN');
  }
}
