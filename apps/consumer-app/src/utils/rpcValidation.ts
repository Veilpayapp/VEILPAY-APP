/**
 * RPC Response Validation and Production Config Enforcement
 *
 * Implements SEC-005 (RPC endpoint fallback to public node) and
 * SEC-008 (chain ID validation on RPC responses).
 *
 * SEC-005: Require explicit RPC configuration in production
 * - In production, if EXPO_PUBLIC_BACKEND_BASE_URL is not set, throw an error
 *   instead of silently degrading to public nodes.
 * - Public fallback nodes can be MITM'd; we must not use them in production
 *   without explicit operator consent.
 *
 * SEC-008: Validate chainId in RPC responses
 * - Responses from `eth_chainId`, `net_version`, or any response that includes
 *   a chainId field must be validated against the expected chain.
 * - Attacker could return data from a different chain (e.g., return mainnet
 *   data when requesting from sepolia).
 * - We wrap RPC calls and validate chainId before returning results.
 */

import { PublicClient } from 'viem';
import { captureError } from './sentry';
import { NETWORKS } from './transactions';

export type Hex = `0x${string}`;

/**
 * Error thrown when RPC validation fails.
 */
export class RpcValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'RPC_CONFIG_MISSING'
      | 'RPC_CHAIN_ID_MISMATCH'
      | 'RPC_RESPONSE_INVALID'
      | 'RPC_VALIDATION_SKIPPED'
  ) {
    super(message);
    this.name = 'RpcValidationError';
  }
}

/**
 * Validate production RPC configuration.
 *
 * SEC-005: In production builds, require explicit backend RPC configuration.
 * If the backend base URL is not set, throw an error instead of silently
 * degrading to public nodes (which can be MITM'd).
 *
 * @throws RpcValidationError if production build lacks RPC configuration
 */
export function validateProductionRpcConfig(): void {
  if (process.env.NODE_ENV !== 'production') {
    return; // Development: allow public fallbacks
  }

  const backendBase = process.env.EXPO_PUBLIC_BACKEND_BASE_URL?.trim();
  if (!backendBase) {
    const err = new RpcValidationError(
      'Production build requires EXPO_PUBLIC_BACKEND_BASE_URL to be set. ' +
        'Public RPC endpoints are not allowed in production without explicit configuration. ' +
        'Configure the backend RPC proxy URL in your build environment.',
      'RPC_CONFIG_MISSING'
    );
    captureError(err, {
      scope: 'rpc-validation',
      operation: 'production-config-check',
      environment: process.env.NODE_ENV,
    });
    throw err;
  }
}

/**
 * Get expected chain ID for a given chain key.
 *
 * Returns the NETWORKS[chainKey].chainId or null if chain not found.
 *
 * @param chainKey The chain identifier (e.g., 'ethereum', 'sepolia')
 * @returns The expected chain ID (number) or null
 */
export function getExpectedChainId(chainKey: string): number | null {
  const network = NETWORKS[chainKey];
  return network?.chainId ?? null;
}

/**
 * Parse chain ID from various RPC response formats.
 *
 * Different RPC methods return chainId in different formats:
 *   - `eth_chainId`: returns 0x-prefixed hex string (e.g., "0x1")
 *   - `net_version`: returns decimal string (e.g., "1")
 *   - Ethereum JSON-RPC 2.0 responses: sometimes include chain_id or chainId
 *
 * This function normalizes all formats to a number.
 *
 * @param value The chain ID value from RPC response
 * @returns The chain ID as a number, or null if parsing fails
 */
export function parseChainId(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    try {
      // Try parsing as hex (0x-prefixed)
      if (value.startsWith('0x')) {
        return parseInt(value, 16);
      }
      // Try parsing as decimal
      return parseInt(value, 10);
    } catch {
      return null;
    }
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  return null;
}

/**
 * Validate that a chain ID from an RPC response matches the expected chain.
 *
 * SEC-008: Before accepting an RPC response, validate that the chainId
 * in the response matches the chainId we expect for this chain. This
 * prevents MITM attacks where an attacker returns data from a different
 * chain (e.g., mainnet data when we requested testnet).
 *
 * Usage in RPC wrapper:
 *   const response = await rpc.getChainId();
 *   validateChainIdMatch(chainKey, response);
 *   // Or, for responses with embedded chainId:
 *   validateChainIdMatch(chainKey, response.chainId);
 *
 * @param chainKey The chain identifier
 * @param responseChainId The chain ID from the RPC response (can be hex string, decimal string, or number)
 * @throws RpcValidationError if chain ID does not match
 */
