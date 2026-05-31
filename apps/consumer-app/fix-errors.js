const fs = require('fs');

function fix(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf-8');
  for (const {from, to} of replacements) {
    content = content.replace(from, to);
  }
  fs.writeFileSync(filePath, content);
}

// Fix transactionStore.ts
fix('src/stores/transactionStore.ts', [
  { from: /^import \{ useTransactionStore, useTransactions \} from '\.\.\/stores\/transactionStore';\n/m, to: '' }
]);

// useOnramp.ts
fix('src/hooks/useOnramp.ts', [
  { from: /const \{ address, setLatestOnrampOrder \} = useWalletStore\(\);/g, to: 'const { address } = useWalletStore();\n  const { setLatestOnrampOrder } = useTransactionStore();' },
  { from: /import \{ useWalletStore \} from '\.\.\/stores\/walletStore';/g, to: 'import { useWalletStore } from \'../stores/walletStore\';\nimport { useTransactionStore } from \'../stores/transactionStore\';' }
]);

// AppNavigator.tsx
fix('src/navigation/AppNavigator.tsx', [
  { from: /TransakFlow, /g, to: '' },
  { from: /import \{ useWalletStore \} from "\.\.\/stores\/walletStore";/g, to: 'import { useWalletStore } from "../stores/walletStore";\nimport { useTransactionStore } from "../stores/transactionStore";\nimport { TransakFlow } from "../stores/transactionStore";' },
  { from: /const \{ transactions \} = useWalletStore.getState\(\);/g, to: 'const { transactions } = useTransactionStore.getState();' }
]);

// DepositCryptoScreen.tsx
fix('src/screens/DepositCryptoScreen.tsx', [
  { from: /import \{ useWalletStore \} from "\.\.\/stores\/walletStore";/g, to: 'import { useWalletStore } from "../stores/walletStore";\nimport { useSettingsStore } from "../stores/settingsStore";' },
  { from: /const \{ address, activeChain, biometricsEnabled \} = useWalletStore\(\n\s*useShallow\(\(state\) => \(\{\n\s*address: state\.address,\n\s*activeChain: state\.activeChain,\n\s*biometricsEnabled: state\.biometricsEnabled,\n\s*\}\)\)\n\s*\);/g, to: 'const { address, activeChain } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain })));\n  const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);' }
]);

// ExportPrivateKeyScreen.tsx
fix('src/screens/ExportPrivateKeyScreen.tsx', [
  { from: /import \{ useWalletStore \} from '\.\.\/stores\/walletStore';/g, to: 'import { useWalletStore } from \'../stores/walletStore\';\nimport { useSettingsStore } from \'../stores/settingsStore\';' },
  { from: /const \{ biometricsEnabled, address, activeChain \} = useWalletStore\(\);/g, to: 'const { address, activeChain } = useWalletStore();\n  const { biometricsEnabled } = useSettingsStore();' }
]);

// HomeDashboardScreen.tsx
fix('src/screens/HomeDashboardScreen.tsx', [
  { from: /import \{ useWalletStore, SUPPORTED_CHAINS \} from "\.\.\/stores\/walletStore";/g, to: 'import { useWalletStore, SUPPORTED_CHAINS } from "../stores/walletStore";\nimport { useTransactionStore } from "../stores/transactionStore";' },
  { from: /const \{\n\s*address,\n\s*activeChain,\n\s*transactions,\n\s*isLoadingTransactions,\n\s*refreshTransactions,\n\s*latestTransakOrder,\n\s*latestOnrampOrder,\n\s*clearLatestTransakOrder,\n\s*clearLatestOnrampOrder,\n\s*\} = useWalletStore\(\n\s*useShallow\(\(state\) => \(\{\n\s*address: state\.address,\n\s*activeChain: state\.activeChain,\n\s*transactions: state\.transactions,\n\s*isLoadingTransactions: state\.isLoadingTransactions,\n\s*refreshTransactions: state\.refreshTransactions,\n\s*latestTransakOrder: state\.latestTransakOrder,\n\s*latestOnrampOrder: state\.latestOnrampOrder,\n\s*clearLatestTransakOrder: state\.clearLatestTransakOrder,\n\s*clearLatestOnrampOrder: state\.clearLatestOnrampOrder,\n\s*\}\)\)\n\s*\);/g, 
    to: 'const { address, activeChain } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain })));\n  const { transactions, isLoadingTransactions, refreshTransactions, latestTransakOrder, latestOnrampOrder, clearLatestTransakOrder, clearLatestOnrampOrder } = useTransactionStore(useShallow((state) => ({ transactions: state.transactions, isLoadingTransactions: state.isLoadingTransactions, refreshTransactions: state.refreshTransactions, latestTransakOrder: state.latestTransakOrder, latestOnrampOrder: state.latestOnrampOrder, clearLatestTransakOrder: state.clearLatestTransakOrder, clearLatestOnrampOrder: state.clearLatestOnrampOrder })));' },
  { from: /tx: any/g, to: 'tx: import("../types/transactions").TransactionRecord' }
]);

