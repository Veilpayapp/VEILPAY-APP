/**
 * Transak Integration Helper
 * Shared utilities for Transak on-ramp and off-ramp flows
 *
 * KYC / Compliance Note:
 *  Transak is a fully regulated fiat-to-crypto on-ramp / off-ramp provider.
 *  They handle all KYC/AML verification, regulatory compliance, and
 *  prevent access from restricted jurisdictions — so Veilpay does NOT
 *  need to collect or store any identity documents.
 *
 *  Relevant Transak docs:
 *   - KYC requirements: https://docs.transak.com/docs/kyc-verification
 *   - Embed guide:      https://docs.transak.com/docs/query-parameters
 *   - Webhooks:         https://docs.transak.com/docs/webhooks
 */

import Constants from 'expo-constants';

// ---------------------------------------------------------------------------
// Environment / Config
// ---------------------------------------------------------------------------

/** Pull API key from Expo public env var. Defaults to empty string. */
const TRANSAK_API_KEY: string =
  (Constants.expoConfig?.extra?.transakApiKey as string) ??
  process.env.EXPO_PUBLIC_TRANSAK_API_KEY ??
  '';

/** Use STAGING for dev, PRODUCTION for prod. */
const TRANSAK_ENV: 'STAGING' | 'PRODUCTION' =
  (process.env.EXPO_PUBLIC_TRANSAK_ENV as 'STAGING' | 'PRODUCTION') ?? 'STAGING';

/** Domain Transak expects for widget referrer validation. */
const TRANSAK_REFERRER_DOMAIN: string =
  (Constants.expoConfig?.extra?.transakReferrerDomain as string) ??
  process.env.EXPO_PUBLIC_TRANSAK_REFERRER_DOMAIN ??
  'veilpay.app';

/** Base URL changes depending on environment */
const TRANSAK_BASE_URLS = {
  STAGING: 'https://global-stg.transak.com',
  PRODUCTION: 'https://global.transak.com',
};

const TRANSAK_PRICING_BASE_URLS = {
  STAGING: 'https://api-stg.transak.com',
  PRODUCTION: 'https://api.transak.com',
};

export function getTransakBaseUrl(): string {
  return TRANSAK_BASE_URLS[TRANSAK_ENV];
}

export function getTransakApiKey(): string {
  return TRANSAK_API_KEY;
}

export function getTransakPricingBaseUrl(): string {
  return TRANSAK_PRICING_BASE_URLS[TRANSAK_ENV];
}

export function getTransakReferrerDomain(): string {
  return TRANSAK_REFERRER_DOMAIN;
}

export function isTransakConfigured(): boolean {
  return (
    TRANSAK_API_KEY.length > 0 &&
    TRANSAK_API_KEY !== 'YOUR_TRANSAK_API_KEY_HERE' &&
    TRANSAK_REFERRER_DOMAIN.length > 0
  );
}

export function getTransakConfigurationErrorMessage(): string {
  return 'Buy / sell is not configured in this build yet.';
}

// ---------------------------------------------------------------------------
// Supported values
// ---------------------------------------------------------------------------

export const FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'JPY'] as const;
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export const QUICK_AMOUNTS = [50, 100, 200] as const;

export const PAYMENT_METHODS = [
  { id: 'credit_debit_card', label: 'Credit/Debit Card', icon: 'card' as const },
  { id: 'google_pay', label: 'Google Pay', icon: 'globe' as const },
  { id: 'upi_qr', label: 'UPI (India)', icon: 'link' as const },
  { id: 'paytm', label: 'PayTM (India)', icon: 'wallet' as const },
  { id: 'neft_rtgs', label: 'Bank Transfer', icon: 'document' as const },
] as const;
export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]['id'];

export const PAYOUT_METHODS = [
  { id: 'neft_rtgs', label: 'Bank Transfer', icon: 'document' as const },
  { id: 'upi_qr', label: 'UPI (India)', icon: 'link' as const },
  { id: 'paytm', label: 'PayTM (India)', icon: 'wallet' as const },
] as const;
export type PayoutMethodId = (typeof PAYOUT_METHODS)[number]['id'];

