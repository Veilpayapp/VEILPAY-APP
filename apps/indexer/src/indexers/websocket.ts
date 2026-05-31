import { WebSocketProvider, JsonRpcProvider, ethers, Contract } from "ethers";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { IndexedEvent } from "./index";
import { enqueueWebhook, WebhookPayload } from "../queue";

const VEIL_POOL_ABI = [
  "event NewCommitment(bytes32 indexed commitment, address indexed token, uint256 amount, uint256 leafIndex)",
  "event Withdrawal(bytes32 indexed nullifier, address indexed recipient, address indexed token, uint256 amount)",
];

const RPC_ENDPOINTS: Record<string, string> = {
  ethereum: process.env.RPC_ETHEREUM || "wss://eth.llamarpc.com",
  polygon: process.env.RPC_POLYGON || "wss://polygon.llamarpc.com",
  arbitrum: process.env.RPC_ARBITRUM || "wss://arb1.arbitrum.io/ws",
  sepolia: process.env.RPC_SEPOLIA || "wss://rpc.sepolia.org",
};

const POOL_ADDRESSES: Record<string, string> = {
  sepolia: process.env.POOL_SEPOLIA || "",
};

export interface EVMIndexerConfig {
  chainKey: string;
  poolAddress: string;
  rpcUrl: string;
  confirmations?: number;
}

export class EVMWebSocketIndexer {
  private provider: WebSocketProvider | JsonRpcProvider;
  private chainKey: string;
  private poolAddress: string;
  // IX-H6 fix: track pending events by block for confirmation waiting
  private confirmations: number;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private poolContract: Contract | null = null;

