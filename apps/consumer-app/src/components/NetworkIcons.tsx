import React from 'react';
import { SvgXml } from 'react-native-svg';

/**
 * Brand-official network icons sourced from @web3icons/core (Apache-2.0).
 *
 * Each chain points at one of the maintainer's branded SVG strings; we render
 * them via react-native-svg's <SvgXml> so we don't need a Metro transformer.
 * The component API is intentionally identical to the previous in-house set:
 * `getNetworkIcon(chainKey)` returns a Component accepting `{ size }`, and
 * each per-chain icon (EthereumIcon, BaseIcon, ...) is exported by name.
 *
 * Why @web3icons/core instead of inline path data:
 *   - Logos are sourced from each chain's brand kit, not redrawn from memory.
 *   - Updates ship upstream when chains rebrand, no app PR required.
 *   - One canonical mark per chain; matches what other wallets show today.
 *
 * Why <SvgXml> rather than the svg-transformer Metro plugin:
 *   - Zero Metro config changes.
 *   - The `.svg.js` files in @web3icons/core export the raw SVG markup as a
 *     plain string default export, which SvgXml renders directly.
 */

import branded_ethereum from '@web3icons/core/svgs/networks/branded/ethereum.svg.js';
// The upstream web3icons base logo is missing its inner cutout and just renders as a solid square.
// We override it here with the correct Base brand logo (blue circle with inner white ring).
const CORRECTED_BASE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <circle cx="16" cy="16" r="16" fill="#0052FF" />
  <circle cx="16" cy="16" r="6.5" stroke="white" stroke-width="4.5" fill="none" />
</svg>
`;
import branded_arbitrum from '@web3icons/core/svgs/networks/branded/arbitrum-one.svg.js';
import branded_optimism from '@web3icons/core/svgs/networks/branded/optimism.svg.js';
import branded_polygon from '@web3icons/core/svgs/networks/branded/polygon.svg.js';
import branded_bnb from '@web3icons/core/svgs/networks/branded/binance-smart-chain.svg.js';
import branded_solana from '@web3icons/core/svgs/networks/branded/solana.svg.js';
import branded_bitcoin from '@web3icons/core/svgs/networks/branded/bitcoin.svg.js';
import branded_tron from '@web3icons/core/svgs/networks/branded/tron.svg.js';
import branded_avalanche from '@web3icons/core/svgs/networks/branded/avalanche.svg.js';
import branded_linea from '@web3icons/core/svgs/networks/branded/linea.svg.js';
import branded_aptos from '@web3icons/core/svgs/networks/branded/aptos.svg.js';
// Override Stellar logo because the web3icons version hardcodes fill="#000" which is invisible on dark backgrounds.
const CORRECTED_STELLAR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24">
  <path fill="currentColor" d="M5.826 12.849A6.7 6.7 0 0 1 6.6 8.772a6.4 6.4 0 0 1 2.255-2.374 6.04 6.04 0 0 1 3.088-.892 6.03 6.03 0 0 1 3.105.825l1.426-.758a7.35 7.35 0 0 0-7.933-.648 7.75 7.75 0 0 0-3.035 2.928 8.2 8.2 0 0 0-1.1 4.753c.022.283-.039.567-.173.817-.134.249-.335.45-.579.58L3 14.35v1.622l18-9.566v-1.62zM21 8.03 6.79 15.576 3 17.59v1.621l15.178-8.065q.053.425.053.855a6.7 6.7 0 0 1-.827 3.232 6.4 6.4 0 0 1-2.258 2.375c-.931.57-2 .879-3.092.89a6.03 6.03 0 0 1-3.107-.83l-.076.042-1.345.715a7.43 7.43 0 0 0 3.878 1.49 7.35 7.35 0 0 0 4.054-.841 7.75 7.75 0 0 0 3.035-2.925 8.2 8.2 0 0 0 1.1-4.759c-.02-.283.04-.566.174-.816a1.4 1.4 0 0 1 .578-.58L21 9.647z"/>
</svg>
`;
import branded_hyperevm from '@web3icons/core/svgs/networks/branded/hyper-evm.svg.js';

