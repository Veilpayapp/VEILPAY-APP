const fs = require('fs');

function replaceStr(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf-8');
  for (const {from, to} of replacements) {
    if (typeof from === 'string') {
      content = content.replace(from, to);
    } else {
      content = content.replace(from, to);
    }
  }
  fs.writeFileSync(filePath, content);
}

// src/hooks/useOnramp.ts
replaceStr('src/hooks/useOnramp.ts', [
  { from: `import { useWalletStore } from '../stores/walletStore';`, to: `import { useWalletStore } from '../stores/walletStore';\nimport { useTransactionStore } from '../stores/transactionStore';` },
  { from: `const { address, setLatestOnrampOrder } = useWalletStore();`, to: `const { address } = useWalletStore();\n  const setLatestOnrampOrder = useTransactionStore(s => s.setLatestOnrampOrder);` }
]);

// src/navigation/AppNavigator.tsx
replaceStr('src/navigation/AppNavigator.tsx', [
  { from: `import { useWalletStore, TransakFlow } from "../stores/walletStore";`, to: `import { useWalletStore } from "../stores/walletStore";\nimport { useTransactionStore, TransakFlow } from "../stores/transactionStore";` },
  { from: `const { transactions } = useWalletStore.getState();`, to: `const { transactions } = useTransactionStore.getState();` }
]);

// src/screens/DepositCryptoScreen.tsx
replaceStr('src/screens/DepositCryptoScreen.tsx', [
  { from: `import { useWalletStore } from "../stores/walletStore";`, to: `import { useWalletStore } from "../stores/walletStore";\nimport { useSettingsStore } from "../stores/settingsStore";` },
  { from: `const { address, activeChain, biometricsEnabled } = useWalletStore(`, to: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const { address, activeChain } = useWalletStore(` },
  { from: `biometricsEnabled: state.biometricsEnabled,\n`, to: `` },
  { from: `biometricsEnabled,\n`, to: `` }
]);

// src/screens/ExportPrivateKeyScreen.tsx
replaceStr('src/screens/ExportPrivateKeyScreen.tsx', [
  { from: `import { useWalletStore } from '../stores/walletStore';`, to: `import { useWalletStore } from '../stores/walletStore';\nimport { useSettingsStore } from '../stores/settingsStore';` },
  { from: `const { biometricsEnabled, address, activeChain } = useWalletStore();`, to: `const { address, activeChain } = useWalletStore();\n  const { biometricsEnabled } = useSettingsStore();` }
]);

// src/screens/HomeDashboardScreen.tsx
replaceStr('src/screens/HomeDashboardScreen.tsx', [
  { from: `import { useWalletStore, SUPPORTED_CHAINS } from "../stores/walletStore";`, to: `import { useWalletStore, SUPPORTED_CHAINS } from "../stores/walletStore";\nimport { useTransactionStore } from "../stores/transactionStore";` },
  { from: `  const {
    address,
    activeChain,
    setActiveChain,
    balance,
    balanceUsd,
    transactions,
    isLoadingTransactions,
    refreshTransactions,
    latestTransakOrder,
    latestOnrampOrder,
    clearLatestTransakOrder,
    clearLatestOnrampOrder,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
      balance: state.balance,
      balanceUsd: state.balanceUsd,
      transactions: state.transactions,
      isLoadingTransactions: state.isLoadingTransactions,
      refreshTransactions: state.refreshTransactions,
      latestTransakOrder: state.latestTransakOrder,
      latestOnrampOrder: state.latestOnrampOrder,
      clearLatestTransakOrder: state.clearLatestTransakOrder,
      clearLatestOnrampOrder: state.clearLatestOnrampOrder,
    }))
  );`, to: `  const {
    address,
    activeChain,
    setActiveChain,
    balance,
    balanceUsd,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
      balance: state.balance,
      balanceUsd: state.balanceUsd,
    }))
  );

  const {
    transactions,
    isLoadingTransactions,
    refreshTransactions,
    latestTransakOrder,
    latestOnrampOrder,
    clearLatestTransakOrder,
    clearLatestOnrampOrder,
  } = useTransactionStore(
    useShallow((state) => ({
      transactions: state.transactions,
      isLoadingTransactions: state.isLoadingTransactions,
      refreshTransactions: state.refreshTransactions,
      latestTransakOrder: state.latestTransakOrder,
      latestOnrampOrder: state.latestOnrampOrder,
      clearLatestTransakOrder: state.clearLatestTransakOrder,
      clearLatestOnrampOrder: state.clearLatestOnrampOrder,
    }))
  );` }
]);

// src/screens/PrivacyLevelScreen.tsx
replaceStr('src/screens/PrivacyLevelScreen.tsx', [
  { from: `import { useWalletStore, PrivacyLevel } from '../stores/walletStore';`, to: `import { useSettingsStore, PrivacyLevel } from '../stores/settingsStore';` },
  { from: `const { defaultPrivacyLevel, setPrivacyLevel } = useWalletStore();`, to: `const { defaultPrivacyLevel, setPrivacyLevel } = useSettingsStore();` }
]);

// src/screens/SendPaymentScreen.tsx
replaceStr('src/screens/SendPaymentScreen.tsx', [
  { from: `import { useWalletStore, validateAddress, ChainType } from '../stores/walletStore';`, to: `import { useWalletStore, validateAddress, ChainType } from '../stores/walletStore';\nimport { useSettingsStore } from '../stores/settingsStore';` },
  { from: `const {
    address,
    activeChain,
    biometricsEnabled,
    isProving,
    setIsProving,
  } = useWalletStore(`, to: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const {
    address,
    activeChain,
    isProving,
    setIsProving,
  } = useWalletStore(` },
  { from: `biometricsEnabled: state.biometricsEnabled,\n`, to: `` }
]);

