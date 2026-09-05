import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@veilpay_spp_diagnostics_v1';
const MAX_RECORDS = 100;
const MAX_TEXT_LENGTH = 2_000;

export type SppDiagnosticStatus = 'start' | 'success' | 'error' | 'info';

export interface SppDiagnosticRecord {
  id: string;
  timestamp: string;
  status: SppDiagnosticStatus;
  step: string;
  operation?: string;
  chainKey?: string;
  contractId?: string;
  contractFunction?: string;
  code?: string;
  message?: string;
  rawError?: string;
  txHash?: string;
}

export type NewSppDiagnosticRecord = Omit<
  SppDiagnosticRecord,
  'id' | 'timestamp' | 'message' | 'rawError'
> & {
  message?: unknown;
  rawError?: unknown;
};

let writeQueue: Promise<void> = Promise.resolve();

function truncate(value: string): string {
  return value.length > MAX_TEXT_LENGTH
    ? `${value.slice(0, MAX_TEXT_LENGTH)}…`
    : value;
}

/**
 * Diagnostics must never become a second secret store. Keep actionable native
 * error text, while redacting common key material if a lower layer includes it
 * unexpectedly.
 */
export function sanitizeSppDiagnosticText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text =
    value instanceof Error
      ? `${value.name}: ${value.message}`
      : typeof value === 'string'
        ? value
        : (() => {
            try {
              return JSON.stringify(value, (key, entry) =>
                /mnemonic|secret|private.?key|nullifier|blinding|signature/i.test(key)
                  ? '[REDACTED]'
                  : entry
              );
            } catch {
              return String(value);
            }
          })();

  return truncate(
    text.replace(/\b(?:0x)?[a-fA-F0-9]{64,}\b/g, '[REDACTED_HEX]')
  );
}

async function readStoredRecords(): Promise<SppDiagnosticRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECORDS) : [];
  } catch {
    return [];
  }
}

export async function getSppDiagnostics(): Promise<SppDiagnosticRecord[]> {
  await writeQueue.catch(() => undefined);
  return readStoredRecords();
}

export function recordSppDiagnostic(
  input: NewSppDiagnosticRecord
): Promise<void> {
  const record: SppDiagnosticRecord = {
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    message: sanitizeSppDiagnosticText(input.message),
    rawError: sanitizeSppDiagnosticText(input.rawError),
  };

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const existing = await readStoredRecords();
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([record, ...existing].slice(0, MAX_RECORDS))
      );
    })
    // Diagnostics are best-effort and must never break a payment path.
    .catch(() => undefined);

  return writeQueue;
}

export async function clearSppDiagnostics(): Promise<void> {
  await writeQueue.catch(() => undefined);
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
}

/**
 * Map a chain key to a human network label for diagnostics.
 * Keeps the raw chain key on the record while rendering TESTNET/MAINNET.
 */
export function sppNetworkLabelFromChainKey(
  chainKey?: string | null
): string | undefined {
  if (!chainKey) return undefined;
  if (chainKey === 'stellar-testnet') return 'TESTNET';
  if (chainKey === 'stellar') return 'MAINNET';
  return chainKey.toUpperCase();
}

export async function exportSppDiagnostics(networkLabel?: string): Promise<string> {
  const records = await getSppDiagnostics();
  return [
    'Veilpay SPP diagnostics',
    `Exported: ${new Date().toISOString()}`,
    `Network: ${networkLabel ?? 'unknown'}`,
    '',
    ...records.map((record) => JSON.stringify(record)),
  ].join('\n');
}

export async function runWithSppDiagnostics<T>(
  context: Omit<NewSppDiagnosticRecord, 'status' | 'message' | 'rawError' | 'txHash'>,
  action: () => Promise<T>
): Promise<T> {
  await recordSppDiagnostic({ ...context, status: 'start' });
  try {
    const result = await action();
    const txHash =
      result && typeof result === 'object' && 'txHash' in result
        ? String((result as { txHash?: unknown }).txHash || '') || undefined
        : undefined;
    await recordSppDiagnostic({ ...context, status: 'success', txHash });
    return result;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '') || undefined
        : undefined;
    await recordSppDiagnostic({
      ...context,
      status: 'error',
      code,
      message: error instanceof Error ? error.message : String(error),
      rawError: error,
    });
    throw error;
  }
}
