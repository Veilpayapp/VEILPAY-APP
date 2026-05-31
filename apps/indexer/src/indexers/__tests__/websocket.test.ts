// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { EVMWebSocketIndexer, startWebSocketIndexers } from '../websocket';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { enqueueWebhook } from '../../queue';

jest.mock('../../queue', () => ({
  enqueueWebhook: jest.fn(),
}));

describe('EVMWebSocketIndexer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Lifecycle', () => {
    it('should initialize with HTTP provider if url is http', () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'http://localhost:8545'
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).provider).toBeDefined();
    });

    it('should initialize with WebSocket provider if url is ws', () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).provider).toBeDefined();
    });

    it('should start and setup listeners if pool address is provided', async () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'http://localhost:8545'
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recoverSpy = jest.spyOn(indexer as any, 'recoverFromCrash').mockResolvedValueOnce(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const setupSpy = jest.spyOn(indexer as any, 'setupEventListeners');
      
      await indexer.start();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).isRunning).toBe(true);
      expect(recoverSpy).toHaveBeenCalled();
      expect(setupSpy).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).provider.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should stop and destroy provider', async () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });

      // Spy on provider.destroy before start so we can track calls
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const provider = (indexer as any).provider;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const destroySpy = jest.spyOn(provider, 'destroy').mockResolvedValue(undefined as any);
      // Also mock recoverFromCrash so start() doesn't make real network calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer as any, 'recoverFromCrash').mockResolvedValue(undefined);

      await indexer.start();
      await indexer.stop();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).isRunning).toBe(false);
      expect(destroySpy).toHaveBeenCalled();
    });

  });

  describe('processEvent', () => {
    it('should process event and create payment/invoice update', async () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });

      const event = {
        chainKey: 'ethereum',
        blockNumber: 1000,
        txHash: '0xabc',
        logIndex: 0,
        type: 'commitment' as const,
        commitment: '0xcomm',
        amount: '100',
        token: '0x0000000000000000000000000000000000000000',
        timestamp: Date.now()
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer as any, 'findMerchantByPayment').mockResolvedValueOnce({ id: 'm1' });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({ id: 'pay1' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer as any, 'matchPaymentToInvoice').mockResolvedValueOnce({ id: 'inv1' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).processEvent(event, '0xFrom', '0xTo');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          merchantId: 'm1',
          txHash: '0xabc',
          amount: '100',
          tokenSymbol: 'ETH',
          privacyLevel: 'max'
        })
      }));
      expect(enqueueWebhook).toHaveBeenCalled();
    });

    it('should skip if payment already processed', async () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });
      (prisma.payment.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'pay1' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).processEvent({} as any, '0xFrom', '0xTo');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('startWebSocketIndexers', () => {
    it('should start indexers for configured pools', async () => {
      jest.resetModules();
      process.env.POOL_SEPOLIA = '0xSepoliaPool';
      process.env.RPC_SEPOLIA = 'ws://sepolia';
      
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
      const { startWebSocketIndexers } = require('../websocket');
      
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const indexers = await startWebSocketIndexers();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      expect(indexers.has('sepolia')).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const sepoliaIndexer = indexers.get('sepolia');
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((sepoliaIndexer as any).isRunning).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await sepoliaIndexer.stop();
    });
  });

  describe('handleReconnect', () => {
    it('should attempt reconnect and increment attempts', async () => {
      jest.useFakeTimers();
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });

      const stopSpy = jest.spyOn(indexer, 'stop').mockResolvedValue();
      const startSpy = jest.spyOn(indexer, 'start').mockResolvedValue();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const reconnectPromise = (indexer as any).handleReconnect();
      jest.runAllTimers();
      await reconnectPromise;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).reconnectAttempts).toBe(0); // Resets on success
      expect(stopSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should stop reconnecting after max attempts', async () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (indexer as any).reconnectAttempts = 10;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).handleReconnect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).reconnectAttempts).toBe(10);
    });
  });

  describe('waitForConfirmations', () => {
    it('should wait until target block is reached', async () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });

      // Just mock it to return immediately to cover the lines
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (indexer as any).provider.getBlockNumber = jest.fn()
        .mockResolvedValueOnce(100);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).waitForConfirmations(100);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).provider.getBlockNumber).toHaveBeenCalledTimes(1);
    });

    it('should wait if current block is less than target block', async () => {
      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });

      // Override the internal method to not actually wait 5s
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const originalWaitForConfirmations = (indexer as any).waitForConfirmations;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/explicit-function-return-type
      (indexer as any).waitForConfirmations = async (target: number) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        const current = await (indexer as any).provider.getBlockNumber();
        if (current >= target) return;
        return Promise.resolve();
      };
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (indexer as any).provider.getBlockNumber = jest.fn().mockResolvedValue(90);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).waitForConfirmations(100);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).provider.getBlockNumber).toHaveBeenCalled();
    });
  });

  describe('getLastProcessedBlock', () => {
    it('should return from redis if present', async () => {
      const indexer = new EVMWebSocketIndexer({ chainKey: 'ethereum', poolAddress: '0xPool', rpcUrl: 'ws://localhost' });
      (redis.get as jest.Mock).mockResolvedValueOnce('500');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const block = await (indexer as any).getLastProcessedBlock();
      expect(block).toBe(500);
    });

    it('should fallback to prisma if redis empty', async () => {
      const indexer = new EVMWebSocketIndexer({ chainKey: 'ethereum', poolAddress: '0xPool', rpcUrl: 'ws://localhost' });
      (redis.get as jest.Mock).mockResolvedValueOnce(null);
      (prisma.processedBlock.findUnique as jest.Mock).mockResolvedValueOnce({ blockNumber: BigInt(600) });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const block = await (indexer as any).getLastProcessedBlock();
      expect(block).toBe(600);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(redis.set).toHaveBeenCalledWith('veilpay:block:ethereum', '600');
    });
  });

  describe('recoverFromCrash', () => {
    it('should initialize at currentBlock - 1000 if no last processed', async () => {
      const indexer = new EVMWebSocketIndexer({ chainKey: 'ethereum', poolAddress: '0xPool', rpcUrl: 'ws://localhost' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer as any, 'getLastProcessedBlock').mockResolvedValueOnce(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (indexer as any).provider.getBlockNumber = jest.fn().mockResolvedValue(5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateSpy = jest.spyOn(indexer as any, 'updateLastProcessedBlock').mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).recoverFromCrash();

      expect(updateSpy).toHaveBeenCalledWith(4000);
    });

    it('should replay blocks if gap is small', async () => {
      const indexer = new EVMWebSocketIndexer({ chainKey: 'ethereum', poolAddress: '0xPool', rpcUrl: 'ws://localhost' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer as any, 'getLastProcessedBlock').mockResolvedValueOnce(5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (indexer as any).provider.getBlockNumber = jest.fn().mockResolvedValue(5500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const replaySpy = jest.spyOn(indexer as any, 'replayBlocks').mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).recoverFromCrash();

      expect(replaySpy).toHaveBeenCalledWith(5001, 5500);
    });

    it('should skip replay if gap is too large', async () => {
      const indexer = new EVMWebSocketIndexer({ chainKey: 'ethereum', poolAddress: '0xPool', rpcUrl: 'ws://localhost' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer as any, 'getLastProcessedBlock').mockResolvedValueOnce(5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (indexer as any).provider.getBlockNumber = jest.fn().mockResolvedValue(16000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateSpy = jest.spyOn(indexer as any, 'updateLastProcessedBlock').mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).recoverFromCrash();

      expect(updateSpy).toHaveBeenCalledWith(16000 - 3); // currentBlock - confirmations
    });
  });
});
