const fs = require('fs');

function fixExact(filePath, replacements) {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    for (const {from, to} of replacements) {
      if (typeof from === 'string') {
        content = content.replace(from, to);
      } else {
        content = content.replace(from, to);
      }
    }
    fs.writeFileSync(filePath, content);
  } catch (e) {
    console.error(`Error processing ${filePath}:`, e);
  }
}

// 1. Remove duplicate imports across all affected files
const filesWithDuplicates = [
  'src/hooks/useOnramp.ts',
  'src/screens/ExportPrivateKeyScreen.tsx',
  'src/screens/PrivacyLevelScreen.tsx',
  'src/screens/SendPaymentScreen.tsx',
  'src/screens/TransactionHistoryScreen.tsx'
];

filesWithDuplicates.forEach(file => {
  try {
    let content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const seen = new Set();
    const newLines = [];
    for (const line of lines) {
      if (line.startsWith('import { useSettingsStore }') || line.startsWith('import { useTransactionStore }')) {
        if (!seen.has(line)) {
          seen.add(line);
          newLines.push(line);
        }
      } else {
        newLines.push(line);
      }
    }
    fs.writeFileSync(file, newLines.join('\n'));
  } catch(e){}
});

// 2. Fix specific file issues

fixExact('src/navigation/AppNavigator.tsx', [
  { from: 'import { TransakFlow } from "../stores/transactionStore";', to: '' },
  { from: 'import { TransakFlow } from "../stores/walletStore";', to: 'import { TransakFlow } from "../stores/transactionStore";' },
  { from: 'import { useWalletStore, TransakFlow }', to: 'import { useWalletStore }' }
]);

fixExact('src/screens/DepositCryptoScreen.tsx', [
  { from: 'biometricsEnabled } = useWalletStore(', to: '} = useWalletStore(' },
  { from: 'biometricsEnabled: state.biometricsEnabled,', to: '' }
]);

fixExact('src/screens/ExportPrivateKeyScreen.tsx', [
  { from: 'const { biometricsEnabled, address, activeChain } = useWalletStore();', to: 'const { address, activeChain } = useWalletStore();\n  const { biometricsEnabled } = useSettingsStore();' }
]);

fixExact('src/screens/HomeDashboardScreen.tsx', [
  { from: 'latestTransakOrder,', to: '' },
  { from: 'latestOnrampOrder,', to: '' },
  { from: 'clearLatestTransakOrder,', to: '' },
  { from: 'clearLatestOnrampOrder,', to: '' },
  { from: 'latestTransakOrder: state.latestTransakOrder,', to: '' },
  { from: 'latestOnrampOrder: state.latestOnrampOrder,', to: '' },
  { from: 'clearLatestTransakOrder: state.clearLatestTransakOrder,', to: '' },
  { from: 'clearLatestOnrampOrder: state.clearLatestOnrampOrder,', to: '' },
  { from: 'transactions,', to: '' },
  { from: 'isLoadingTransactions,', to: '' },
  { from: 'refreshTransactions,', to: '' },
  { from: 'transactions: state.transactions,', to: '' },
  { from: 'isLoadingTransactions: state.isLoadingTransactions,', to: '' },
  { from: 'refreshTransactions: state.refreshTransactions,', to: '' },
  { from: 'tx: any', to: 'tx: import("../types/transactions").TransactionRecord' }
]);

fixExact('src/screens/SendPaymentScreen.tsx', [
  { from: 'biometricsEnabled,', to: '' },
  { from: 'biometricsEnabled: state.biometricsEnabled,', to: '' }
]);

fixExact('src/screens/SettingsScreen.tsx', [
  { from: 'biometricsEnabled,\n', to: '' },
  { from: 'notificationsEnabled,\n', to: '' },
  { from: 'analyticsEnabled,\n', to: '' },
  { from: 'defaultPrivacyLevel,\n', to: '' },
  { from: 'theme,\n', to: '' },
  { from: 'setBiometricsEnabled,\n', to: '' },
  { from: 'setNotificationsEnabled,\n', to: '' },
  { from: 'setAnalyticsEnabled,\n', to: '' },
  { from: 'setPrivacyLevel,\n', to: '' },
  { from: 'setTheme,\n', to: '' },
  { from: 'biometricsEnabled: state.biometricsEnabled,', to: '' },
  { from: 'notificationsEnabled: state.notificationsEnabled,', to: '' },
  { from: 'analyticsEnabled: state.analyticsEnabled,', to: '' },
  { from: 'defaultPrivacyLevel: state.defaultPrivacyLevel,', to: '' },
  { from: 'theme: state.theme,', to: '' },
  { from: 'setBiometricsEnabled: state.setBiometricsEnabled,', to: '' },
  { from: 'setNotificationsEnabled: state.setNotificationsEnabled,', to: '' },
  { from: 'setAnalyticsEnabled: state.setAnalyticsEnabled,', to: '' },
  { from: 'setPrivacyLevel: state.setPrivacyLevel,', to: '' },
  { from: 'setTheme: state.setTheme,', to: '' },
  { from: '} = useWalletStore(', to: '} = useWalletStore(' }
]);

fixExact('src/screens/TransactionHistoryScreen.tsx', [
  { from: /const \{\n\s*transactions,\n\s*hasMoreTransactions,\n\s*isLoadingTransactions,\n\s*transactionsError,\n\s*refreshTransactions,\n\s*loadMoreTransactions,\n\s*\} = useWalletStore\(\n\s*useShallow\(\(state\) => \(\{\n\s*transactions: state\.transactions,\n\s*hasMoreTransactions: state\.hasMoreTransactions,\n\s*isLoadingTransactions: state\.isLoadingTransactions,\n\s*transactionsError: state\.transactionsError,\n\s*refreshTransactions: state\.refreshTransactions,\n\s*loadMoreTransactions: state\.loadMoreTransactions,\n\s*\}\)\)\n\s*\);/g, to: '' },
  { from: 'tx: any', to: 'tx: import("../types/transactions").TransactionRecord' }
]);

fixExact('src/screens/TransakWebViewScreen.tsx', [
  { from: 'import { useWalletStore, TransakOrderStatus }', to: 'import { useWalletStore }' },
  { from: 'import { useWalletStore } from \'../stores/walletStore\';\nimport { useTransactionStore, TransakOrderStatus } from \'../stores/transactionStore\';', to: 'import { useWalletStore } from \'../stores/walletStore\';\nimport { useTransactionStore, TransakOrderStatus } from \'../stores/transactionStore\';' }
]);

fixExact('src/screens/WithdrawFiatScreen.tsx', [
  { from: 'biometricsEnabled } = useWalletStore(', to: '} = useWalletStore(' },
  { from: 'biometricsEnabled: state.biometricsEnabled,', to: '' }
]);

fixExact('src/stores/__tests__/walletStore.test.ts', [
  { from: /import \{ useSettingsStore \} from '\.\.\/settingsStore';/g, to: 'import { useSettingsStore } from \'../settingsStore\';' },
  { from: /import \{ useTransactionStore \} from '\.\.\/transactionStore';/g, to: 'import { useTransactionStore } from \'../transactionStore\';' },
  { from: /import \{ useWalletStore \} from '\.\.\/walletStore';/g, to: 'import { useWalletStore } from \'../walletStore\';\nimport { useSettingsStore } from \'../settingsStore\';\nimport { useTransactionStore } from \'../transactionStore\';' }
]);

console.log('Fixed more errors.');
