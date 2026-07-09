/**
 * Aptos (MVM) Transaction Signer
 * Signs and submits APT transfers using the stored mnemonic.
 *
 * Derivation MUST stay in lockstep with `multiChainDerivation.ts`
 * (`m/44'/637'/0'/0'/0'`) — that is the address shown to the user for
 * receive. A wrong coin type (e.g. the old `634`) would sign from a
 * different key than the displayed balance address, so funds received
 * on-screen would be unspendable via this path.
 */

import { Aptos, AptosConfig, Network, Account } from '@aptos-labs/ts-sdk';
import { getStoredMnemonic, TransactionError, NETWORKS } from './transactions';
import { captureError, addBreadcrumb } from './sentry';
import type { SignerParams, SignerResult } from './secureSigner';
import type { GasEstimate } from './gasEstimator';
import { getRpcUrl } from './rpc';
import { validateAddress } from './validation';

/** BIP-44 coin type 637 = Aptos (SLIP-0044). Keep in sync with multiChainDerivation. */
export const APTOS_DERIVATION_PATH = "m/44'/637'/0'/0'/0'";

/** Conservative gas ceiling in octas used for the pre-submit funds check. */
const APTOS_ESTIMATED_GAS_OCTAS = 200_000n;
const APTOS_DECIMALS = 8;
const APTOS_MULTIPLIER = 10 ** APTOS_DECIMALS;

/**
 * Convert a human-readable APT amount string to octas.
 * Rejects scientific notation, commas, negatives, and non-numeric junk that
 * `parseFloat` would silently accept or truncate.
 */
export function parseAptosAmountToOctas(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new TransactionError(`Invalid APT amount: ${value}`, 'UNKNOWN');
  }
  const [whole, frac = ''] = trimmed.split('.');
  const padded = frac.padEnd(APTOS_DECIMALS, '0').slice(0, APTOS_DECIMALS);
  const octas = BigInt(whole + padded);
  if (octas <= 0n) {
    throw new TransactionError('Transaction value must be greater than zero', 'UNKNOWN');
  }
  return octas;
}

export async function signAndSendAptosTransaction(
  params: SignerParams,
  chainKey: string,
  ethPrice?: number
): Promise<SignerResult> {
  addBreadcrumb('Aptos transaction signing initiated', 'transaction', { chain: chainKey });

  const network = NETWORKS[chainKey];
  if (!network || network.symbol !== 'APT') {
    throw new TransactionError(`Unsupported Aptos network: ${chainKey}.`, 'UNKNOWN');
  }

  const toAddress = params.to.trim();
  if (!validateAddress(toAddress, 'mvm')) {
    throw new TransactionError(`Invalid Aptos address: ${toAddress}`, 'INVALID_ADDRESS');
  }

  const amountOctas = parseAptosAmountToOctas(params.value);

  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) {
    throw new TransactionError('No wallet found. Please create or import a wallet first.', 'UNKNOWN');
  }

  let txResult: SignerResult;
  try {
    const mnemonicPhrase = mnemonicWords.join(' ');
    const account = Account.fromDerivationPath({
      path: APTOS_DERIVATION_PATH,
      mnemonic: mnemonicPhrase,
    });

    const rpcUrl = getRpcUrl(chainKey);
    let aptosNetwork = Network.MAINNET;
    if (chainKey.includes('testnet')) aptosNetwork = Network.TESTNET;
    else if (chainKey.includes('devnet')) aptosNetwork = Network.DEVNET;

    const aptosConfig = new AptosConfig({ network: aptosNetwork, fullnode: rpcUrl });
    const aptos = new Aptos(aptosConfig);

    // Pre-submit funds gate so we fail with INSUFFICIENT_FUNDS instead of a
    // generic RPC simulation error. Gas is an estimate; the node remains the
    // final authority.
    let balanceOctas = 0n;
    try {
      balanceOctas = BigInt(
        await aptos.getAccountAPTAmount({ accountAddress: account.accountAddress })
      );
    } catch {
      // Unfunded / missing account → treat as zero so the gate still fires.
      balanceOctas = 0n;
    }
    const requiredOctas = amountOctas + APTOS_ESTIMATED_GAS_OCTAS;
    if (balanceOctas < requiredOctas) {
      const balanceApt = Number(balanceOctas) / APTOS_MULTIPLIER;
      const requiredApt = Number(requiredOctas) / APTOS_MULTIPLIER;
      throw new TransactionError(
        `Insufficient APT. Balance: ${balanceApt} APT, required: ~${requiredApt} APT (incl. gas)`,
        'INSUFFICIENT_FUNDS'
      );
    }

    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: '0x1::aptos_account::transfer',
        functionArguments: [toAddress, amountOctas],
      },
    });

    const senderAuthenticator = aptos.transaction.sign({
      signer: account,
      transaction,
    });

    const pendingTransaction = await aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator,
    });

    await aptos.waitForTransaction({ transactionHash: pendingTransaction.hash });

    const signature = pendingTransaction.hash;
    const estimatedCostEth = (Number(APTOS_ESTIMATED_GAS_OCTAS) / APTOS_MULTIPLIER).toString();

    const gasEstimate: GasEstimate = {
      gasLimit: 2000n,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 0n,
      gasPrice: 100n,
      estimatedCostWei: APTOS_ESTIMATED_GAS_OCTAS,
      estimatedCostEth,
      estimatedCostUsd: ethPrice
        ? ((Number(APTOS_ESTIMATED_GAS_OCTAS) / APTOS_MULTIPLIER) * ethPrice).toFixed(4)
        : null,
      isStale: false,
      fetchedAt: Date.now(),
    };

    txResult = {
      hash: signature,
      chainId: network.chainId,
      gasEstimate,
    };

    addBreadcrumb('Aptos transaction broadcast successful', 'transaction', {
      chain: chainKey,
      txHash: signature,
    });
  } catch (err) {
    if (err instanceof TransactionError) throw err;
    const message = (err as any)?.message || 'Unknown signing error';
    captureError(new Error(message), { scope: 'aptos-signer', chain: chainKey });
    throw new TransactionError(message, 'UNKNOWN');
  }

  return txResult;
}
