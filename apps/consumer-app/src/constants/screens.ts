/**
 * Veilpay Screen Navigation Constants
 * Centralized screen names for type-safe navigation
 */

/**
 * Screen names for navigation
 * Use these constants instead of string literals to prevent typos
 * and enable IDE autocomplete
 */
export const SCREENS = {
  // Priority 1: Core Flow
  ONBOARDING: 'Onboarding',
  WALLET_CONNECT: 'WalletConnect',
  HOME: 'Home',
  SEND_PAYMENT: 'SendPayment',
  PRIVACY_LEVEL: 'PrivacyLevel',
  PAYMENT_CONFIRMATION: 'PaymentConfirmation',
  PAYMENT_SUCCESS: 'PaymentSuccess',

  // Priority 2: Wallet Management
  CREATE_WALLET: 'CreateWallet',
  VERIFY_WALLET: 'VerifyWallet',
  IMPORT_WALLET: 'ImportWallet',
  SET_PASSWORD: 'SetPassword',
  BIOMETRIC_SETUP: 'BiometricSetup',
  RECEIVE_QR: 'ReceiveQR',
  BACKUP_WALLET: 'BackupWallet',
  EXPORT_PRIVATE_KEY: 'ExportPrivateKey',

  // Priority 3: Supporting Screens
  TOKEN_SELECTOR: 'TokenSelector',
  QR_SCANNER: 'QRScanner',

  // Priority 4: History & Settings
  TRANSACTION_HISTORY: 'TransactionHistory',
  TRANSACTION_DETAILS: 'TransactionDetails',
  TOKEN_DETAIL: 'TokenDetail',
  SETTINGS: 'Settings',
  ADD_CUSTOM_NETWORK: 'AddCustomNetwork',

  // Priority 5: Fiat On/Off Ramps
  DEPOSIT_CRYPTO: 'DepositCrypto',
  WITHDRAW_FIAT: 'WithdrawFiat',
  TRANSAK_WEBVIEW: 'TransakWebView',
  ONRAMP_WIDGET: 'OnrampWidget',
  ONRAMP_AMOUNT: 'OnrampAmount',
  ONRAMP_QUOTES: 'OnrampQuotes',
  OFFRAMP_QUOTES: 'OfframpQuotes',
} as const;

/**
 * Helper type for navigation
 * Extracts all screen names from SCREENS constant
 */
export type ScreenName = typeof SCREENS[keyof typeof SCREENS];

/**
 * Screen display names for UI
 * Strongly typed to ensure all screens have titles
 */
export const SCREEN_TITLES: Record<ScreenName, string> = {
  [SCREENS.ONBOARDING]: 'Welcome',
  [SCREENS.WALLET_CONNECT]: 'Connect Wallet',
  [SCREENS.HOME]: 'Home',
  [SCREENS.SEND_PAYMENT]: 'Send Payment',
  [SCREENS.PRIVACY_LEVEL]: 'Privacy Level',
  [SCREENS.PAYMENT_CONFIRMATION]: 'Confirm Payment',
  [SCREENS.PAYMENT_SUCCESS]: 'Payment Sent',
  [SCREENS.CREATE_WALLET]: 'Create Wallet',
  [SCREENS.VERIFY_WALLET]: 'Verify Phrase',
  [SCREENS.IMPORT_WALLET]: 'Import Wallet',
  [SCREENS.SET_PASSWORD]: 'Set Cipher',
  [SCREENS.BIOMETRIC_SETUP]: 'Biometric Setup',
  [SCREENS.RECEIVE_QR]: 'Receive',
  [SCREENS.BACKUP_WALLET]: 'Backup Wallet',
  [SCREENS.EXPORT_PRIVATE_KEY]: 'Export Private Key',
  [SCREENS.TOKEN_SELECTOR]: 'Select Token',
  [SCREENS.QR_SCANNER]: 'Scan QR Code',
  [SCREENS.TRANSACTION_HISTORY]: 'History',
  [SCREENS.TRANSACTION_DETAILS]: 'Transaction',
  [SCREENS.TOKEN_DETAIL]: 'Token Detail',
  [SCREENS.SETTINGS]: 'Settings',
  [SCREENS.ADD_CUSTOM_NETWORK]: 'Add Network',
  [SCREENS.DEPOSIT_CRYPTO]: 'Deposit',
  [SCREENS.WITHDRAW_FIAT]: 'Withdraw',
  [SCREENS.TRANSAK_WEBVIEW]: 'Transak',
  [SCREENS.ONRAMP_WIDGET]: 'Onramp',
  [SCREENS.ONRAMP_AMOUNT]: 'Buy Crypto',
  [SCREENS.ONRAMP_QUOTES]: 'Compare Providers',
  [SCREENS.OFFRAMP_QUOTES]: 'Sell Crypto',
} as const;

/**
 * Navigation parameter types for screens that need params
 */
export type NavigationParams = {
  // Add parameter types as screens are implemented
  // Example:
  // [SCREENS.TRANSACTION_DETAILS]: { transactionId: string };
  // [SCREENS.SEND_PAYMENT]: { recipientAddress?: string; amount?: string };
};