export function validateChainIdMatch(
  chainKey: string,
  responseChainId: unknown
): void {
  const expectedChainId = getExpectedChainId(chainKey);

  if (expectedChainId === null) {
    const err = new RpcValidationError(
      `Unknown chain: ${chainKey}. Cannot validate chain ID.`,
      'RPC_VALIDATION_SKIPPED'
    );
    captureError(err, {
      scope: 'rpc-validation',
      operation: 'chain-id-validation',
      chainKey,
    });
    throw err;
  }

  const parsedChainId = parseChainId(responseChainId);

  if (parsedChainId === null) {
    const err = new RpcValidationError(
      `RPC response chain ID is unparseable: ${String(responseChainId)}. ` +
        `Expected ${expectedChainId} for chain ${chainKey}.`,
      'RPC_RESPONSE_INVALID'
    );
    captureError(err, {
      scope: 'rpc-validation',
      operation: 'chain-id-validation',
      chainKey,
      expectedChainId,
      responseChainId: String(responseChainId),
    });
    throw err;
  }

  if (parsedChainId !== expectedChainId) {
    const err = new RpcValidationError(
      `Chain ID mismatch: RPC returned ${parsedChainId} but expected ` +
        `${expectedChainId} for chain ${chainKey}. ` +
        `This may indicate a MITM attack or misconfigured RPC endpoint. ` +
        `Do not proceed with this transaction.`,
      'RPC_CHAIN_ID_MISMATCH'
    );
    captureError(err, {
      scope: 'rpc-validation',
      operation: 'chain-id-validation',
      chainKey,
      expectedChainId,
      responseChainId: parsedChainId,
    });
    throw err;
  }
}

/**
 * Wrapper for RPC calls that adds chain ID validation.
 *
 * SEC-008: Before returning an RPC result, extract and validate the chainId
 * if present. For calls that explicitly return chainId, we validate it.
 * For other calls, callers should validate chainId independently if needed.
 *
 * Usage:
 *   const result = await withChainIdValidation(
 *     chainKey,
 *     () => publicClient.getChainId()
 *   );
 *   // Result is validated to match expected chain
 *
 * @param chainKey The chain identifier
 * @param fn The RPC call function
 * @returns The RPC result
 * @throws RpcValidationError if chain ID validation fails
 */
export async function withChainIdValidation<T>(
  chainKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const result = await fn();

  // For responses that are just a number (from getChainId), validate directly
  if (typeof result === 'number') {
    validateChainIdMatch(chainKey, result);
    return result;
  }

  // For object responses, look for chainId field and validate if present
  if (result && typeof result === 'object') {
    const obj = result as Record<string, any>;
    if ('chainId' in obj && obj.chainId !== undefined) {
      validateChainIdMatch(chainKey, obj.chainId);
    }
  }

  return result;
}

/**
 * Log an RPC call for debugging and monitoring.
 *
 * Logs the chain key, method name (if available), and outcome.
 * Does NOT log sensitive data (private keys, mnemonic, nullifier, secret).
 *
 * @param chainKey The chain identifier
 * @param operation A description of the RPC operation
 * @param outcome 'success' or 'failure'
 * @param details Optional additional details (errors, response size, etc.)
 */
export function logRpcCall(
  chainKey: string,
  operation: string,
  outcome: 'success' | 'failure',
  details?: Record<string, unknown>
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    chainKey,
    operation,
    outcome,
    ...details,
  };

  if (outcome === 'failure') {
    console.error('[rpc-validation]', logEntry);
  } else {
    console.log('[rpc-validation]', logEntry);
  }
}

/**
 * Initialize RPC validation at app startup.
 *
 * Called once when the app launches. In production, validates that RPC
 * configuration is set. Throws if misconfigured.
 *
 * @throws RpcValidationError if production RPC configuration is missing
 */
export function initializeRpcValidation(): void {
  try {
    validateProductionRpcConfig();
    console.log('[rpc-validation] Production RPC configuration validated');
  } catch (e) {
    console.error('[rpc-validation] RPC configuration validation failed:', e);
    throw e;
  }
}
