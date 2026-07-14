/**
 * LOC-001: default locale catalog (en-US).
 *
 * Keys are stable message ids. Values are the English source strings.
 * Prefer adding keys here before hardcoding new user-facing copy so
 * future locales can plug in without another source sweep.
 */
export const enUS = {
  // App / chrome
  'app.name': 'VeilPay',

  // Onboarding
  'onboarding.headline': 'PRIVATE PAYMENTS,\nFULLY YOURS.',
  'onboarding.badge': 'SECURE THE VOID.',
  'onboarding.getStarted': 'GET STARTED',
  'onboarding.restoreVault': 'RESTORE EXISTING VAULT',
  'onboarding.a11y.getStarted': 'Get started',
  'onboarding.a11y.restoreVault': 'Restore existing vault',

  // Wallet connect
  'walletConnect.headline': 'CHOOSE CONNECTION METHOD',
  'walletConnect.create': 'CREATE NEW WALLET',
  'walletConnect.import': 'IMPORT EXISTING',
  'walletConnect.a11y.create': 'Create new wallet',
  'walletConnect.a11y.import': 'Import existing wallet',

  // Home quick actions
  'home.action.send': 'SEND',
  'home.action.receive': 'RECEIVE',
  'home.action.scan': 'SCAN',
  'home.a11y.send': 'Send payment',
  'home.a11y.receive': 'Receive payment',

  // Send
  'send.title': 'SEND PAYMENT',
  'send.amount': 'AMOUNT',
  'send.continue': 'CONTINUE',
  'send.a11y.recipient': 'Recipient address',
  'send.a11y.amount': 'Payment amount',
  'send.a11y.continue': 'Continue to payment confirmation',

  // Settings / privacy (DSAR)
  'settings.title': 'SETTINGS',
  'settings.dsar.analytics': 'Delete analytics data',
  'settings.dsar.analyticsDescription': 'Erase local analytics identity (DSAR)',
  'settings.wipe.label': 'Erase all local data',
  'settings.wipe.description': 'Wipe wallet keys, history, and analytics on this device (DSAR)',
  'settings.wipe.confirmTitle': 'Erase all local data?',
  'settings.wipe.confirmMessage':
    'This permanently removes the seed phrase, wallet session, local history, and analytics identity from this device. You will need your recovery phrase to restore. This cannot be undone.',
  'settings.wipe.confirmAction': 'ERASE EVERYTHING',
  'settings.wipe.success': 'Local account data erased',
  'settings.wipe.failure': 'Failed to erase local data securely. Please try again.',
} as const;

export type MessageId = keyof typeof enUS;
export type MessageCatalog = Record<MessageId, string>;