export interface NetworkIconProps {
  size?: number;
}

/**
 * Build a per-chain icon Component from a brand-official SVG string. The
 * resulting component renders at any caller-provided pixel size; the
 * underlying SVG keeps its native viewBox and scales proportionally.
 */
function makeBrandedIcon(svgInput: any) {
  const svgString = typeof svgInput === 'string' ? svgInput : (svgInput?.default || '');
  const Icon = ({ size = 24 }: NetworkIconProps) => (
    <SvgXml xml={svgString} width={size} height={size} />
  );
  return Icon;
}

const EthereumIcon = makeBrandedIcon(branded_ethereum);
const BaseIcon = makeBrandedIcon(CORRECTED_BASE_SVG);
const ArbitrumIcon = makeBrandedIcon(branded_arbitrum);
const OptimismIcon = makeBrandedIcon(branded_optimism);
const PolygonIcon = makeBrandedIcon(branded_polygon);
const BnbIcon = makeBrandedIcon(branded_bnb);
const SolanaIcon = makeBrandedIcon(branded_solana);
const BitcoinIcon = makeBrandedIcon(branded_bitcoin);
const TronIcon = makeBrandedIcon(branded_tron);
const AvalancheIcon = makeBrandedIcon(branded_avalanche);
const LineaIcon = makeBrandedIcon(branded_linea);
const AptosIcon = makeBrandedIcon(branded_aptos);
const StellarIcon = makeBrandedIcon(CORRECTED_STELLAR_SVG);
const HyperEVMIcon = makeBrandedIcon(branded_hyperevm);

/**
 * Neutral compass fallback for unknown chains. Stays inline so we never crash
 * on a chainKey that isn't covered by @web3icons/core.
 */
const DEFAULT_NETWORK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="10" fill="#3A3A3C"/>
  <circle cx="16" cy="16" r="6" stroke="#FFFFFF" stroke-width="2" fill="none"/>
  <path d="M16 5V9M16 23V27M5 16H9M23 16H27M8.5 8.5L11.5 11.5M20.5 20.5L23.5 23.5M23.5 8.5L20.5 11.5M11.5 20.5L8.5 23.5"
    stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round"/>
</svg>
`;
const DefaultNetworkIcon = makeBrandedIcon(DEFAULT_NETWORK_SVG);

export const getNetworkIcon = (chainKey: string) => {
  const normalized = chainKey.toLowerCase();
  switch (normalized) {
    case 'ethereum':
    case 'eth':
    case 'sepolia':
      return EthereumIcon;
    case 'linea':
      return LineaIcon;
    case 'base':
      return BaseIcon;
    case 'arbitrum':
    case 'arb':
    case 'arbitrum-one':
      return ArbitrumIcon;
    case 'bsc':
    case 'bnb':
    case 'bnb chain':
    case 'binance-smart-chain':
      return BnbIcon;
    case 'optimism':
    case 'op':
      return OptimismIcon;
    case 'polygon':
    case 'matic':
      return PolygonIcon;
    case 'bitcoin':
    case 'btc':
      return BitcoinIcon;
    case 'solana':
    case 'sol':
    case 'solana-devnet':
    case 'solana-mainnet':
      return SolanaIcon;
    case 'tron':
    case 'trx':
      return TronIcon;
    case 'avalanche':
    case 'avax':
      return AvalancheIcon;
    case 'aptos':
    case 'aptos-mainnet':
      return AptosIcon;
    case 'stellar':
    case 'stellar-mainnet':
    case 'stellar-testnet':
    case 'xlm':
      return StellarIcon;
    case 'hyperevm':
    case 'hyperliquid':
    case 'hyper-evm':
      return HyperEVMIcon;
    default:
      return DefaultNetworkIcon;
  }
};
