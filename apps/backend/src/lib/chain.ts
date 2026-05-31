import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import { config } from '../config';

const rpcUrl = config.nodeEnv === 'production' 
  ? `https://eth-mainnet.g.alchemy.com/v2/${config.rpc.alchemyApiKey}`
  : `https://eth-sepolia.g.alchemy.com/v2/${config.rpc.alchemyApiKey}`;

const chain = config.nodeEnv === 'production' ? mainnet : sepolia;

export const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl)
});

// We only instantiate the wallet client if the private key exists
export const account = config.relayerPrivateKey 
  ? privateKeyToAccount(config.relayerPrivateKey as `0x${string}`) 
  : null;

export const walletClient = account ? createWalletClient({
  account,
  chain,
  transport: http(rpcUrl)
}) : null;
