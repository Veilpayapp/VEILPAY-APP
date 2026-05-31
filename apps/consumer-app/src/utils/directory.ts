import { captureError } from "./sentry";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:3001';

export interface PublicMerchant {
  id: string;
  businessName: string;
  status: string;
  viewingKeys: { chainKey: string; viewingKey: string }[];
}

/**
 * Fetches the recipient's public key (viewing key) from the Veilpay Directory.
 * This is used for Zero-Knowledge stealth addresses and Note Encryption.
 * 
 * @param merchantId The UUID of the merchant
 * @param chainKey The chain identifier (e.g. 'ethereum', 'polygon', 'solana')
 * @returns The matching viewing key as a hex string or null if not found
 */
export async function fetchRecipientPublicKey(merchantId: string, chainKey: string): Promise<string | null> {
  // If the identifier isn't a valid UUID, we skip the directory lookup
  // In Phase 6.5+, this could be expanded to resolve ENS or Veilpay handles
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(merchantId)) {
    return null;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/directory/${merchantId}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Directory lookup failed with status ${res.status}`);
    }
    const data: PublicMerchant = await res.json();
    if (data.status !== 'active') {
      console.warn(`[Directory] Merchant ${merchantId} is not active`);
      return null;
    }
    
    const key = data.viewingKeys.find((k) => k.chainKey === chainKey);
    return key ? key.viewingKey : null;
  } catch (error) {
    captureError(error instanceof Error ? error : new Error(String(error)), { scope: 'directory', merchantId, chainKey });
    console.error('[Directory] Error fetching public key:', error);
    return null;
  }
}
