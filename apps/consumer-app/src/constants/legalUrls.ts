/**
 * Official VeilPay web properties opened from Settings (in-app browser).
 * Keep hosts in sync with `utils/externalLink` allowlist and InAppBrowser allowlist.
 */
export const LEGAL_URLS = {
  privacy: 'https://www.veilpayapp.com/privacy',
  terms: 'https://www.veilpayapp.com/terms',
  docs: 'https://www.veilpayapp.com/docs',
} as const;

export type LegalUrlKey = keyof typeof LEGAL_URLS;

/** Hosts allowed for the in-app legal/docs WebView (same product surface as fiat shell). */
export const VEILPAY_WEB_HOSTS = ['veilpayapp.com', 'www.veilpayapp.com', 'veilpay.app', 'www.veilpay.app'] as const;

export function isVeilpayWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return VEILPAY_WEB_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}
