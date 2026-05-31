import { JsonRpcProvider, Contract } from "ethers";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { config } from "../config";

const VEIL_POOL_ABI = [
  "event NewCommitment(bytes32 indexed commitment, address indexed token, uint256 amount, uint256 leafIndex)",
  "event Withdrawal(bytes32 indexed nullifier, address indexed recipient, address indexed token, uint256 amount)",
];

const RPC_ENDPOINTS: Record<string, string> = {
  ethereum: process.env.RPC_ETHEREUM || "https://eth.llamarpc.com",
  polygon: process.env.RPC_POLYGON || "https://polygon.llamarpc.com",
  arbitrum: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
  sepolia: "https://rpc.sepolia.org",
};

const POOL_ADDRESSES: Record<string, string> = {
  sepolia: process.env.POOL_SEPOLIA || "",
};

export interface IndexedEvent {
  chainKey: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  type: "commitment" | "withdrawal";
  commitment?: string;
  nullifier?: string;
  amount: string;
  token: string;
  leafIndex?: number;
  recipient?: string;
  timestamp: number;
}

export class EVMIndexer {
  private provider: JsonRpcProvider;
  private chainKey: string;
  private poolAddress: string;

  constructor(chainKey: string) {
    const rpcUrl = RPC_ENDPOINTS[chainKey];
    if (!rpcUrl) {
      throw new Error(`No RPC endpoint for chain: ${chainKey}`);
    }

    this.chainKey = chainKey;
    this.provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
    
    let defaultPool = "";
    if (chainKey === "sepolia") defaultPool = process.env.POOL_SEPOLIA || "";
    this.poolAddress = defaultPool;

    if (!this.poolAddress) {
      console.warn(`[${chainKey}] No pool address configured`);
    }
  }

  async getLastProcessedBlock(): Promise<number> {
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

    // `processedBlock.blockNumber` is `BigInt` in the Prisma schema; the
    // ternary kept around the legacy non-bigint path defensively.
    const blockNum = typeof bn === 'bigint' ? Number(bn) : Number(bn);

    try {
      await redis.set(cacheKey, blockNum.toString());
    } catch (e) {
      console.error(`[${this.chainKey}] Redis write error:`, e);
    }

    return blockNum;
  }

  async setLastProcessedBlock(blockNumber: number): Promise<void> {
    const cacheKey = `veilpay:block:${this.chainKey}`;
    try {
      await redis.set(cacheKey, blockNumber.toString());
    } catch (e) {
      console.error(`[${this.chainKey}] Redis write error:`, e);
    }

    // Fire and forget Prisma upsert. `void` marks the discarded promise
    // so `no-floating-promises` is satisfied — the .catch handles
    // rejections.
    void prisma.processedBlock
      .upsert({
        where: { chainKey: this.chainKey },
        update: { blockNumber: BigInt(blockNumber) },
        create: { chainKey: this.chainKey, blockNumber: BigInt(blockNumber) },
      })
      .catch((e) => console.error(`[${this.chainKey}] Async Prisma upsert error:`, e));
  }

  async indexNewBlocks(): Promise<IndexedEvent[]> {
    if (!this.poolAddress) {
      return [];
    }

    const lastBlock = await this.getLastProcessedBlock();
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(lastBlock + 1, currentBlock - 1000);
    const toBlock = currentBlock;

    if (fromBlock > toBlock) {
      return [];
    }

    console.warn(`[${this.chainKey}] Indexing blocks ${fromBlock} to ${toBlock}`);

    const poolContract = new Contract(this.poolAddress, VEIL_POOL_ABI, this.provider);
    const events: IndexedEvent[] = [];

    const commitmentFilter = poolContract.filters.NewCommitment();
    const withdrawalFilter = poolContract.filters.Withdrawal();

    try {
      const commitmentLogs = await poolContract.queryFilter(commitmentFilter, fromBlock, toBlock);
      console.warn('Got commitmentLogs:', commitmentLogs);
      for (const log of commitmentLogs) {
        if (!("args" in log)) continue;
        const block = await log.getBlock();
        const args = log.args as unknown[];
        events.push({
          chainKey: this.chainKey,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.index,
          type: "commitment",
          commitment: String(args[0]),
          amount: (args[2] as bigint).toString(),
          token: String(args[1]),
          leafIndex: Number(args[3]),
          timestamp: block.timestamp,
        });
      }

      const withdrawalLogs = await poolContract.queryFilter(withdrawalFilter, fromBlock, toBlock);

      for (const log of withdrawalLogs) {
        if (!("args" in log)) continue;
        const block = await log.getBlock();
        const args = log.args as unknown[];
        events.push({
          chainKey: this.chainKey,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.index,
          type: "withdrawal",
          nullifier: String(args[0]),
          recipient: String(args[1]),
          token: String(args[2]),
          amount: (args[3] as bigint).toString(),
          timestamp: block.timestamp,
        });
      }

      await this.setLastProcessedBlock(toBlock);
      console.warn(`[${this.chainKey}] Indexed ${events.length} events`);
    } catch (error) {
      console.error(`[${this.chainKey}] Indexing error:`, error);
    }

    return events;
  }
}

export class SolanaIndexer {
  private chainKey = "solana";

  indexNewBlocks(): IndexedEvent[] {
    console.warn(`[${this.chainKey}] Solana indexing not yet implemented`);
    return [];
  }
}

export class AptosIndexer {
  private chainKey = "aptos";

  indexNewBlocks(): IndexedEvent[] {
    console.warn(`[${this.chainKey}] Aptos indexing not yet implemented`);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function runIndexers() {
  const evmChains = ["sepolia"];

  for (const chainKey of evmChains) {
    if (POOL_ADDRESSES[chainKey]) {
      const indexer = new EVMIndexer(chainKey);
      await indexer.indexNewBlocks();
    }
  }

  // Solana / Aptos indexers are currently no-op stubs that return
  // synchronously. `await` on a non-Promise is harmless at runtime but
  // the rule rightly flags it; call them directly instead.
  if (config.indexSolana) {
    const solanaIndexer = new SolanaIndexer();
    solanaIndexer.indexNewBlocks();
  }

  if (config.indexAptos) {
    const aptosIndexer = new AptosIndexer();
    aptosIndexer.indexNewBlocks();
  }
}
