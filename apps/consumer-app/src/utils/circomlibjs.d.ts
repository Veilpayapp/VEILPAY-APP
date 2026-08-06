/**
 * Type declarations for circomlibjs
 * Provides Poseidon hash function for nullifier validation
 */

declare module 'circomlibjs' {
  export interface Poseidon {
    (inputs: bigint[]): bigint;
  }

  export function buildPoseidon(): Promise<Poseidon>;
}
