/**
 * Well-known ERC-20 (and similar) token contract addresses used to bind invoice
 * token identity beyond a spoofable `symbol()` string (Pass B / SEC-012 residual).
 *
 * Keys are lowercase chainKey → uppercase symbol → checksummed address.
 * Merchants may still supply an explicit `tokenAddress` on invoice create; the
 * registry is the default when symbol matches a known asset.
 */

const REGISTRY: Record<string, Record<string, string>> = {
  ethereum: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  sepolia: {
    // Common public test tokens — override via invoice.tokenAddress in real deploys.
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  polygon: {
    USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  },
  arbitrum: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  optimism: {
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  bsc: {
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    DAI: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  },
  // SPL mints (base58)
  solana: {
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
  // Stellar classic asset issuers (G…)
  stellar: {
    USDC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  'stellar-testnet': {
    USDC: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
};

/** Native asset symbols that never use a token contract. */
export const NATIVE_TOKEN_SYMBOLS = new Set([
  'ETH',
  'MATIC',
  'POL',
  'BNB',
  'AVAX',
  'SOL',
  'XLM',
]);

export function isNativeTokenSymbol(symbol: string): boolean {
  return NATIVE_TOKEN_SYMBOLS.has(symbol.trim().toUpperCase());
}

/**
 * Resolve the expected ERC-20 contract for (chainKey, symbol), or null if
 * unknown / native. Address comparison should be case-insensitive.
 */
export function resolveTokenAddress(
  chainKey: string,
  tokenSymbol: string
): string | null {
  if (isNativeTokenSymbol(tokenSymbol)) return null;
  const byChain = REGISTRY[chainKey.trim().toLowerCase()];
  if (!byChain) return null;
  return byChain[tokenSymbol.trim().toUpperCase()] ?? null;
}

/**
 * Prefer an explicit invoice-stored address; fall back to the registry.
 */
export function expectedTokenAddressForInvoice(args: {
  chainKey: string;
  tokenSymbol: string;
  tokenAddress?: string | null;
}): string | null {
  const explicit = args.tokenAddress?.trim();
  if (explicit) return explicit;
  return resolveTokenAddress(args.chainKey, args.tokenSymbol);
}