export const CRYPTO_TOKENS = [
  // ── Ethereum ──────────────────────────────────────────────────────────────
  { symbol: 'ETH',  name: 'Ethereum',          network: 'ethereum',  group: 'Ethereum' },
  { symbol: 'USDT', name: 'USDT',              network: 'ethereum',  group: 'Ethereum' },
  { symbol: 'USDC', name: 'USDC',              network: 'ethereum',  group: 'Ethereum' },
  // ── Polygon ───────────────────────────────────────────────────────────────
  { symbol: 'MATIC', name: 'Polygon',           network: 'polygon',   group: 'Polygon' },
  { symbol: 'USDT',  name: 'USDT (Polygon)',    network: 'polygon',   group: 'Polygon' },
  { symbol: 'USDC',  name: 'USDC (Polygon)',    network: 'polygon',   group: 'Polygon' },
  // ── Arbitrum ──────────────────────────────────────────────────────────────
  { symbol: 'ETH',  name: 'ETH (Arbitrum)',     network: 'arbitrum',  group: 'Arbitrum' },
  { symbol: 'USDT', name: 'USDT (Arbitrum)',    network: 'arbitrum',  group: 'Arbitrum' },
  { symbol: 'USDC', name: 'USDC (Arbitrum)',    network: 'arbitrum',  group: 'Arbitrum' },
  // ── Solana ────────────────────────────────────────────────────────────────
  { symbol: 'SOL',  name: 'Solana',             network: 'solana',    group: 'Solana' },
  { symbol: 'USDT', name: 'USDT (Solana)',      network: 'solana',    group: 'Solana' },
  { symbol: 'USDC', name: 'USDC (Solana)',      network: 'solana',    group: 'Solana' },
  // ── BNB Smart Chain ───────────────────────────────────────────────────────
  { symbol: 'BNB',  name: 'BNB',                network: 'bsc',       group: 'BNB Chain' },
  { symbol: 'USDT', name: 'USDT (BSC)',         network: 'bsc',       group: 'BNB Chain' },
  { symbol: 'USDC', name: 'USDC (BSC)',         network: 'bsc',       group: 'BNB Chain' },
  // ── Avalanche ─────────────────────────────────────────────────────────────
  { symbol: 'AVAX', name: 'Avalanche',          network: 'avalanche', group: 'Avalanche' },
  { symbol: 'USDT', name: 'USDT (Avalanche)',   network: 'avalanche', group: 'Avalanche' },
  { symbol: 'USDC', name: 'USDC (Avalanche)',   network: 'avalanche', group: 'Avalanche' },
  // ── Base ──────────────────────────────────────────────────────────────────
  { symbol: 'ETH',  name: 'ETH (Base)',         network: 'base',      group: 'Base' },
  { symbol: 'USDT', name: 'USDT (Base)',        network: 'base',      group: 'Base' },
  { symbol: 'USDC', name: 'USDC (Base)',        network: 'base',      group: 'Base' },
  // ── Tron ──────────────────────────────────────────────────────────────────
  { symbol: 'TRX',  name: 'Tron',               network: 'tron',      group: 'Tron' },
  { symbol: 'USDT', name: 'USDT (Tron)',        network: 'tron',      group: 'Tron' },
] as const;
export type CryptoToken = (typeof CRYPTO_TOKENS)[number];

/**
 * Maps Veilpay chain keys to Transak network identifiers.
 * Used to filter the CRYPTO_TOKENS list by active chain.
 */
export const TRANSAK_NETWORK_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  sepolia: 'ethereum',    // Transak doesn't support testnet, map to mainnet
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  solana: 'solana',
  'solana-devnet': 'solana',
  // aptos intentionally omitted — Transak does not support Aptos
  bsc: 'bsc',
  avalanche: 'avalanche',
  base: 'base',
};

/** Get tokens available for the given Veilpay chain key */
export function getTokensForChain(chainKey: string): CryptoToken[] {
  const transakNetwork = TRANSAK_NETWORK_MAP[chainKey];
  if (!transakNetwork) return [...CRYPTO_TOKENS]; // fallback: show all
  return CRYPTO_TOKENS.filter((t) => t.network === transakNetwork);
}

/** Get unique network groups from a token list */
export function getTokenGroups(tokens: readonly CryptoToken[]): string[] {
  return [...new Set(tokens.map((t) => t.group))];
}

// ---------------------------------------------------------------------------
// Fee calculation
// ---------------------------------------------------------------------------

export interface FeeBreakdown {
  networkFee: number;
  transakFee: number;
  transakFeePercent: number;
  total: number;
}

const TRANSAK_FEE_PERCENT = 1.5;
const NETWORK_FEE_BASE_USD = 2.5;

