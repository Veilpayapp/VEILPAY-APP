import crypto, { timingSafeEqual } from 'crypto';

/** Abort deadline for MoonPay status lookups (matches Horizon/GoldRush D4). */
const MOONPAY_FETCH_TIMEOUT_MS = 10_000;
const MOONPAY_API_BASE_URL = 'https://api.moonpay.com/v1';

/**
 * MoonPay Service
 * Handles widget URL generation, signing, and webhook verification.
 */
export class MoonPayService {
  private static readonly API_KEY = process.env.EXPO_PUBLIC_MOONPAY_API_KEY || '';
  private static readonly API_SECRET = process.env.MOONPAY_SECRET_KEY || '';
  private static readonly WIDGET_BASE_URL = 'https://buy.moonpay.com';

  /**
   * Generates a signed URL for the MoonPay widget.
   */
  static generateSignedUrl(params: {
    userAddress: string;
    fiatAmount?: string;
    fiatCurrency: string;
    cryptoToken?: string;
    chainKey?: string;
    orderId?: string;
  }): string {
    const {
      userAddress,
      fiatAmount,
      fiatCurrency,
      cryptoToken = 'ETH',
      chainKey = 'ethereum',
      orderId,
    } = params;

    // MoonPay requires the network to be appended to the token code if it's not Ethereum mainnet
    // e.g. USDC on Polygon is 'usdc_polygon'. ETH on Arbitrum is 'eth_arbitrum'.
    let moonpayCurrencyCode = cryptoToken.toLowerCase();
    const normalizedChain = chainKey.toLowerCase();
    
    if (normalizedChain !== 'ethereum' && normalizedChain !== 'mainnet') {
      moonpayCurrencyCode = `${moonpayCurrencyCode}_${normalizedChain}`;
    }

    const urlParams = new URLSearchParams({
      apiKey: this.API_KEY,
      walletAddress: userAddress,
      baseCurrencyCode: fiatCurrency.toLowerCase(),
      currencyCode: moonpayCurrencyCode,
    });

    if (fiatAmount) {
      urlParams.append('baseCurrencyAmount', fiatAmount);
    }

    if (orderId) {
      urlParams.append('externalTransactionId', orderId);
    }

    const originalUrl = `${this.WIDGET_BASE_URL}?${urlParams.toString()}`;

    // MoonPay requires signing the query string starting with `?`
    if (this.API_SECRET) {
      const signature = crypto
        .createHmac('sha256', this.API_SECRET)
        .update(`?${urlParams.toString()}`)
        .digest('base64');
      
      return `${originalUrl}&signature=${encodeURIComponent(signature)}`;
    }

    return originalUrl;
  }

  /**
   * Normalizes a MoonPay transaction status into the vocabulary understood by
   * the shared FiatOrderStatus mapping.
   *
   * MoonPay emits several in-progress states — `pending`, `waitingPayment`,
   * `waitingAuthorization` — that are NOT failures. Without this mapping they
   * fall through the status mapping chain to `'failed'`, which is a terminal
   * state, so the first in-progress event would permanently mark a live
   * order failed and the later `completed` event would be ignored by the
   * terminal-state guard. We map those to `'processing'` so the order stays
   * open until a genuine terminal event (`completed` / `failed` /
   * `refunded*`) arrives.
   *
   * Used by both the webhook handler and the status-polling fallback.
   */
  static normalizeStatus(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    switch (raw) {
      case 'waitingPayment':
      case 'waitingAuthorization':
      case 'pending':
        return 'processing';
      default:
        // 'completed', 'failed', 'refunded', 'refunded_card_payment' pass
        // through unchanged; the shared mapping decides what they mean.
        return raw;
    }
  }

  /**
   * Fetches a transaction's current status from MoonPay's server-to-server
   * transactions API by our `externalTransactionId` (the order UUID we
   * appended to the widget URL). Fail-closed: any non-200, network error,
   * abort timeout, or unexpected body shape returns null and the caller
   * leaves the order untouched.
   *
   * Status-polling fallback only — never called from request handlers.
   */
  static async fetchTransactionStatus(
    externalTransactionId: string,
  ): Promise<{ status: string } | null> {
    if (!this.API_SECRET || !externalTransactionId) return null;

    try {
      const res = await fetch(
        `${MOONPAY_API_BASE_URL}/transactions?externalTransactionId=${encodeURIComponent(
          externalTransactionId,
        )}`,
        {
          headers: { Authorization: `Bearer ${this.API_SECRET}` },
          signal: AbortSignal.timeout(MOONPAY_FETCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) return null;

      // The list endpoint returns an array; tolerate a single object too.
      const data: unknown = await res.json();
      const tx = Array.isArray(data) ? data[0] : data;
      if (tx === null || typeof tx !== 'object') return null;
      const status = (tx as { status?: unknown }).status;
      return typeof status === 'string' && status.length > 0 ? { status } : null;
    } catch {
      // Includes the abort timeout (TimeoutError) — fail closed.
      return null;
    }
  }

  /**
   * Verifies the MoonPay webhook signature.
   */
  static verifyWebhook(payload: string, signature: string): boolean {
    if (!this.API_SECRET || !signature) return false;

    try {
      const parts = signature.split(',');
      let timestamp = '';
      let sig = '';

      for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === 't') timestamp = value;
        if (key === 's') sig = value;
      }

      if (!timestamp || !sig) return false;

      const signedPayload = `${timestamp}.${payload}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.API_SECRET)
        .update(signedPayload)
        .digest('hex');

      return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSignature, 'hex'));
    } catch {
      return false;
    }
  }
}
