const fs = require('fs');

function fix(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf-8');
  for (const r of replacements) {
    content = content.split(r.from).join(r.to);
  }
  fs.writeFileSync(filePath, content);
}

// DepositCryptoScreen.tsx
fix('src/screens/DepositCryptoScreen.tsx', [
  {
    from: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);
  const { address, activeChain } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      biometricsEnabled: state.biometricsEnabled,
    }))
  );`,
    to: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);
  const { address, activeChain } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
    }))
  );`
  }
]);

// WithdrawFiatScreen.tsx
fix('src/screens/WithdrawFiatScreen.tsx', [
  {
    from: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);
  const { address, activeChain } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      biometricsEnabled: state.biometricsEnabled,
    }))
  );`,
    to: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);
  const { address, activeChain } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
    }))
  );`
  }
]);

// SendPaymentScreen.tsx
fix('src/screens/SendPaymentScreen.tsx', [
  {
    from: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);
  const {
    address,
    activeChain,
    isProving,
    setIsProving,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      biometricsEnabled: state.biometricsEnabled,
      isProving: state.isProving,
      setIsProving: state.setIsProving,
    }))
  );`,
    to: `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);
  const {
    address,
    activeChain,
    isProving,
    setIsProving,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      isProving: state.isProving,
      setIsProving: state.setIsProving,
    }))
  );`
  }
]);

// SettingsScreen.tsx
fix('src/screens/SettingsScreen.tsx', [
  {
    from: `  const {
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
  );`,
    to: `  const {
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
  );`
  }
]);

// TransactionHistoryScreen.tsx
fix('src/screens/TransactionHistoryScreen.tsx', [
  {
    from: `  const {
    address,
    activeChain,
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
  );`,
    to: `  const {
    address,
    activeChain,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
    }))
  );`
  },
  {
    from: `displayTransactions.map((tx) => {`,
    to: `displayTransactions.map((tx: import('../types/transactions').TransactionRecord) => {`
  }
]);

// TransakWebViewScreen.tsx
fix('src/screens/TransakWebViewScreen.tsx', [
  {
    from: `import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore, TransakOrderStatus } from '../stores/transactionStore';`,
    to: `import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore } from '../stores/transactionStore';
import type { TransakOrderStatus } from '../types/fiatGateway';`
  },
  {
    from: `const { setLatestTransakOrder, activeChain, address } = useWalletStore();`,
    to: `const { activeChain, address } = useWalletStore();\n  const { setLatestTransakOrder } = useTransactionStore();`
  }
]);

console.log('Fixed additional screens.');
