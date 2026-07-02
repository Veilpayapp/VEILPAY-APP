import crypto, { timingSafeEqual } from 'crypto';

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
    fiatCurrency?: string;
    cryptoToken?: string;
    chainKey?: string;
    orderId?: string;
  }): string {
    const {
      userAddress,
      fiatAmount,
      fiatCurrency = 'INR',
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
