import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export function createDemoEvmAddress(): string {
  return privateKeyToAccount(generatePrivateKey()).address;
}