// PrivacyLevelScreen.tsx
fix('src/screens/PrivacyLevelScreen.tsx', [
  { from: /import \{ useWalletStore, PrivacyLevel \} from '\.\.\/stores\/walletStore';/g, to: 'import { useSettingsStore, PrivacyLevel } from \'../stores/settingsStore\';' },
  { from: /const \{ defaultPrivacyLevel, setPrivacyLevel \} = useWalletStore\(\);/g, to: 'const { defaultPrivacyLevel, setPrivacyLevel } = useSettingsStore();' }
]);

// SendPaymentScreen.tsx
fix('src/screens/SendPaymentScreen.tsx', [
  { from: /import \{ useWalletStore, validateAddress, ChainType \} from '\.\.\/stores\/walletStore';/g, to: 'import { useWalletStore, validateAddress, ChainType } from \'../stores/walletStore\';\nimport { useSettingsStore } from \'../stores/settingsStore\';' },
  { from: /const \{\n\s*address,\n\s*activeChain,\n\s*biometricsEnabled,\n\s*isProving,\n\s*setIsProving,\n\s*\} = useWalletStore\(\n\s*useShallow\(\(state\) => \(\{\n\s*address: state\.address,\n\s*activeChain: state\.activeChain,\n\s*biometricsEnabled: state\.biometricsEnabled,\n\s*isProving: state\.isProving,\n\s*setIsProving: state\.setIsProving,\n\s*\}\)\)\n\s*\);/g,
    to: 'const { address, activeChain, isProving, setIsProving } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain, isProving: state.isProving, setIsProving: state.setIsProving })));\n  const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);' }
]);

// SettingsScreen.tsx
fix('src/screens/SettingsScreen.tsx', [
  { from: /import \{ useWalletStore \} from '\.\.\/stores\/walletStore';/g, to: 'import { useWalletStore } from \'../stores/walletStore\';\nimport { useSettingsStore } from \'../stores/settingsStore\';' },
  { from: /const \{\n\s*biometricsEnabled,\n\s*notificationsEnabled,\n\s*analyticsEnabled,\n\s*defaultPrivacyLevel,\n\s*theme,\n\s*setBiometricsEnabled,\n\s*setNotificationsEnabled,\n\s*setAnalyticsEnabled,\n\s*setPrivacyLevel,\n\s*setTheme,\n\s*\} = useWalletStore\(\n\s*useShallow\(\(state\) => \(\{\n\s*biometricsEnabled: state\.biometricsEnabled,\n\s*notificationsEnabled: state\.notificationsEnabled,\n\s*analyticsEnabled: state\.analyticsEnabled,\n\s*defaultPrivacyLevel: state\.defaultPrivacyLevel,\n\s*theme: state\.theme,\n\s*setBiometricsEnabled: state\.setBiometricsEnabled,\n\s*setNotificationsEnabled: state\.setNotificationsEnabled,\n\s*setAnalyticsEnabled: state\.setAnalyticsEnabled,\n\s*setPrivacyLevel: state\.setPrivacyLevel,\n\s*setTheme: state\.setTheme,\n\s*\}\)\)\n\s*\);/g,
    to: 'const { biometricsEnabled, notificationsEnabled, analyticsEnabled, defaultPrivacyLevel, theme, setBiometricsEnabled, setNotificationsEnabled, setAnalyticsEnabled, setPrivacyLevel, setTheme } = useSettingsStore(useShallow((state) => ({ biometricsEnabled: state.biometricsEnabled, notificationsEnabled: state.notificationsEnabled, analyticsEnabled: state.analyticsEnabled, defaultPrivacyLevel: state.defaultPrivacyLevel, theme: state.theme, setBiometricsEnabled: state.setBiometricsEnabled, setNotificationsEnabled: state.setNotificationsEnabled, setAnalyticsEnabled: state.setAnalyticsEnabled, setPrivacyLevel: state.setPrivacyLevel, setTheme: state.setTheme })));' }
]);

