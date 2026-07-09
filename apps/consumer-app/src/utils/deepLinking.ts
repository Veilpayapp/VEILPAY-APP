import { Linking } from 'react-native';

export type WalletChainType = 'evm' | 'svm';

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

// M2 fix: validate incoming address parameters to prevent injection of attacker addresses.
// EVM: 0x + 40 hex chars. Solana: base58 32-44 chars.
const ADDRESS_PATTERNS: Record<WalletChainType | 'unknown', RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  svm: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  unknown: /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/,
};

function validateAddress(address: string, chainType?: WalletChainType): boolean {
  const pattern = chainType ? ADDRESS_PATTERNS[chainType] : ADDRESS_PATTERNS.unknown;
  return pattern.test(address);
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

    if (chainType === 'evm' || chainType === 'svm') {
      params.chainType = chainType;
    }

    // M2 fix: validate address format before accepting it from the deep link.
    // An attacker could craft veilpay://send?address=<attacker_address> to pre-fill
    // an attacker-controlled address in the send flow.
    if (address) {
      if (!validateAddress(address, params.chainType)) {
        console.warn('[deepLink] Rejected invalid address from deep link:', address);
        return null;
      }
      params.address = address;
    }

    if (amount) {
      // Only accept numeric amounts (including decimals); reject arbitrary strings.
      if (!/^\d+(\.\d{1,18})?$/.test(amount)) {
        console.warn('[deepLink] Rejected non-numeric amount from deep link:', amount);
        return null;
      }
      // Cap amount to a reasonable maximum (1 billion ETH) to prevent absurd pre-fills
      const parsedAmount = parseFloat(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1e9) {
        console.warn('[deepLink] Rejected out-of-range amount from deep link:', amount);
        return null;
      }
      // Normalize: strip trailing zeros after decimal point to prevent format tricks
      params.amount = parsedAmount.toString();
    }
    if (token) {
      // Only accept alphanumeric token symbols (e.g. "ETH", "USDC", "wETH")
      // Reject anything with special chars, URLs, or script-like content
      if (!/^[a-zA-Z0-9]{1,20}$/.test(token)) {
        console.warn('[deepLink] Rejected invalid token symbol from deep link:', token);
        return null;
      }
      params.token = token;
    }
  if (uri) {
    // Only accept WalletConnect URIs (wc: prefix) to prevent arbitrary URL injection
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
      // Validate tx hash format: 0x + 64 hex chars (EVM) or base58 (SVM)
      if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) && !/^[1-9A-HJ-NP-Za-km-z]{88}$/.test(transactionHash)) {
        console.warn('[deepLink] Rejected invalid transactionHash from deep link:', transactionHash.substring(0, 20));
        return null;
      }
      params.transactionHash = transactionHash;
    }
    if (transactionId) {
      // Transaction IDs are backend-generated; accept alphanumeric + hyphens, max 128 chars
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(transactionId)) {
        console.warn('[deepLink] Rejected invalid transactionId from deep link:', transactionId.substring(0, 20));
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
  // Handle initial URL if app was opened via deep link
  Linking.getInitialURL().then((url) => {
    if (url) {
      const params = parseDeepLink(url);
      if (params) {
        handler(params);
      }
    }
  });

  // Handle deep links while app is running
  const subscription = Linking.addEventListener('url', ({ url }) => {
    const params = parseDeepLink(url);
    if (params) {
      handler(params);
    }
  });

  return () => subscription.remove();
}

export function createSendLink(address: string, amount: string, token?: string): string {
  let url = `veilpay://send?address=${encodeURIComponent(address)}&amount=${encodeURIComponent(amount)}`;
  if (token) {
    url += `&token=${encodeURIComponent(token)}`;
  }
  return url;
}

export function createReceiveLink(address: string): string {
  return `veilpay://receive?address=${encodeURIComponent(address)}`;
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
