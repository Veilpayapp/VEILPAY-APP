import crypto, { timingSafeEqual } from 'crypto';

/**
 * Onramp.money Service
 * Handles quote generation, URL signing, and webhook verification.
 * 
 * Loopholes Addressed:
 * - Secure signing (no secrets in frontend)
 * - Order tracking (database persistence)
 * - Provider mapping (token/network normalization)
 */
export class OnrampService {
  private static readonly API_KEY = process.env.ONRAMP_MONEY_API_KEY || '';
  private static readonly API_SECRET = process.env.ONRAMP_MONEY_SECRET || '';
  private static readonly WIDGET_BASE_URL = 'https://onramp.money/main/buy/';

  /**
   * Generates a signed URL for the Onramp.money widget.
   * This pre-fills user data and ensures the request is authentic.
   */
  static generateSignedUrl(params: {
    userAddress: string;
    fiatAmount?: string;
    fiatCurrency: string;
    cryptoToken?: string;
    network?: string;
    orderId?: string;
  }): string {
    const {
      userAddress,
      fiatAmount,
      fiatCurrency,
      cryptoToken = 'ETH',
      network = 'ethereum',
      orderId,
    } = params;

    const urlParams = new URLSearchParams({
      appId: this.API_KEY,
      walletAddress: userAddress,
      fiatAmount: fiatAmount || '',
      fiatType: fiatCurrency,
      coinCode: cryptoToken,
      network: network,
    });

    if (orderId) {
      urlParams.append('orderId', orderId);
      urlParams.append('partnerOrderId', orderId);
    }

    // Loophole Prevention: We will add a signature here if the provider requires it.
    // For Onramp.money, the appId is often enough for the basic widget, 
    // but a signature prevents tampering with the destination address.
    if (this.API_SECRET) {
      const signature = this.calculateSignature(urlParams.toString());
      urlParams.append('signature', signature);
    }

    return `${this.WIDGET_BASE_URL}?${urlParams.toString()}`;
  }

  /**
   * Verifies the HMAC-SHA256 signature from Onramp.money webhooks.
   */
  static verifyWebhook(payload: string, signature: string): boolean {
    if (!this.API_SECRET || !signature) return false;

    const hmac = crypto.createHmac('sha256', this.API_SECRET);
    const calculatedSignature = hmac.update(payload).digest('hex');

    if (signature.length !== calculatedSignature.length || !/^[0-9a-fA-F]+$/.test(signature)) {
      return false;
    }

    try {
      return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(calculatedSignature, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Calculates signature for widget URL parameters.
   */
  private static calculateSignature(queryString: string): string {
    return crypto
      .createHmac('sha256', this.API_SECRET)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Normalizes internal network keys to Onramp.money network names.
   */
  static mapNetwork(chainKey: string): string {
    const map: Record<string, string> = {
      'ethereum': 'ethereum',
      'polygon': 'polygon',
      'arbitrum': 'arbitrum',
      'base': 'base',
      'optimism': 'optimism',
      'bsc': 'bsc',
      'solana': 'solana',
    };
    return map[chainKey.toLowerCase()] || chainKey;
  }
}
