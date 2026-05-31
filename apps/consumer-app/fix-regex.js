const fs = require('fs');

function replaceRegex(filePath, regex, replacement) {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(regex, replacement);
  fs.writeFileSync(filePath, content);
}

// DepositCryptoScreen.tsx
let f = 'src/screens/DepositCryptoScreen.tsx';
replaceRegex(f, /const { address, activeChain } = useWalletStore\(\s*useShallow\(\(state\) => \(\{\s*address: state\.address,\s*activeChain: state\.activeChain,\s*biometricsEnabled: state\.biometricsEnabled,?\s*\}\)\)\s*\);/, `const { address, activeChain } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain })));`);

// WithdrawFiatScreen.tsx
f = 'src/screens/WithdrawFiatScreen.tsx';
replaceRegex(f, /import \{ useWalletStore \} from "\.\.\/stores\/walletStore";/, `import { useWalletStore } from "../stores/walletStore";\nimport { useSettingsStore } from "../stores/settingsStore";`);
replaceRegex(f, /const { address, activeChain, balance, biometricsEnabled } = useWalletStore\(\s*useShallow\(\(state\) => \(\{\s*address: state\.address,\s*activeChain: state\.activeChain,\s*balance: state\.balance,\s*biometricsEnabled: state\.biometricsEnabled,?\s*\}\)\)\s*\);/, `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const { address, activeChain, balance } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain, balance: state.balance })));`);

// SendPaymentScreen.tsx
f = 'src/screens/SendPaymentScreen.tsx';
replaceRegex(f, /const \{\s*address,\s*activeChain,\s*isProving,\s*setIsProving,\s*\} = useWalletStore\(\s*useShallow\(\(state\) => \(\{\s*address: state\.address,\s*activeChain: state\.activeChain,\s*biometricsEnabled: state\.biometricsEnabled,\s*isProving: state\.isProving,\s*setIsProving: state\.setIsProving,?\s*\}\)\)\s*\);/, `const { address, activeChain, isProving, setIsProving } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain, isProving: state.isProving, setIsProving: state.setIsProving })));`);

// SettingsScreen.tsx
f = 'src/screens/SettingsScreen.tsx';
replaceRegex(f, /const \{\s*address,\s*activeChain,\s*setActiveChain,\s*biometricsEnabled,\s*notificationsEnabled,\s*analyticsEnabled,\s*defaultPrivacyLevel,\s*setBiometricsEnabled,\s*setNotificationsEnabled,\s*setAnalyticsEnabled,\s*setPrivacyLevel,\s*theme,\s*setTheme,\s*disconnect,?\s*\} = useWalletStore\(\s*useShallow\(\(state\) => \(\{\s*address: state\.address,\s*activeChain: state\.activeChain,\s*setActiveChain: state\.setActiveChain,\s*biometricsEnabled: state\.biometricsEnabled,\s*notificationsEnabled: state\.notificationsEnabled,\s*analyticsEnabled: state\.analyticsEnabled,\s*defaultPrivacyLevel: state\.defaultPrivacyLevel,\s*theme: state\.theme,\s*setBiometricsEnabled: state\.setBiometricsEnabled,\s*setNotificationsEnabled: state\.setNotificationsEnabled,\s*setAnalyticsEnabled: state\.setAnalyticsEnabled,\s*setPrivacyLevel: state\.setPrivacyLevel,\s*setTheme: state\.setTheme,\s*disconnect: state\.disconnect,?\s*\}\)\)\s*\);/m, `  const {
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
  );`);

// TransactionHistoryScreen.tsx
f = 'src/screens/TransactionHistoryScreen.tsx';
replaceRegex(f, /const \{\s*address,\s*activeChain,\s*\} = useWalletStore\(\s*useShallow\(\(state\) => \(\{\s*address: state\.address,\s*activeChain: state\.activeChain,\s*transactions: state\.transactions,\s*hasMoreTransactions: state\.hasMoreTransactions,\s*isLoadingTransactions: state\.isLoadingTransactions,\s*transactionsError: state\.transactionsError,\s*refreshTransactions: state\.refreshTransactions,\s*loadMoreTransactions: state\.loadMoreTransactions,?\s*\}\)\)\s*\);/m, `  const { address, activeChain } = useWalletStore(useShallow((state) => ({ address: state.address, activeChain: state.activeChain })));`);
replaceRegex(f, /displayTransactions\.map\(\(tx\) => \{/, `displayTransactions.map((tx: import('../types/transactions').TransactionRecord) => {`);

// TransakWebViewScreen.tsx
f = 'src/screens/TransakWebViewScreen.tsx';
replaceRegex(f, /import \{ useWalletStore \} from '\.\.\/stores\/walletStore';\s*import \{ useTransactionStore, TransakOrderStatus \} from '\.\.\/stores\/transactionStore';/, `import { useWalletStore } from '../stores/walletStore';\nimport { useTransactionStore } from '../stores/transactionStore';\nimport type { TransakOrderStatus } from '../types/fiatGateway';`);
replaceRegex(f, /const \{ setLatestTransakOrder, activeChain, address \} = useWalletStore\(\);/, `const { activeChain, address } = useWalletStore();\n  const { setLatestTransakOrder } = useTransactionStore();`);

console.log('Finished precise regex replacement.');