/** Rough conversion rates for fallback estimations when live FX is unavailable */
export const USD_TO_FIAT: Record<FiatCurrency, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.5,
  AUD: 1.55,
  CAD: 1.37,
  JPY: 157.0,
};

export function calculateDepositFees(fiatAmount: number, currency: FiatCurrency = 'USD'): FeeBreakdown {
  const transakFee = (fiatAmount * TRANSAK_FEE_PERCENT) / 100;
  const networkFee = NETWORK_FEE_BASE_USD * USD_TO_FIAT[currency];
  return {
    networkFee,
    transakFee,
    transakFeePercent: TRANSAK_FEE_PERCENT,
    total: transakFee + networkFee
  };
}

export function calculateWithdrawalFees(cryptoAmount: number, cryptoPriceUsd: number, currency: FiatCurrency = 'USD'): FeeBreakdown {
  const fiatValueUsd = cryptoAmount * cryptoPriceUsd;
  const fiatValueSelected = fiatValueUsd * USD_TO_FIAT[currency];
  
  const transakFee = (fiatValueSelected * TRANSAK_FEE_PERCENT) / 100;
  const networkFee = NETWORK_FEE_BASE_USD * 1.5 * USD_TO_FIAT[currency];
  
  return {
    networkFee,
    transakFee,
    transakFeePercent: TRANSAK_FEE_PERCENT,
    total: transakFee + networkFee
  };
}

// ---------------------------------------------------------------------------
// Estimation helpers
// ---------------------------------------------------------------------------

export function estimateCryptoAmount(fiatAmount: number, cryptoPriceUsd: number, fees: FeeBreakdown, currency: FiatCurrency = 'USD'): number {
  const fiatAmountUsd = fiatAmount / USD_TO_FIAT[currency];
  const feesUsd = fees.total / USD_TO_FIAT[currency];
  return (fiatAmountUsd - feesUsd) / cryptoPriceUsd;
}

