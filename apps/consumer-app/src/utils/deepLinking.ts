import { Linking } from 'react-native';
import {
  validateAddress as validateAddressCanonical,
  type SupportedChainType,
} from './validation';

/** Chains that can appear in payment / WC deep links. */
export type WalletChainType = SupportedChainType;

export type DeepLinkParams = {
  action: 'send' | 'receive' | 'approve' | 'reject' | 'walletconnect' | 'transactions';
  address?: string;
  chainType?: WalletChainType;
  amount?: string;
  token?: string;
  uri?: string;
  transactionHash?: string;
  transactionId?: string;
};

const ACTIONS: DeepLinkParams['action'][] = [
  'send',
  'receive',
  'approve',
  'reject',
  'walletconnect',
  'transactions',
];

/** Single source of truth: `utils/validation.ts` (same rules as wallet store / send). */
function validateAddress(address: string, chainType?: WalletChainType): boolean {
  return validateAddressCanonical(address, chainType);
}

function parseQueryParams(queryString: string): Record<string, string> {
  if (!queryString) {
    return {};
  }

  return queryString
    .split('&')
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [rawKey, rawValue = ''] = pair.split('=');
      if (!rawKey) {
        return acc;
      }

      const key = decodeURIComponent(rawKey);
      const value = decodeURIComponent(rawValue);
      acc[key] = value;
      return acc;
    }, {});
}

export function parseDeepLink(url: string): DeepLinkParams | null {
  try {
    if (!url.startsWith('veilpay://')) {
      return null;
    }

    let action = '';
    let queryParams: Record<string, string> = {};

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'veilpay:') {
        return null;
      }

      action = parsedUrl.hostname.toLowerCase();
      queryParams = parseQueryParams(parsedUrl.search.replace(/^\?/, ''));
    } catch {
      const stripped = url.replace('veilpay://', '');
      const [host, rawQuery = ''] = stripped.split('?');
      action = host.toLowerCase();
      queryParams = parseQueryParams(rawQuery);
    }

    const typedAction = action as DeepLinkParams['action'];
    if (!ACTIONS.includes(typedAction)) {
      return null;
    }

    const params: DeepLinkParams = {
      action: typedAction,
    };

    const address = queryParams.address;
    const amount = queryParams.amount;
    const token = queryParams.token;
    const uri = queryParams.uri;
    const chainType = queryParams.chainType;
    const transactionHash = queryParams.transactionHash || queryParams.hash;
    const transactionId = queryParams.transactionId || queryParams.txId;

    if (chainType === 'evm' || chainType === 'svm' || chainType === 'xlm') {
      params.chainType = chainType;
    }

    // M2 fix: validate address format before accepting it from the deep link.
    if (address) {
      if (!validateAddress(address, params.chainType)) {
        console.warn('[deepLink] Rejected invalid address from deep link:', address);
        return null;
      }
      params.address = address;
    }

    if (amount) {
      if (!/^\d+(\.\d{1,18})?$/.test(amount)) {
        console.warn('[deepLink] Rejected non-numeric amount from deep link:', amount);
        return null;
      }
      const parsedAmount = parseFloat(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1e9) {
        console.warn('[deepLink] Rejected out-of-range amount from deep link:', amount);
        return null;
      }
      params.amount = parsedAmount.toString();
    }
    if (token) {
      if (!/^[a-zA-Z0-9]{1,20}$/.test(token)) {
        console.warn('[deepLink] Rejected invalid token symbol from deep link:', token);
        return null;
      }
      params.token = token;
    }
    if (uri) {
      if (!uri.startsWith('wc:')) {
        console.warn('[deepLink] Rejected non-WalletConnect URI from deep link:', uri.substring(0, 20));
        return null;
      }
      if (uri.length > 2048) {
        console.warn('[deepLink] Rejected WalletConnect URI exceeding 2048 chars from deep link');
        return null;
      }
      params.uri = uri;
    }
    if (transactionHash) {
      if (
        !/^0x[0-9a-fA-F]{64}$/.test(transactionHash) &&
        !/^[1-9A-HJ-NP-Za-km-z]{88}$/.test(transactionHash)
      ) {
        console.warn(
          '[deepLink] Rejected invalid transactionHash from deep link:',
          transactionHash.substring(0, 20)
        );
        return null;
      }
      params.transactionHash = transactionHash;
    }
    if (transactionId) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(transactionId)) {
        console.warn(
          '[deepLink] Rejected invalid transactionId from deep link:',
          transactionId.substring(0, 20)
        );
        return null;
      }
      params.transactionId = transactionId;
    }

    return params;
  } catch (error) {
    console.error('Failed to parse deep link:', error);
    return null;
  }
}

export function setupDeepLinking(handler: (params: DeepLinkParams) => void) {
  Linking.getInitialURL().then((url) => {
    if (url) {
      const params = parseDeepLink(url);
      if (params) {
        handler(params);
      }
    }
  });

  const subscription = Linking.addEventListener('url', ({ url }) => {
    const params = parseDeepLink(url);
    if (params) {
      handler(params);
    }
  });

  return () => subscription.remove();
}

export type CreateSendLinkOptions = {
  token?: string;
  chainType?: WalletChainType;
  /** When omitted, link is address-only (open Send with recipient prefilled). */
  amount?: string;
};

/**
 * Build an in-app payment request deep link.
 * Always include chainType so Stellar G… addresses are not rejected as invalid EVM/SVM.
 */
export function createSendLink(
  address: string,
  amountOrOptions?: string | CreateSendLinkOptions,
  tokenLegacy?: string
): string {
  // Back-compat: createSendLink(addr, amount, token?)
  let amount: string | undefined;
  let token: string | undefined;
  let chainType: WalletChainType | undefined;

  if (typeof amountOrOptions === 'string' || amountOrOptions === undefined) {
    amount = amountOrOptions;
    token = tokenLegacy;
  } else {
    amount = amountOrOptions.amount;
    token = amountOrOptions.token;
    chainType = amountOrOptions.chainType;
  }

  const query = new URLSearchParams();
  query.set('address', address);
  if (amount && parseFloat(amount) > 0) {
    // Normalize for parseDeepLink numeric rules
    const n = parseFloat(amount);
    if (Number.isFinite(n) && n > 0) {
      query.set('amount', String(n));
    }
  }
  if (token) {
    query.set('token', token);
  }
  if (chainType) {
    query.set('chainType', chainType);
  }
  return `veilpay://send?${query.toString()}`;
}

export function createReceiveLink(
  address: string,
  options?: { chainType?: WalletChainType }
): string {
  const query = new URLSearchParams();
  query.set('address', address);
  if (options?.chainType) {
    query.set('chainType', options.chainType);
  }
  return `veilpay://receive?${query.toString()}`;
}

export function createWalletConnectLink(
  uri: string,
  options?: {
    address?: string;
    chainType?: WalletChainType;
  }
): string {
  const query = new URLSearchParams();
  query.set('uri', uri);

  if (options?.address) {
    query.set('address', options.address);
  }
  if (options?.chainType) {
    query.set('chainType', options.chainType);
  }

  return `veilpay://walletconnect?${query.toString()}`;
}

export function createTransactionLink(transactionHash: string): string {
  return `veilpay://transactions?hash=${encodeURIComponent(transactionHash)}`;
}

/** Map wallet store chain type → deep-link chainType. */
export function chainTypeForDeepLink(
  chainType: string | null | undefined
): WalletChainType | undefined {
  if (chainType === 'evm' || chainType === 'svm' || chainType === 'xlm') {
    return chainType;
  }
  return undefined;
}
