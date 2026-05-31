/**
 * Andrej Karpathy first-principles style unit tests for walletConnectSession.ts
 * Thoroughly covers WalletConnect SignClient lazy loading, session requests, validations, approvals, and error timeouts.
 */

// Set project ID before any import so that lazy/global evaluation is safe
process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID = 'mock-project-id';

const mockSignClient = {
  connect: jest.fn(),
  respond: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
  session: {
    values: [] as any[],
  },
};

jest.mock('@walletconnect/sign-client', () => ({
  default: {
    init: jest.fn().mockImplementation(async () => mockSignClient),
  },
}));

import {
  hasWalletConnectProjectId,
  createWalletConnectSession,
  clearPendingWalletConnectSession,
  onSessionRequest,
  respondToSessionRequest,
  getActiveSessions,
  disconnectSession,
  registerSessionRequestListener,
} from '../walletConnectSession';

describe('walletConnectSession utility tests', () => {
  // Capture a snapshot of original env properties
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clean up process.env without reassigning the process.env object itself
    for (const key in process.env) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    
    // Set a default mock project ID for all tests
    process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID = 'mock-project-id';
    clearPendingWalletConnectSession();
    mockSignClient.session.values = [];
  });

  afterAll(() => {
    for (const key in process.env) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  describe('Project ID checking', () => {
    it('returns false when EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID is missing', () => {
      delete process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
      expect(hasWalletConnectProjectId()).toBe(false);
    });

    it('returns true when EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID is present', () => {
      process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID = 'mock-project-id';
      expect(hasWalletConnectProjectId()).toBe(true);
    });
  });

  describe('createWalletConnectSession', () => {
    it('throws error if project ID is missing', async () => {
      delete process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
      // We isolate modules to clear the cached signClientPromise
      let freshCreate: any;
      jest.isolateModules(() => {
        freshCreate = require('../walletConnectSession').createWalletConnectSession;
      });
      await expect(freshCreate()).rejects.toThrow(
        'WalletConnect project ID is missing. Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID.'
      );
    });

    it('creates session request with normal flow and returns valid approval results', async () => {
      const mockApproval = jest.fn().mockResolvedValue({
        topic: 'test-topic',
        namespaces: {
          eip155: {
            accounts: ['eip155:1:0x1234567890123456789012345678901234567890'],
          },
        },
      });

      mockSignClient.connect.mockResolvedValueOnce({
        uri: 'wc:test-uri',
        approval: mockApproval,
      });

      const sessionRequest = await createWalletConnectSession();

      expect(sessionRequest.uri).toBe('wc:test-uri');
      expect(mockSignClient.connect).toHaveBeenCalled();

      // Test waitForApproval
      const result = await sessionRequest.waitForApproval();
      expect(mockApproval).toHaveBeenCalled();
      expect(result).toEqual({
        topic: 'test-topic',
        account: 'eip155:1:0x1234567890123456789012345678901234567890',
        chainId: 'eip155:1',
        address: '0x1234567890123456789012345678901234567890',
      });
    });

    it('reuses a pending session request if called within the reuse window', async () => {
      mockSignClient.connect.mockResolvedValue({
        uri: 'wc:test-uri-reuse',
        approval: jest.fn(),
      });

      const session1 = await createWalletConnectSession();
      const session2 = await createWalletConnectSession();

      expect(session1.uri).toBe('wc:test-uri-reuse');
      expect(session2.uri).toBe('wc:test-uri-reuse');
      expect(mockSignClient.connect).toHaveBeenCalledTimes(1);
    });

    it('creates a new session request if pending session is cleared', async () => {
      mockSignClient.connect.mockResolvedValue({
        uri: 'wc:test-uri-1',
        approval: jest.fn(),
      });

      await createWalletConnectSession();
      clearPendingWalletConnectSession();

      mockSignClient.connect.mockResolvedValue({
        uri: 'wc:test-uri-2',
        approval: jest.fn(),
      });

      const session2 = await createWalletConnectSession();
      expect(session2.uri).toBe('wc:test-uri-2');
      expect(mockSignClient.connect).toHaveBeenCalledTimes(2);
    });

    it('handles approval timeouts correctly', async () => {
      jest.useFakeTimers();

      // Non-resolving approval mock
      const mockApproval = () => new Promise(() => {});

      mockSignClient.connect.mockResolvedValueOnce({
        uri: 'wc:test-uri-timeout',
        approval: mockApproval,
      });

      const sessionRequest = await createWalletConnectSession({ requestTimeoutMs: 1000 });
      const approvalPromise = sessionRequest.waitForApproval();

      // Fast-forward timers
      jest.advanceTimersByTime(1001);

      await expect(approvalPromise).rejects.toThrow(
        'Wallet connection approval timed out. Please try again.'
      );

      jest.useRealTimers();
    });

    it('extracts primary account with solana/aptos namespace fallbacks', async () => {
      const mockApproval = jest.fn().mockResolvedValue({
        topic: 'solana-topic',
        namespaces: {
          solana: {
            accounts: ['solana:5eyktz9u97L777:HN7cAB21StwBua29A322ss'],
          },
        },
      });

      mockSignClient.connect.mockResolvedValueOnce({
        uri: 'wc:solana-uri',
        approval: mockApproval,
      });

      const sessionRequest = await createWalletConnectSession();
      const result = await sessionRequest.waitForApproval();

      expect(result).toEqual({
        topic: 'solana-topic',
        account: 'solana:5eyktz9u97L777:HN7cAB21StwBua29A322ss',
        chainId: 'solana:5eyktz9u97L777',
        address: 'HN7cAB21StwBua29A322ss',
      });
    });

    it('gracefully handles missing namespace primary accounts', async () => {
      const mockApproval = jest.fn().mockResolvedValue({
        topic: 'empty-topic',
        namespaces: {},
      });

      mockSignClient.connect.mockResolvedValueOnce({
        uri: 'wc:empty-uri',
        approval: mockApproval,
      });

      const sessionRequest = await createWalletConnectSession();
      const result = await sessionRequest.waitForApproval();

      expect(result).toEqual({
        topic: 'empty-topic',
        account: null,
        chainId: null,
        address: null,
      });
    });
  });

  describe('respondToSessionRequest', () => {
    it('sends success result through SignClient respond', async () => {
      await respondToSessionRequest('test-topic', {
        id: 42,
        result: '0xsignature_hash',
      });

      expect(mockSignClient.respond).toHaveBeenCalledWith({
        topic: 'test-topic',
        response: {
          id: 42,
          result: '0xsignature_hash',
        },
      });
    });

    it('sends error through SignClient respond if error payload exists', async () => {
      await respondToSessionRequest('test-topic', {
        id: 42,
        result: null,
        error: { code: 4001, message: 'User rejected' },
      });

      expect(mockSignClient.respond).toHaveBeenCalledWith({
        topic: 'test-topic',
        response: {
          id: 42,
          error: { code: 4001, message: 'User rejected' },
        },
      });
    });
  });

  describe('getActiveSessions and disconnectSession', () => {
    it('fetches all active sessions from SignClient values/map', async () => {
      mockSignClient.session.values = [{ topic: 's1' }, { topic: 's2' }];

      const sessions = await getActiveSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].topic).toBe('s1');
    });

    it('triggers disconnect trigger through SignClient disconnect', async () => {
      await disconnectSession('target-topic');

      expect(mockSignClient.disconnect).toHaveBeenCalledWith({
        topic: 'target-topic',
        reason: { code: 6000, message: 'User disconnected' },
      });
    });
  });

  describe('onSessionRequest handlers and session listeners', () => {
    it('manages listener registries and responds to callbacks', async () => {
      const mockHandler = jest.fn();
      const unsubscribe = onSessionRequest(mockHandler);

      let registeredCallback: ((event: any) => void) | null = null;
      mockSignClient.on.mockImplementation((event: string, callback: any) => {
        if (event === 'session_request') {
          registeredCallback = callback;
        }
      });

      await registerSessionRequestListener();
      expect(mockSignClient.on).toHaveBeenCalledWith('session_request', expect.any(Function));

      // Trigger the mock event callback
      if (registeredCallback) {
        (registeredCallback as any)({
          topic: 'callback-topic',
          params: {
            request: {
              method: 'eth_sign',
              params: ['hello'],
            },
            chainId: 'eip155:1',
          },
        });
      }

      expect(mockHandler).toHaveBeenCalledWith({
        topic: 'callback-topic',
        request: {
          method: 'eth_sign',
          params: ['hello'],
        },
        chainId: 'eip155:1',
      });

      unsubscribe();
    });
  });
});
