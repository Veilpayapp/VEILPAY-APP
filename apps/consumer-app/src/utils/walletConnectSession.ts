type WalletConnectRequiredNamespace = {
  methods: string[];
  chains: string[];
  events: string[];
};

type WalletConnectRequiredNamespaces = Record<string, WalletConnectRequiredNamespace>;

type WalletConnectConnectOptions = {
  pairingTopic?: string;
  requestTimeoutMs?: number;
  requiredNamespaces?: WalletConnectRequiredNamespaces;
  optionalNamespaces?: WalletConnectRequiredNamespaces;
};

type WalletConnectSessionRequestInternal = {
  uri: string;
  approval: () => Promise<unknown>;
  createdAt: number;
  requestTimeoutMs: number;
};

export type WalletConnectApprovalResult = {
  topic: string;
  chainId: string | null;
  account: string | null;
  address: string | null;
};

export type WalletConnectSessionRequest = {
  uri: string;
  waitForApproval: () => Promise<WalletConnectApprovalResult>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 3 * 60_000;
const REUSE_WINDOW_MS = 60_000;

const DEFAULT_REQUIRED_NAMESPACES: WalletConnectRequiredNamespaces = {};

const DEFAULT_OPTIONAL_NAMESPACES: WalletConnectRequiredNamespaces = {
  eip155: {
    methods: [
      'eth_sendTransaction',
      'eth_sign',
      'personal_sign',
      'eth_signTypedData',
      'eth_signTypedData_v4',
    ],
    chains: ['eip155:1', 'eip155:11155111'],
    events: ['accountsChanged', 'chainChanged'],
  },
  solana: {
    methods: ['solana_signTransaction', 'solana_signMessage'],
    chains: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
    events: ['accountsChanged'],
  },
  aptos: {
    methods: ['aptos_signTransaction', 'aptos_signMessage'],
    chains: ['aptos:1'],
    events: ['accountsChanged'],
  },
  stellar: {
    methods: ['stellar_signXDR', 'stellar_signMessage'],
    chains: ['stellar:pubnet'],
    events: [],
  },
};

let signClientPromise: Promise<any> | null = null;
let pendingSessionRequest: WalletConnectSessionRequestInternal | null = null;

function getWalletConnectProjectId(): string {
  return process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || '';
}

export function hasWalletConnectProjectId(): boolean {
  return Boolean(getWalletConnectProjectId());
}

function normalizeWalletConnectUri(uri: unknown): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const trimmed = uri.trim();
  if (!trimmed.startsWith('wc:')) {
    return null;
  }

  return trimmed;
}

function parseWalletConnectAccount(account: string | null): {
  chainId: string | null;
  address: string | null;
} {
  if (!account) {
    return { chainId: null, address: null };
  }

  const segments = account.split(':');
  if (segments.length < 3) {
    return { chainId: null, address: null };
  }

  const [namespace, chain, ...addressParts] = segments;
  const address = addressParts.join(':') || null;

  if (!namespace || !chain || !address) {
    return { chainId: null, address: null };
  }

  return {
    chainId: `${namespace}:${chain}`,
    address,
  };
}

function extractApprovalResult(session: any): WalletConnectApprovalResult {
  const namespaces = session?.namespaces || {};
  const namespacePriority = ['eip155', 'solana', 'aptos'];

  let primaryAccount: string | null = null;

  for (const namespaceKey of namespacePriority) {
    const accounts = namespaces?.[namespaceKey]?.accounts;
    if (Array.isArray(accounts) && accounts.length > 0) {
      primaryAccount = accounts[0];
      break;
    }
  }

  if (!primaryAccount) {
    const dynamicNamespaceKeys = Object.keys(namespaces);
    for (const namespaceKey of dynamicNamespaceKeys) {
      const accounts = namespaces?.[namespaceKey]?.accounts;
      if (Array.isArray(accounts) && accounts.length > 0) {
        primaryAccount = accounts[0];
        break;
      }
    }
  }

  const parsed = parseWalletConnectAccount(primaryAccount);

  return {
    topic: session?.topic || '',
    account: primaryAccount,
    chainId: parsed.chainId,
    address: parsed.address,
  };
}

function createTimeoutPromise(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Wallet connection approval timed out. Please try again.'));
    }, timeoutMs);
  });
}