// src/screens/SettingsScreen.tsx
replaceStr('src/screens/SettingsScreen.tsx', [
  { from: `import { useWalletStore } from '../stores/walletStore';`, to: `import { useWalletStore } from '../stores/walletStore';\nimport { useSettingsStore } from '../stores/settingsStore';` },
  { from: `  const {
    biometricsEnabled,
    notificationsEnabled,
    analyticsEnabled,
    defaultPrivacyLevel,
    theme,
    setBiometricsEnabled,
    setNotificationsEnabled,
    setAnalyticsEnabled,
    setPrivacyLevel,
    setTheme,
    address,
    activeChain,
    setActiveChain,
    disconnect,
  } = useWalletStore(
    useShallow((state) => ({
      biometricsEnabled: state.biometricsEnabled,
      notificationsEnabled: state.notificationsEnabled,
      analyticsEnabled: state.analyticsEnabled,
      defaultPrivacyLevel: state.defaultPrivacyLevel,
      theme: state.theme,
      setBiometricsEnabled: state.setBiometricsEnabled,
      setNotificationsEnabled: state.setNotificationsEnabled,
      setAnalyticsEnabled: state.setAnalyticsEnabled,
      setPrivacyLevel: state.setPrivacyLevel,
      setTheme: state.setTheme,
      address: state.address,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
      disconnect: state.disconnect,
    }))
  );`, to: `  const {
    biometricsEnabled,
    notificationsEnabled,
    analyticsEnabled,
    defaultPrivacyLevel,
    theme,
    setBiometricsEnabled,
    setNotificationsEnabled,
    setAnalyticsEnabled,
    setPrivacyLevel,
    setTheme,
  } = useSettingsStore(
    useShallow((state) => ({
      biometricsEnabled: state.biometricsEnabled,
      notificationsEnabled: state.notificationsEnabled,
      analyticsEnabled: state.analyticsEnabled,
      defaultPrivacyLevel: state.defaultPrivacyLevel,
      theme: state.theme,
      setBiometricsEnabled: state.setBiometricsEnabled,
      setNotificationsEnabled: state.setNotificationsEnabled,
      setAnalyticsEnabled: state.setAnalyticsEnabled,
      setPrivacyLevel: state.setPrivacyLevel,
      setTheme: state.setTheme,
    }))
  );
  const {
    address,
    activeChain,
    setActiveChain,
    disconnect,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
      disconnect: state.disconnect,
    }))
  );` }
]);