// TransactionHistoryScreen.tsx
fix('src/screens/TransactionHistoryScreen.tsx', [
  { from: /import \{ useWalletStore \} from '\.\.\/stores\/walletStore';/g, to: 'import { useTransactionStore } from \'../stores/transactionStore\';' },
  { from: /const \{\n\s*transactions,\n\s*hasMoreTransactions,\n\s*isLoadingTransactions,\n\s*transactionsError,\n\s*refreshTransactions,\n\s*loadMoreTransactions,\n\s*\} = useWalletStore\(\n\s*useShallow\(\(state\) => \(\{\n\s*transactions: state\.transactions,\n\s*hasMoreTransactions: state\.hasMoreTransactions,\n\s*isLoadingTransactions: state\.isLoadingTransactions,\n\s*transactionsError: state\.transactionsError,\n\s*refreshTransactions: state\.refreshTransactions,\n\s*loadMoreTransactions: state\.loadMoreTransactions,\n\s*\}\)\)\n\s*\);/g,
    to: 'const { transactions, hasMoreTransactions, isLoadingTransactions, transactionsError, refreshTransactions, loadMoreTransactions } = useTransactionStore(useShallow((state) => ({ transactions: state.transactions, hasMoreTransactions: state.hasMoreTransactions, isLoadingTransactions: state.isLoadingTransactions, transactionsError: state.transactionsError, refreshTransactions: state.refreshTransactions, loadMoreTransactions: state.loadMoreTransactions })));' },
  { from: /tx: any/g, to: 'tx: import("../types/transactions").TransactionRecord' }
]);

// TransakWebViewScreen.tsx
fix('src/screens/TransakWebViewScreen.tsx', [
  { from: /import \{ useWalletStore, TransakOrderStatus \} from '\.\.\/stores\/walletStore';/g, to: 'import { useTransactionStore, TransakOrderStatus } from \'../stores/transactionStore\';' }
]);

// WithdrawFiatScreen.tsx
fix('src/screens/WithdrawFiatScreen.tsx', [
  { from: /import \{ useWalletStore \} from "\.\.\/stores\/walletStore";/g, to: 'import { useWalletStore } from "../stores/walletStore";\nimport { useSettingsStore } from "../stores/settingsStore";' },
  { from: /const \{ address, activeChain, biometricsEnabled \} = useWalletStore\(\n\s*useShallow\(\(state\) => \(\{\n\s*address: state\.address,\n\s*activeChain: state\.activeChain,\n\s*biometricsEnabled: state\.biometricsEnabled,\n\s*\}\)\)\n\s*\);/g,
    to: 'const { address, activeChain } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain })));\n  const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);' }
]);

// walletStore.test.ts
fix('src/stores/__tests__/walletStore.test.ts', [
  { from: /import \{ useSettingsStore \} from '\.\.\/stores\/settingsStore';/g, to: 'import { useSettingsStore } from \'../settingsStore\';' },
  { from: /import \{ useTransactionStore \} from '\.\.\/stores\/transactionStore';/g, to: 'import { useTransactionStore } from \'../transactionStore\';' },
  { from: /import \{ useWalletStore \} from '\.\.\/walletStore';/g, to: 'import { useWalletStore } from \'../walletStore\';\nimport { useSettingsStore } from \'../settingsStore\';\nimport { useTransactionStore } from \'../transactionStore\';' }
]);

console.log('Fixed imports manually.');