async function getSignClient(): Promise<any> {
  if (signClientPromise) {
    return signClientPromise;
  }

  const projectId = getWalletConnectProjectId();
  if (!projectId) {
    throw new Error('WalletConnect project ID is missing. Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID.');
  }

  signClientPromise = (async () => {
    let signClientModule;
    if (typeof jest !== 'undefined') {
      signClientModule = require('@walletconnect/sign-client');
    } else {
      signClientModule = await import('@walletconnect/sign-client');
    }
    const SignClient = (signClientModule as any).default || signClientModule;

    return SignClient.init({
      projectId,
      metadata: {
        name: 'Veilpay',
        description: 'Veilpay private payment wallet',
        url: 'https://veilpay.app',
        icons: ['https://veilpay.app/icon.png'],
      },
    });
  })();

  return signClientPromise;
}

function toPublicSessionRequest(
  internalRequest: WalletConnectSessionRequestInternal
): WalletConnectSessionRequest {
  return {
    uri: internalRequest.uri,
    waitForApproval: async () => {
      try {
        const approvalPromise = Promise.resolve().then(() => internalRequest.approval());
        const session = await Promise.race([
          approvalPromise,
          createTimeoutPromise(internalRequest.requestTimeoutMs),
        ]);

        return extractApprovalResult(session);
      } finally {
        if (pendingSessionRequest === internalRequest) {
          pendingSessionRequest = null;
        }
      }
    },
  };
}

export async function createWalletConnectSession(
  options: WalletConnectConnectOptions = {}
): Promise<WalletConnectSessionRequest> {
  const now = Date.now();

  if (
    pendingSessionRequest &&
    now - pendingSessionRequest.createdAt < REUSE_WINDOW_MS
  ) {
    return toPublicSessionRequest(pendingSessionRequest);
  }

  const signClient = await getSignClient();
  const requiredNamespaces = options.requiredNamespaces || DEFAULT_REQUIRED_NAMESPACES;
  const optionalNamespaces = options.optionalNamespaces || DEFAULT_OPTIONAL_NAMESPACES;

  const connectResponse = await signClient.connect({
    requiredNamespaces,
    optionalNamespaces,
    pairingTopic: options.pairingTopic,
  });

  const uri = normalizeWalletConnectUri(connectResponse?.uri);
  if (!uri || typeof connectResponse?.approval !== 'function') {
    throw new Error('WalletConnect did not provide a valid connection URI.');
  }

  pendingSessionRequest = {
    uri,
    approval: connectResponse.approval,
    createdAt: now,
    requestTimeoutMs: options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
  };

  return toPublicSessionRequest(pendingSessionRequest);
}

export function clearPendingWalletConnectSession(): void {
  pendingSessionRequest = null;
}

export type SessionRequestHandler = (event: {
  topic: string;
  request: {
    method: string;
    params: unknown;
  };
  chainId?: string;
}) => void;

const sessionRequestListeners: Set<SessionRequestHandler> = new Set();

export function onSessionRequest(handler: SessionRequestHandler): () => void {
  sessionRequestListeners.add(handler);
  return () => {
    sessionRequestListeners.delete(handler);
  };
}

async function handleSessionRequest(event: { topic: string; request: { method: string; params: unknown }; chainId?: string }): Promise<void> {
  for (const handler of sessionRequestListeners) {
    try {
      handler(event);
    } catch {
      // Listener errors should not break the chain
    }
  }
}

export async function respondToSessionRequest(
  topic: string,
  response: { id: number; result: unknown; error?: { code: number; message: string } }
): Promise<void> {
  const signClient = await getSignClient();

  if (response.error) {
    await signClient.respond({
      topic,
      response: {
        id: response.id,
        error: response.error,
      },
    });
    return;
  }

  await signClient.respond({
    topic,
    response: {
      id: response.id,
      result: response.result as string,
    },
  });
}

export async function getActiveSessions(): Promise<any[]> {
  const signClient = await getSignClient();
  const sessions = signClient.session?.values || signClient.session?.map?.((s: any) => s) || [];

  return Array.isArray(sessions) ? sessions : Object.values(sessions);
}

export async function disconnectSession(topic: string): Promise<void> {
  const signClient = await getSignClient();
  await signClient.disconnect({
    topic,
    reason: { code: 6000, message: 'User disconnected' },
  });
}

let requestListenerRegistered = false;

export async function registerSessionRequestListener(): Promise<void> {
  if (requestListenerRegistered) {
    return;
  }

  const signClient = await getSignClient();

  signClient.on('session_request', (event: any) => {
    handleSessionRequest({
      topic: event.topic,
      request: {
        method: event.params?.request?.method || '',
        params: event.params?.request?.params,
      },
      chainId: event.params?.chainId,
    });
  });

  signClient.on('session_delete', (event: any) => {
    // Session was deleted by the dApp
  });

  requestListenerRegistered = true;
}
