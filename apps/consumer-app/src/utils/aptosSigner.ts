import { Aptos, AptosConfig, Network, Account } from '@aptos-labs/ts-sdk';
import { getStoredMnemonic, TransactionError, NETWORKS } from './transactions';
import { captureError, addBreadcrumb } from './sentry';
import type { SignerParams, SignerResult } from './secureSigner';
import type { GasEstimate } from './gasEstimator';
import { getRpcUrl } from './rpc';

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

  // Parse value to Octas (Aptos decimals = 8)
  const amountOctas = BigInt(Math.floor(parseFloat(params.value) * 1e8));
  if (amountOctas <= 0n) {
    throw new TransactionError('Transaction value must be greater than zero', 'UNKNOWN');
  }

  const mnemonicWords = await getStoredMnemonic();
  if (!mnemonicWords || mnemonicWords.length === 0) {
    throw new TransactionError('No wallet found. Please create or import a wallet first.', 'UNKNOWN');
  }

  let txResult: SignerResult;
  try {
    const mnemonicPhrase = mnemonicWords.join(' ');
    const account = Account.fromDerivationPath({ path: "m/44'/634'/0'/0'/0'", mnemonic: mnemonicPhrase });

    const rpcUrl = getRpcUrl(chainKey);
    // Determine the AptosNetwork enum
    let aptosNetwork = Network.MAINNET;
    if (chainKey.includes('testnet')) aptosNetwork = Network.TESTNET;
    else if (chainKey.includes('devnet')) aptosNetwork = Network.DEVNET;

    const aptosConfig = new AptosConfig({ network: aptosNetwork, fullnode: rpcUrl });
    const aptos = new Aptos(aptosConfig);

    // Build the simple transfer transaction
    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: '0x1::aptos_account::transfer',
        functionArguments: [params.to, amountOctas],
      },
    });

    // Sign the transaction
    const senderAuthenticator = aptos.transaction.sign({
      signer: account,
      transaction,
    });

    // Submit the transaction
    const pendingTransaction = await aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator,
    });

    // Wait for the transaction to be processed (optional but good for getting gas used)
    const executedTransaction = await aptos.waitForTransaction({ transactionHash: pendingTransaction.hash });
    
    // We can also just use the submitted hash immediately
    const signature = pendingTransaction.hash;

    const estimatedCostWei = 200000n; // mock fallback
    const estimatedCostEth = '0.0002'; // mock fallback

    const gasEstimate: GasEstimate = {
      gasLimit: 2000n,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 0n,
      gasPrice: 100n,
      estimatedCostWei,
      estimatedCostEth,
      estimatedCostUsd: ethPrice ? (0.0002 * ethPrice).toFixed(4) : null,
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
