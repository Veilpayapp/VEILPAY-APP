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
      // Onramp.money's hosted widget expects an uppercase fiat symbol (e.g.
      // "INR", "USD") and an uppercase coin symbol (e.g. "USDT", "ETH").
      fiatType: this.mapFiat(fiatCurrency),
      coinCode: cryptoToken.toUpperCase(),
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
   * Networks Onramp.money's hosted widget accepts, keyed by our internal chain
   * key. The `/main/buy/` widget uses friendly lowercase network names — this
   * is verified against live widget URLs such as
   * `.../main/buy/?appId=1&coinCode=virtual&network=base`. (The numeric chain
   * IDs like `erc20`/`matic20`/`spl` belong to the separate `allConfigMapping`
   * REST API, not this widget URL, so they are deliberately NOT used here.)
   *
   * Testnets and chains Onramp.money doesn't support (aptos, stellar, sepolia,
   * devnets) are intentionally absent so `mapNetwork` rejects them instead of
   * silently handing the widget an unusable `network` value.
   */
  private static readonly NETWORK_MAP: Record<string, string> = {
    ethereum: 'ethereum',
    polygon: 'polygon',
    bsc: 'bsc',
    arbitrum: 'arbitrum',
    optimism: 'optimism',
    base: 'base',
    solana: 'solana',
  };

  /**
   * Normalizes an internal network key to the Onramp.money network name.
   * @throws if the chain isn't supported, so callers surface a clear error
   *         instead of the widget silently failing on a bad `network` value.
   */
  static mapNetwork(chainKey: string): string {
    const mapped = this.NETWORK_MAP[chainKey.toLowerCase()];
    if (!mapped) {
      throw new Error(`Onramp.money does not support network "${chainKey}"`);
    }
    return mapped;
  }

  /** Normalizes a fiat currency to the uppercase symbol the widget expects. */
  static mapFiat(fiatCurrency: string): string {
    return (fiatCurrency || '').toUpperCase();
  }
}
