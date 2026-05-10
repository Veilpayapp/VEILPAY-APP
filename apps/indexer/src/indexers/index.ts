import { JsonRpcProvider, Contract } from "ethers";
import { prisma } from "../lib/prisma";
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
    this.poolAddress = POOL_ADDRESSES[chainKey] || "";

    if (!this.poolAddress) {
      console.warn(`[${chainKey}] No pool address configured`);
    }
  }

  async getLastProcessedBlock(): Promise<number> {
    const record = await prisma.processedBlock.findUnique({
      where: { chainKey: this.chainKey },
    });
    const bn = record?.blockNumber;
    if (bn == null) return 0;
    return typeof bn === 'bigint' ? Number(bn) : (bn as any).toNumber();
  }

  async setLastProcessedBlock(blockNumber: number): Promise<void> {
    await prisma.processedBlock.upsert({
      where: { chainKey: this.chainKey },
      update: { blockNumber: BigInt(blockNumber) },
      create: { chainKey: this.chainKey, blockNumber: BigInt(blockNumber) },
    });
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

    console.log(`[${this.chainKey}] Indexing blocks ${fromBlock} to ${toBlock}`);

    const poolContract = new Contract(this.poolAddress, VEIL_POOL_ABI, this.provider);
    const events: IndexedEvent[] = [];

    const commitmentFilter = poolContract.filters.NewCommitment();
    const withdrawalFilter = poolContract.filters.Withdrawal();

    try {
      const commitmentLogs = await poolContract.queryFilter(commitmentFilter, fromBlock, toBlock);

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
      console.log(`[${this.chainKey}] Indexed ${events.length} events`);
    } catch (error) {
      console.error(`[${this.chainKey}] Indexing error:`, error);
    }

    return events;
  }
}

export class SolanaIndexer {
  private chainKey = "solana";

  async indexNewBlocks(): Promise<IndexedEvent[]> {
    console.log(`[${this.chainKey}] Solana indexing not yet implemented`);
    return [];
  }
}

export class AptosIndexer {
  private chainKey = "aptos";

  async indexNewBlocks(): Promise<IndexedEvent[]> {
    console.log(`[${this.chainKey}] Aptos indexing not yet implemented`);
    return [];
  }
}

export async function runIndexers() {
  const evmChains = ["sepolia"];

  for (const chainKey of evmChains) {
    if (POOL_ADDRESSES[chainKey]) {
      const indexer = new EVMIndexer(chainKey);
      await indexer.indexNewBlocks();
    }
  }

  if (config.indexSolana) {
    const solanaIndexer = new SolanaIndexer();
    await solanaIndexer.indexNewBlocks();
  }

  if (config.indexAptos) {
    const aptosIndexer = new AptosIndexer();
    await aptosIndexer.indexNewBlocks();
  }
}
