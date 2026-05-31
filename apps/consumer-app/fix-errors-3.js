const fs = require('fs');

function replaceAll(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf-8');
  for (const {from, to} of replacements) {
    content = content.replace(from, to);
  }
  fs.writeFileSync(filePath, content);
}

// DepositCryptoScreen.tsx
replaceAll('src/screens/DepositCryptoScreen.tsx', [
  {
    from: `const { address, activeChain } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain })));
  const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);`,
    to: `const { address, activeChain } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain })));
  const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);`
  }
]);

// Let's actually fix DepositCryptoScreen differently:
let depContent = fs.readFileSync('src/screens/DepositCryptoScreen.tsx', 'utf-8');
if (!depContent.includes('const biometricsEnabled = useSettingsStore')) {
  depContent = depContent.replace(/const { address, activeChain } = useWalletStore\(/, `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const { address, activeChain } = useWalletStore(`);
  fs.writeFileSync('src/screens/DepositCryptoScreen.tsx', depContent);
}

// HomeDashboardScreen.tsx
let homeContent = fs.readFileSync('src/screens/HomeDashboardScreen.tsx', 'utf-8');
homeContent = homeContent.replace(/const \{\s*address,\s*activeChain,\s*setActiveChain,\s*balance,\s*balanceUsd,[\s,]*\} = useWalletStore\(\s*useShallow\(\(state\) => \(\{\s*address: state\.address,\s*activeChain: state\.activeChain,\s*setActiveChain: state\.setActiveChain,\s*balance: state\.balance,\s*balanceUsd: state\.balanceUsd,[\s,]*\}\)\)\s*\);/, `const {
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
  );`);
fs.writeFileSync('src/screens/HomeDashboardScreen.tsx', homeContent);

// SendPaymentScreen.tsx
let sendContent = fs.readFileSync('src/screens/SendPaymentScreen.tsx', 'utf-8');
if (!sendContent.includes('const biometricsEnabled = useSettingsStore')) {
  sendContent = sendContent.replace(/const { address, activeChain, isProving, setIsProving } = useWalletStore\(/, `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const { address, activeChain, isProving, setIsProving } = useWalletStore(`);
  fs.writeFileSync('src/screens/SendPaymentScreen.tsx', sendContent);
}

// SettingsScreen.tsx
let setContent = fs.readFileSync('src/screens/SettingsScreen.tsx', 'utf-8');
setContent = setContent.replace(/const {\s*} = useWalletStore\(\s*useShallow\(\(state\) => \(\{\s*\}\)\)\s*\);/, '');
if (!setContent.includes('const { biometricsEnabled,')) {
  setContent = setContent.replace(/const { address, activeChain, setActiveChain, disconnect } = useWalletStore\(/, `const { biometricsEnabled, notificationsEnabled, analyticsEnabled, defaultPrivacyLevel, theme, setBiometricsEnabled, setNotificationsEnabled, setAnalyticsEnabled, setPrivacyLevel, setTheme } = useSettingsStore(useShallow((state) => ({ biometricsEnabled: state.biometricsEnabled, notificationsEnabled: state.notificationsEnabled, analyticsEnabled: state.analyticsEnabled, defaultPrivacyLevel: state.defaultPrivacyLevel, theme: state.theme, setBiometricsEnabled: state.setBiometricsEnabled, setNotificationsEnabled: state.setNotificationsEnabled, setAnalyticsEnabled: state.setAnalyticsEnabled, setPrivacyLevel: state.setPrivacyLevel, setTheme: state.setTheme })));\n  const { address, activeChain, setActiveChain, disconnect } = useWalletStore(`);
}
fs.writeFileSync('src/screens/SettingsScreen.tsx', setContent);

// TransactionHistoryScreen.tsx
let thContent = fs.readFileSync('src/screens/TransactionHistoryScreen.tsx', 'utf-8');
thContent = thContent.replace(/const { address, activeChain } = useWalletStore\(/, `const { transactions, hasMoreTransactions, isLoadingTransactions, transactionsError, refreshTransactions, loadMoreTransactions } = useTransactionStore(useShallow((state) => ({ transactions: state.transactions, hasMoreTransactions: state.hasMoreTransactions, isLoadingTransactions: state.isLoadingTransactions, transactionsError: state.transactionsError, refreshTransactions: state.refreshTransactions, loadMoreTransactions: state.loadMoreTransactions })));\n  const { address, activeChain } = useWalletStore(`);
fs.writeFileSync('src/screens/TransactionHistoryScreen.tsx', thContent);

// WithdrawFiatScreen.tsx
let wfContent = fs.readFileSync('src/screens/WithdrawFiatScreen.tsx', 'utf-8');
if (!wfContent.includes('const biometricsEnabled = useSettingsStore')) {
  wfContent = wfContent.replace(/const { address, activeChain } = useWalletStore\(/, `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const { address, activeChain } = useWalletStore(`);
  fs.writeFileSync('src/screens/WithdrawFiatScreen.tsx', wfContent);
}

// WalletStore Test
let tContent = fs.readFileSync('src/stores/__tests__/walletStore.test.ts', 'utf-8');
tContent = tContent.replace(/useWalletStore\.getState\(\)\.setTheme/g, 'useSettingsStore.getState().setTheme');
tContent = tContent.replace(/useWalletStore\.getState\(\)\.theme/g, 'useSettingsStore.getState().theme');
tContent = tContent.replace(/useWalletStore\.getState\(\)\.setTransactions/g, 'useTransactionStore.getState().setTransactions');
tContent = tContent.replace(/useWalletStore\.getState\(\)\.transactions/g, 'useTransactionStore.getState().transactions');
tContent = tContent.replace(/useWalletStore\.getState\(\)\.clearTransactions/g, 'useTransactionStore.getState().clearTransactions');
fs.writeFileSync('src/stores/__tests__/walletStore.test.ts', tContent);

console.log('Fixed undefined variables by adding correct hook calls.');
