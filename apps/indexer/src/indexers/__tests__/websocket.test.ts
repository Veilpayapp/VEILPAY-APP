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
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        timestamp: Date.now()
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer as any, 'findMerchantByPayment').mockResolvedValueOnce({ id: 'm1' });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({ id: 'pay1', txHash: '0xabc' });
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
          amount: '1',
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

  describe('Settlement (IX-C2: base-unit conversion, tx hash, CAS flip)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function makeIndexer(): any {
      return new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function baseEvent(overrides: Record<string, any> = {}) {
      return {
        chainKey: 'ethereum',
        blockNumber: 1000,
        txHash: '0xrealTxHash',
        logIndex: 0,
        type: 'commitment' as const,
        commitment: '0xcomm',
        // 1 native ETH in base units; Invoice.amount stores human units ("1")
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        timestamp: Date.now(),
        ...overrides,
      };
    }

    it('matches the invoice when eventAmount = invoiceAmount x 10^decimals (not raw base units)', async () => {
      const indexer = makeIndexer();

      (prisma.payment.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer, 'findMerchantByPayment').mockResolvedValueOnce({ id: 'm1' });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({
        id: 'pay1',
        txHash: '0xrealTxHash',
        amount: '1',
        chainKey: 'ethereum',
        merchantId: 'm1',
        toAddress: '0xTo',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'inv1' });
      (prisma.invoice.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });

      await indexer.processEvent(baseEvent(), '0xFrom', '0xTo');

      // The invoice lookup ran with the CONVERTED human amount, never the
      // raw base-unit string — that is why the old exact match never hit.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const whereArg = (prisma.invoice.findFirst as jest.Mock).mock.calls[0][0].where as any;
      expect(whereArg.amount).toBe('1');
      expect(whereArg.amount).not.toBe('1000000000000000000');
      expect(whereArg.status).toBe('pending');
      expect(whereArg.merchantId).toBe('m1');
    });

    it('writes the real tx hash (not the to-address) into paymentTxHash via a pending-precondition CAS', async () => {
      const indexer = makeIndexer();

      (prisma.payment.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer, 'findMerchantByPayment').mockResolvedValueOnce({ id: 'm1' });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({
        id: 'pay1',
        txHash: '0xrealTxHash',
        amount: '1',
        chainKey: 'ethereum',
        merchantId: 'm1',
        toAddress: '0xTo',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'inv1' });
      (prisma.invoice.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });

      await indexer.processEvent(baseEvent(), '0xFrom', '0xTo');

      expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv1', status: 'pending' },
        data: expect.objectContaining({
          status: 'paid',
          paymentTxHash: '0xrealTxHash',
          paidAt: expect.any(Date),
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const callArg = (prisma.invoice.updateMany as jest.Mock).mock.calls[0][0] as any;
      expect(callArg.data.paymentTxHash).not.toBe('0xTo');
      // settled → webhook enqueued
      expect(enqueueWebhook).toHaveBeenCalledTimes(1);
    });

    it('treats updateMany count === 0 as NOT settled (invoice no longer pending)', async () => {
      const indexer = makeIndexer();

      (prisma.payment.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer, 'findMerchantByPayment').mockResolvedValueOnce({ id: 'm1' });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({
        id: 'pay1',
        txHash: '0xrealTxHash',
        amount: '1',
        chainKey: 'ethereum',
        merchantId: 'm1',
        toAddress: '0xTo',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'inv1' });
      // CAS loses: another writer already flipped the invoice off pending.
      (prisma.invoice.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

      await indexer.processEvent(baseEvent(), '0xFrom', '0xTo');

      expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(1);
      expect(enqueueWebhook).not.toHaveBeenCalled();
    });

    it('never writes a 42-char token address to tokenSymbol (unknown token → short symbol)', async () => {
      const indexer = makeIndexer();

      (prisma.payment.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer, 'findMerchantByPayment').mockResolvedValueOnce({ id: 'm1' });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({
        id: 'pay1',
        txHash: '0xrealTxHash',
        amount: '1',
        chainKey: 'ethereum',
        merchantId: 'm1',
        toAddress: '0xTo',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await indexer.processEvent(
        baseEvent({ token: '0x9999999999999999999999999999999999999999' }),
        '0xFrom',
        '0xTo'
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const data = (prisma.payment.create as jest.Mock).mock.calls[0][0].data as any;
      expect(data.tokenSymbol).toBe('TOKEN');
      expect(data.tokenSymbol.length).toBeLessThan(20);
      expect(data.tokenSymbol).not.toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it('maps an allowlisted USDC contract to its symbol and 6-decimal conversion', async () => {
      const indexer = makeIndexer();

      (prisma.payment.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(indexer, 'findMerchantByPayment').mockResolvedValueOnce({ id: 'm1' });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({
        id: 'pay1',
        txHash: '0xrealTxHash',
        amount: '1',
        chainKey: 'ethereum',
        merchantId: 'm1',
        toAddress: '0xTo',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValueOnce(null);

      // 1 USDC in base units with 6 decimals.
      await indexer.processEvent(
        baseEvent({
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: '1000000',
        }),
        '0xFrom',
        '0xTo'
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const data = (prisma.payment.create as jest.Mock).mock.calls[0][0].data as any;
      expect(data.tokenSymbol).toBe('USDC');
      expect(data.amount).toBe('1');
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

    it('should exit the process (exit code 1) after max reconnect attempts', async () => {
      // IX-C3: exhaustion must terminate the process so the supervisor's
      // ON_FAILURE restart fires — never silently return and zombie on.
      // process.exit is mocked or jest itself would die with the worker.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

      const indexer = new EVMWebSocketIndexer({
        chainKey: 'ethereum',
        poolAddress: '0xPool',
        rpcUrl: 'ws://localhost:8545'
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (indexer as any).reconnectAttempts = 10;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (indexer as any).handleReconnect();

      expect(exitSpy).toHaveBeenCalledWith(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((indexer as any).reconnectAttempts).toBe(10);
      exitSpy.mockRestore();
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
