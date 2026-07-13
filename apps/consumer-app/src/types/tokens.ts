export type ChainTypeKey = 'evm' | 'svm' | 'xlm';

/** Protocol behind a privacy-pool asset row (Token Selector / Home). */
export type PrivacyProtocolKey = 'spp' | 'veil-pool';

export interface PaymentToken {
  id: string;
  name: string;
  symbol: string;
  balance: string;
  usdPrice: number;
  chainTypes: ChainTypeKey[];
  icon?: string;
  /** EVM contract, Solana mint, or Stellar classic **issuer** G… key. */
  address?: string;
  decimals?: number;
  /** Optional secondary line (e.g. truncated Stellar issuer). */
  subtitle?: string;
  /**
   * When true, this row is a privacy-pool asset (e.g. Private XLM / SPP),
   * not a transparent chain token. Home balance/actions adapt when selected.
   */
  isPrivacyAsset?: boolean;
  privacyProtocol?: PrivacyProtocolKey;
  /** Catalog id, e.g. `spp-xlm-testnet`. */
  privacyAssetId?: string;
  privacyChainKey?: string;
  privacyEnabled?: boolean;
  privacyDisabledReason?: string;
  privacySubtitle?: string;
}

