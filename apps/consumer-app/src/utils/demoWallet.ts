import { Wallet } from 'ethers';

export function createDemoEvmAddress(): string {
  return Wallet.createRandom().address;
}