  constructor(cfg: EVMIndexerConfig) {
    this.chainKey = cfg.chainKey;
    this.poolAddress = cfg.poolAddress;
    this.confirmations = cfg.confirmations ?? 3;

    const rpcUrl = cfg.rpcUrl || RPC_ENDPOINTS[cfg.chainKey] || "";
    if (!rpcUrl) {
      throw new Error(`No RPC endpoint for chain: ${cfg.chainKey}`);
    }

    if (rpcUrl.startsWith("wss://") || rpcUrl.startsWith("ws://")) {
      this.provider = new WebSocketProvider(rpcUrl);
      console.warn(`[${this.chainKey}] Using WebSocket provider`);
    } else {
      this.provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
      console.warn(`[${this.chainKey}] Using HTTP provider (polling mode)`);
    }

    if (this.poolAddress) {
      this.poolContract = new Contract(this.poolAddress, VEIL_POOL_ABI, this.provider);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    if (!this.poolAddress) {
      console.warn(`[${this.chainKey}] No pool address configured, skipping`);
      return;
    }

    this.isRunning = true;
    console.warn(`[${this.chainKey}] Starting WebSocket indexer`);

    await this.recoverFromCrash();

    if (this.poolContract) {
      this.setupEventListeners();
    }

    // ethers v6 providers expose `on('error', ...)` via their EventEmitter
    // shape. The base `Provider` interface in the type defs does not (yet)
    // include the error event, so we narrow to the runtime EventEmitter
    // instead of re-introducing `any`.
    type ErrorEmitter = { on(event: 'error', cb: (err: Error) => void): void };
    (this.provider as unknown as ErrorEmitter).on('error', (error: Error) => {
      console.error(`[${this.chainKey}] Provider error:`, error);
      void this.handleReconnect();
    });

    if (this.provider instanceof WebSocketProvider) {
      // The underlying ws socket is exposed as `websocket` on the
      // WebSocketProvider; the type def does not surface it directly.
      type WsHolder = { websocket?: { on(event: 'close', cb: () => void): void } };
      (this.provider as unknown as WsHolder).websocket?.on('close', () => {
        console.warn(`[${this.chainKey}] WebSocket closed`);
        void this.handleReconnect();
      });
    }
  }

  /**
   * Stop the indexer and tear down the underlying socket. Returns a
   * Promise so call sites can `await indexer.stop()` symmetrically with
   * `start()` even though the underlying teardown is currently
   * synchronous — leaves room to await graceful close on the websocket
   * without breaking the API.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    if (this.provider && typeof (this.provider as any).destroy === 'function') {
      // ethers v6's `WebSocketProvider.destroy()` returns
      // `Promise<void>`. We don't need to wait for the close handshake
      // before continuing (the orchestrator already moved on), so
      // `void`-discard the promise to satisfy `no-floating-promises`.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      void (this.provider as any).destroy();
    }
    console.warn(`[${this.chainKey}] Indexer stopped`);
    await Promise.resolve();
  }

  private setupEventListeners(): void {
    if (!this.poolContract) {
      return;
    }

    // ethers v6's `Contract.on` returns `Promise<Contract>` so it can be
    // chained; we don't need the chain, so explicitly `void` the
    // subscription promises to satisfy `no-floating-promises`.
    void this.poolContract.on(
      'NewCommitment',
      (
        commitment: string,
        token: string,
        amount: bigint,
        leafIndex: bigint,
        event: ethers.EventLog,
      ) => {
        void this.handleEvent({
          type: 'commitment',
          commitment,
          token,
          amount: amount.toString(),
          leafIndex: Number(leafIndex),
          event,
        });
      },
    );

    void this.poolContract.on(
      'Withdrawal',
      (
        nullifier: string,
        recipient: string,
        token: string,
        amount: bigint,
        event: ethers.EventLog,
      ) => {
        void this.handleEvent({
          type: 'withdrawal',
          nullifier,
          recipient,
          token,
          amount: amount.toString(),
          event,
        });
      },
    );

    console.warn(`[${this.chainKey}] Event listeners setup complete`);
  }

  private async handleEvent(eventData: {
    type: "commitment" | "withdrawal";
    commitment?: string;
    nullifier?: string;
    recipient?: string;
    token: string;
    amount: string;
    leafIndex?: number;
    event: ethers.EventLog;
  }): Promise<void> {
    try {
      const { event } = eventData;

      // IX-H6 fix: wait for block confirmations before processing
      const currentBlock = await this.provider.getBlockNumber();
      if (event.blockNumber + this.confirmations > currentBlock) {
        console.warn(
          `[${this.chainKey}] Event at block ${event.blockNumber} needs ${this.confirmations} confirmations (current: ${currentBlock}), waiting...`
        );
        await this.waitForConfirmations(event.blockNumber + this.confirmations);
      }

      const block = await event.getBlock();
      const tx = await event.getTransaction();

      const indexedEvent: IndexedEvent = {
        chainKey: this.chainKey,
        blockNumber: event.blockNumber,
        txHash: event.transactionHash,
        logIndex: event.index,
        type: eventData.type,
        commitment: eventData.commitment,
        nullifier: eventData.nullifier,
        amount: eventData.amount,
        token: eventData.token,
        leafIndex: eventData.leafIndex,
        recipient: eventData.recipient,
        timestamp: block.timestamp,
      };

      await this.processEvent(indexedEvent, tx.from, tx.to || undefined);

      await this.updateLastProcessedBlock(event.blockNumber);
    } catch (error) {
      console.error(`[${this.chainKey}] Error processing event:`, error);
    }
  }

  private async waitForConfirmations(targetBlock: number): Promise<void> {
    const maxWaitMs = 5 * 60 * 1000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const currentBlock = await this.provider.getBlockNumber();
      if (currentBlock >= targetBlock) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    console.warn(`[${this.chainKey}] Timed out waiting for confirmations at block ${targetBlock}`);
  }

  private async processEvent(
    event: IndexedEvent,
    fromAddress: string,
    toAddress?: string
  ): Promise<void> {
    const existingPayment = await prisma.payment.findUnique({
      where: {
        chainKey_txHash: {
          chainKey: event.chainKey,
          txHash: event.txHash,
        },
      },
    });

    if (existingPayment) {
      console.warn(`[${this.chainKey}] Event already processed: ${event.txHash}`);
      return;
    }

    const merchant = await this.findMerchantByPayment(fromAddress, toAddress);

    if (!merchant) {
      console.warn(`[${this.chainKey}] No merchant found for payment: ${event.txHash}`);
      return;
    }

    // IX-C1 fix: wrap payment creation + invoice update in a DB transaction
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const payment = await tx.payment.create({
        data: {
          merchantId: merchant.id,
          chainKey: event.chainKey,
          txHash: event.txHash,
          fromAddress,
          toAddress: toAddress || "",
          amount: event.amount,
          // IX-H4 fix: use actual token from event instead of hardcoded "ETH"
          tokenSymbol: event.token === ethers.ZeroAddress ? "ETH" : event.token,
          privacyLevel: event.commitment ? "max" : "standard",
          commitment: event.commitment,
          nullifier: event.nullifier,
          status: "confirmed",
          blockNumber: event.blockNumber,
        },
      });

      console.warn(`[${this.chainKey}] Payment recorded: ${payment.id}`);

      const invoice = await this.matchPaymentToInvoice(payment, tx);

      return { payment, invoice };
    });

    if (result.invoice) {
      const webhookPayload: WebhookPayload = {
        merchantId: merchant.id,
        eventType: "payment.received",
        timestamp: Date.now(),
        data: {
          invoiceId: result.invoice.id,
          paymentId: result.payment.id,
          chainKey: event.chainKey,
          txHash: event.txHash,
          amount: event.amount,
          tokenSymbol: event.token === ethers.ZeroAddress ? "ETH" : event.token,
          fromAddress,
          toAddress: toAddress || "",
          blockNumber: event.blockNumber,
        },
      };

      await enqueueWebhook(webhookPayload);
      console.warn(`[${this.chainKey}] Webhook queued for payment: ${result.payment.id}`);
    }
  }

  private async findMerchantByPayment(
    fromAddress: string,
    toAddress?: string
  ): Promise<{ id: string } | null> {
    const viewingKey = await prisma.chainViewingKey.findFirst({
      where: {
        chainKey: this.chainKey,
        settlementAddress: {
          in: [fromAddress.toLowerCase(), toAddress?.toLowerCase()].filter(Boolean) as string[],
        },
      },
      include: { merchant: true },
    });

    return viewingKey?.merchant || null;
  }

  // IX-H3 fix: match invoice by paymentAddress in addition to amount + merchant + chain
  private async matchPaymentToInvoice(
    payment: { merchantId: string; amount: string; chainKey: string; toAddress: string },
    tx?: Prisma.TransactionClient
  ): Promise<{ id: string } | null> {
    const db = tx || prisma;

    const invoice = await db.invoice.findFirst({
      where: {
        merchantId: payment.merchantId,
        chainKey: payment.chainKey,
        amount: payment.amount,
        status: "pending",
        expiresAt: { gte: new Date() },
        // IX-H3 fix: also match on paymentAddress (settlement address) to prevent wrong invoice matching
        ...(payment.toAddress
          ? {
              paymentAddress: {
                in: [
                  payment.toAddress,
                  payment.toAddress.toLowerCase(),
                  payment.toAddress.toUpperCase(),
                ],
              },
            }
          : {}),
      },
      orderBy: { createdAt: "asc" },
    });

    if (invoice) {
      await db.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "paid",
          paymentTxHash: payment.toAddress,
          paidAt: new Date(),
        },
      });
    }

    return invoice;
  }

  private async recoverFromCrash(): Promise<void> {
    const lastProcessed = await this.getLastProcessedBlock();
    const currentBlock = await this.provider.getBlockNumber();

    if (lastProcessed === 0) {
      const startBlock = currentBlock - 1000;
      await this.updateLastProcessedBlock(startBlock);
      console.warn(`[${this.chainKey}] Initialized at block ${startBlock}`);
      return;
    }

    const blocksToReplay = currentBlock - lastProcessed;
    if (blocksToReplay > 0 && blocksToReplay < 10000) {
      console.warn(`[${this.chainKey}] Recovering: replaying ${blocksToReplay} blocks`);
      await this.replayBlocks(lastProcessed + 1, currentBlock);
    } else if (blocksToReplay >= 10000) {
      console.warn(`[${this.chainKey}] Too many blocks to replay (${blocksToReplay}), skipping`);
      await this.updateLastProcessedBlock(currentBlock - this.confirmations);
    }
  }

  private async replayBlocks(fromBlock: number, toBlock: number): Promise<void> {
    if (!this.poolContract) {
      return;
    }

    const batchSize = 1000;
    for (let start = fromBlock; start <= toBlock; start += batchSize) {
      const end = Math.min(start + batchSize - 1, toBlock);

      try {
        const commitmentFilter = this.poolContract.filters.NewCommitment();
        const withdrawalFilter = this.poolContract.filters.Withdrawal();

        const [commitmentLogs, withdrawalLogs] = await Promise.all([
          this.poolContract.queryFilter(commitmentFilter, start, end),
          this.poolContract.queryFilter(withdrawalFilter, start, end),
        ]);

        for (const log of commitmentLogs) {
          if (!("args" in log)) continue;
          const args = log.args as unknown[];
          await this.handleEvent({
            type: "commitment",
            commitment: String(args[0]),
            token: String(args[1]),
            amount: (args[2] as bigint).toString(),
            leafIndex: Number(args[3]),
            event: log,
          });
        }
  
        for (const log of withdrawalLogs) {
          if (!("args" in log)) continue;
          const args = log.args as unknown[];
          await this.handleEvent({
            type: "withdrawal",
            nullifier: String(args[0]),
            recipient: String(args[1]),
            token: String(args[2]),
            amount: (args[3] as bigint).toString(),
            event: log,
          });
        }
      } catch (error) {
        console.error(`[${this.chainKey}] Error replaying blocks ${start}-${end}:`, error);
      }
    }

    await this.updateLastProcessedBlock(toBlock);
    console.warn(`[${this.chainKey}] Replay complete, now at block ${toBlock}`);
  }

  private async getLastProcessedBlock(): Promise<number> {
    const cacheKey = `veilpay:block:${this.chainKey}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return parseInt(cached, 10);
      }
    } catch (e) {
      console.error(`[${this.chainKey}] Redis read error:`, e);
    }

    const record = await prisma.processedBlock.findUnique({
      where: { chainKey: this.chainKey },
    });
    const bn = record?.blockNumber;
    if (bn == null) return 0;

    // Prisma's `BigInt` columns deserialise to a JS bigint; the legacy
    // BigNumber path here pre-dated bigint support and is no longer
    // reachable, but we keep the conversion explicit for readability.
    const blockNum = typeof bn === 'bigint' ? Number(bn) : Number(bn);

    try {
      await redis.set(cacheKey, blockNum.toString());
    } catch (e) {
      console.error(`[${this.chainKey}] Redis write error:`, e);
    }

    return blockNum;
  }

  private async updateLastProcessedBlock(blockNumber: number): Promise<void> {
    const cacheKey = `veilpay:block:${this.chainKey}`;
    try {
      await redis.set(cacheKey, blockNumber.toString());
    } catch (e) {
      console.error(`[${this.chainKey}] Redis write error:`, e);
    }

    // Fire and forget Prisma upsert to unblock the event loop.
    // Explicitly `void` the promise so `no-floating-promises` is happy
    // — the `.catch` already handles rejections, but the rule needs to
    // see the discard intention.
    void prisma.processedBlock
      .upsert({
        where: { chainKey: this.chainKey },
        update: { blockNumber: BigInt(blockNumber) },
        create: { chainKey: this.chainKey, blockNumber: BigInt(blockNumber) },
      })
      .catch((e) => console.error(`[${this.chainKey}] Async Prisma upsert error:`, e));
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[${this.chainKey}] Max reconnect attempts reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.warn(
      `[${this.chainKey}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.stop();
      await this.start();
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error(`[${this.chainKey}] Reconnect failed:`, error);
      // Fix: use setTimeout instead of recursive call to avoid stack overflow
      setTimeout(() => {
        void this.handleReconnect();
      }, 1000);
    }
  }
}

export async function startWebSocketIndexers(): Promise<Map<string, EVMWebSocketIndexer>> {
  const indexers = new Map<string, EVMWebSocketIndexer>();

  const chains = Object.keys(POOL_ADDRESSES).filter((key) => POOL_ADDRESSES[key]);

  for (const chainKey of chains) {
    const indexer = new EVMWebSocketIndexer({
      chainKey,
      poolAddress: POOL_ADDRESSES[chainKey],
      rpcUrl: RPC_ENDPOINTS[chainKey],
    });

    await indexer.start();
    indexers.set(chainKey, indexer);
  }

  return indexers;
}
