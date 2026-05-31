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
import branded_base from '@web3icons/core/svgs/networks/branded/base.svg.js';
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
import branded_stellar from '@web3icons/core/svgs/networks/branded/stellar.svg.js';
import branded_hyperevm from '@web3icons/core/svgs/networks/branded/hyper-evm.svg.js';

export interface NetworkIconProps {
  size?: number;
}

/**
 * Build a per-chain icon Component from a brand-official SVG string. The
 * resulting component renders at any caller-provided pixel size; the
 * underlying SVG keeps its native viewBox and scales proportionally.
 */
function makeBrandedIcon(svg: string) {
  const Icon = ({ size = 24 }: NetworkIconProps) => (
    <SvgXml xml={svg} width={size} height={size} />
  );
  return Icon;
}

export const EthereumIcon = makeBrandedIcon(branded_ethereum);
export const BaseIcon = makeBrandedIcon(branded_base);
export const ArbitrumIcon = makeBrandedIcon(branded_arbitrum);
export const OptimismIcon = makeBrandedIcon(branded_optimism);
export const PolygonIcon = makeBrandedIcon(branded_polygon);
export const BnbIcon = makeBrandedIcon(branded_bnb);
export const SolanaIcon = makeBrandedIcon(branded_solana);
export const BitcoinIcon = makeBrandedIcon(branded_bitcoin);
export const TronIcon = makeBrandedIcon(branded_tron);
export const AvalancheIcon = makeBrandedIcon(branded_avalanche);
export const LineaIcon = makeBrandedIcon(branded_linea);
export const AptosIcon = makeBrandedIcon(branded_aptos);
export const StellarIcon = makeBrandedIcon(branded_stellar);
export const HyperEVMIcon = makeBrandedIcon(branded_hyperevm);

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
export const DefaultNetworkIcon = makeBrandedIcon(DEFAULT_NETWORK_SVG);

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