// src/screens/TransactionHistoryScreen.tsx
replaceStr('src/screens/TransactionHistoryScreen.tsx', [
  { from: `import { useWalletStore } from '../stores/walletStore';`, to: `import { useWalletStore } from '../stores/walletStore';\nimport { useTransactionStore } from '../stores/transactionStore';` },
  { from: `  const {
    address,
    activeChain,
    transactions,
    hasMoreTransactions,
    isLoadingTransactions,
    transactionsError,
    refreshTransactions,
    loadMoreTransactions,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      transactions: state.transactions,
      hasMoreTransactions: state.hasMoreTransactions,
      isLoadingTransactions: state.isLoadingTransactions,
      transactionsError: state.transactionsError,
      refreshTransactions: state.refreshTransactions,
      loadMoreTransactions: state.loadMoreTransactions,
    }))
  );`, to: `  const {
    address,
    activeChain,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
    }))
  );

  const {
    transactions,
    hasMoreTransactions,
    isLoadingTransactions,
    transactionsError,
    refreshTransactions,
    loadMoreTransactions,
  } = useTransactionStore(
    useShallow((state) => ({
      transactions: state.transactions,
      hasMoreTransactions: state.hasMoreTransactions,
      isLoadingTransactions: state.isLoadingTransactions,
      transactionsError: state.transactionsError,
      refreshTransactions: state.refreshTransactions,
      loadMoreTransactions: state.loadMoreTransactions,
    }))
  );` }
]);

// src/screens/TransakWebViewScreen.tsx
replaceStr('src/screens/TransakWebViewScreen.tsx', [
  { from: `import { useWalletStore, TransakOrderStatus } from '../stores/walletStore';`, to: `import { useWalletStore } from '../stores/walletStore';\nimport { useTransactionStore, TransakOrderStatus } from '../stores/transactionStore';` }
]);

// src/screens/WithdrawFiatScreen.tsx
replaceStr('src/screens/WithdrawFiatScreen.tsx', [
  { from: `import { useWalletStore } from "../stores/walletStore";`, to: `import { useWalletStore } from "../stores/walletStore";\nimport { useSettingsStore } from "../stores/settingsStore";` },
  { from: `const { address, activeChain, biometricsEnabled } = useWalletStore(`, to: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const { address, activeChain } = useWalletStore(` },
  { from: `biometricsEnabled: state.biometricsEnabled,\n`, to: `` }
]);

// src/stores/__tests__/walletStore.test.ts
replaceStr('src/stores/__tests__/walletStore.test.ts', [
  { from: `import { useWalletStore } from '../walletStore';`, to: `import { useWalletStore } from '../walletStore';\nimport { useSettingsStore } from '../settingsStore';\nimport { useTransactionStore } from '../transactionStore';` },
  { from: /useWalletStore\.getState\(\)\.setTheme/g, to: `useSettingsStore.getState().setTheme` },
  { from: /useWalletStore\.getState\(\)\.theme/g, to: `useSettingsStore.getState().theme` },
  { from: /useWalletStore\.getState\(\)\.setTransactions/g, to: `useTransactionStore.getState().setTransactions` },
  { from: /useWalletStore\.getState\(\)\.transactions/g, to: `useTransactionStore.getState().transactions` },
  { from: /useWalletStore\.getState\(\)\.clearTransactions/g, to: `useTransactionStore.getState().clearTransactions` }
]);

console.log('Fixed.');