export function estimateFiatPayout(cryptoAmount: number, cryptoPriceUsd: number, fees: FeeBreakdown, currency: FiatCurrency = 'USD'): number {
  const fiatValueUsd = cryptoAmount * cryptoPriceUsd;
  const fiatValueSelected = fiatValueUsd * USD_TO_FIAT[currency];
  return fiatValueSelected - fees.total;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------export function formatFiat(amount: number, currency: FiatCurrency = 'USD'): string {  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCrypto(amount: number, symbol: string): string {
  return `${amount.toFixed(6).replace(/\.?0+$/, '')} ${symbol}`;
}

export function formatFeePercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateFiatAmount(amount: number, minAmount = 30, maxAmount = 10_000): { valid: boolean; error?: string } {
  if (isNaN(amount) || amount <= 0) return { valid: false, error: 'Enter a valid amount' };
  if (amount < minAmount) return { valid: false, error: `Minimum amount is ${formatFiat(minAmount)}` };
  if (amount > maxAmount) return { valid: false, error: `Maximum amount is ${formatFiat(maxAmount)}` };
  return { valid: true };
}

export function validateCryptoAmount(amount: number, availableBalance: number): { valid: boolean; error?: string } {
  if (isNaN(amount) || amount <= 0) return { valid: false, error: 'Enter a valid amount' };
  if (amount > availableBalance) return { valid: false, error: 'Insufficient balance' };
  return { valid: true };
}

export function getMinDepositAmount(currency: FiatCurrency): number {
  return ({ USD: 30, EUR: 30, GBP: 25, INR: 2500, AUD: 45, CAD: 40, JPY: 4500 })[currency] ?? 30;
}

export function getMaxDepositAmount(currency: FiatCurrency): number {
  return ({ USD: 10_000, EUR: 10_000, GBP: 8_000, INR: 800_000, AUD: 15_000, CAD: 14_000, JPY: 1_500_000 })[currency] ?? 10_000;
}

// ---------------------------------------------------------------------------
// URL builders — with full KYC / compliance parameters
// ---------------------------------------------------------------------------

/**
 * Optional user data that Transak can use to pre-fill KYC forms.
 * If provided, Transak will show a faster KYC flow for the user.
 * All identity verification & document checks are done by Transak — not Veilpay.
 */
export interface TransakUserData {
  email?: string;
  firstName?: string;
  lastName?: string;
  mobileNumber?: string;
  /** Unique order ID from your system, useful for webhook correlation */
  partnerOrderId?: string;
  /** If you already have their dob on file */
  dateOfBirth?: string;
  /** ISO 3166-1 alpha-2 country code */
  countryCode?: string;
}

/**
 * Build Transak URL for fiat → crypto (on-ramp / deposit)
 *
 * Transak handles:
 *  • KYC identity verification (government ID + selfie)
 *  • AML screening
 *  • Jurisdiction restrictions (over 160 countries)
 *  • Card / bank payment processing
 *
 * Veilpay only provides the destination wallet address.
 */
export function buildTransakDepositUrl(params: {
  walletAddress: string;
  fiatAmount: number;
  fiatCurrency: FiatCurrency;
  cryptoToken: string;
  network: string;
  paymentMethod?: PaymentMethodId;
  userData?: TransakUserData;
}): string {
  const base = getTransakBaseUrl();

  const query = new URLSearchParams({
    apiKey: TRANSAK_API_KEY,
    referrerDomain: TRANSAK_REFERRER_DOMAIN,
    productsAvailed: 'BUY',
    // Wallet destination
    walletAddress: params.walletAddress,
    // Pre-selected token & amount
    cryptoCurrencyCode: params.cryptoToken,
    network: params.network,
    fiatAmount: params.fiatAmount.toString(),
    fiatCurrency: params.fiatCurrency,
    // KYC / compliance — user always goes through Transak's verification
    // disableWalletAddressForm hides the address field to avoid confusion
    disableWalletAddressForm: 'true',
    // Transak shows their own T&C and privacy policy — no need to duplicate
    hideMenu: 'false',
    // Theming
    themeColor: 'F59E0B',
    backgroundColour: '050505',
  });

  if (params.paymentMethod) {
    query.append('paymentMethod', params.paymentMethod);
  }

  // Pre-fill KYC user data (optional — speeds up the KYC flow)
  if (params.userData) {
    const u = params.userData;
    if (u.email) query.append('email', u.email);
    if (u.firstName) query.append('firstName', u.firstName);
    if (u.lastName) query.append('lastName', u.lastName);
    if (u.mobileNumber) query.append('mobileNumber', u.mobileNumber);
    if (u.partnerOrderId) query.append('partnerOrderId', u.partnerOrderId);
    if (u.countryCode) query.append('defaultCountry', u.countryCode);
    if (u.dateOfBirth) query.append('dateOfBirth', u.dateOfBirth);
  }

  return `${base}?${query.toString()}`;
}

/**
 * Build Transak URL for crypto → fiat (off-ramp / withdrawal)
 *
 * Same KYC rules apply — Transak verifies the identity of the seller.
 */
export function buildTransakWithdrawUrl(params: {
  walletAddress: string;
  cryptoAmount: number;
  cryptoToken: string;
  network: string;
  fiatCurrency?: FiatCurrency;
  payoutMethod?: PayoutMethodId;
  userData?: TransakUserData;
}): string {
  const base = getTransakBaseUrl();

  const query = new URLSearchParams({
    apiKey: TRANSAK_API_KEY,
    referrerDomain: TRANSAK_REFERRER_DOMAIN,
    // Sell flow
    productsAvailed: 'SELL',
    walletAddress: params.walletAddress,
    cryptoCurrencyCode: params.cryptoToken,
    network: params.network,
    cryptoAmount: params.cryptoAmount.toString(),
    // KYC
    disableWalletAddressForm: 'true',
    // Theming
    themeColor: 'F59E0B',
    backgroundColour: '050505',
  });

  if (params.fiatCurrency) {
    query.append('fiatCurrency', params.fiatCurrency);
  }

  if (params.payoutMethod) {
    query.append('paymentMethod', params.payoutMethod);
  }

  // Pre-fill KYC user data
  if (params.userData) {
    const u = params.userData;
    if (u.email) query.append('email', u.email);
    if (u.firstName) query.append('firstName', u.firstName);
    if (u.lastName) query.append('lastName', u.lastName);
    if (u.mobileNumber) query.append('mobileNumber', u.mobileNumber);
    if (u.partnerOrderId) query.append('partnerOrderId', u.partnerOrderId);
    if (u.countryCode) query.append('defaultCountry', u.countryCode);
    if (u.dateOfBirth) query.append('dateOfBirth', u.dateOfBirth);
  }

  return `${base}?${query.toString()}`;
}
