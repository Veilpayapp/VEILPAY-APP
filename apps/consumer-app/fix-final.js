const fs = require('fs');

function replaceExact(file, from, to) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes(from)) {
    content = content.replace(from, to);
    fs.writeFileSync(file, content);
    console.log('Fixed', file);
  } else {
    console.log('Could not find string in', file);
  }
}

// TransactionHistoryScreen.tsx
const txFile = 'src/screens/TransactionHistoryScreen.tsx';
replaceExact(txFile, 
`import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore } from '../stores/transactionStore';`,
`import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useShallow } from 'zustand/react/shallow';`);

replaceExact(txFile,
`  const {
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
  );
  const [filter, setFilter] = useState<FilterOption>('all');
  const [refreshing, setRefreshing] = useState(false);
  const {
    activeChain,
    address,
    
    
    
    
    
    
  } = useWalletStore();`,
`  const {
    transactions,
    hasMoreTransactions,
    isLoadingTransactions,
    transactionsError,
    refreshTransactions,
    loadMoreTransactions,
  } = useTransactionStore(
    useShallow((state: any) => ({
      transactions: state.transactions,
      hasMoreTransactions: state.hasMoreTransactions,
      isLoadingTransactions: state.isLoadingTransactions,
      transactionsError: state.transactionsError,
      refreshTransactions: state.refreshTransactions,
      loadMoreTransactions: state.loadMoreTransactions,
    }))
  );
  const [filter, setFilter] = useState<FilterOption>('all');
  const [refreshing, setRefreshing] = useState(false);
  const {
    activeChain,
    address,
  } = useWalletStore();`);

replaceExact(txFile, 
`return transactions.filter((tx: any) => tx.type === filter);`,
`return transactions.filter((tx: import('../types/transactions').TransactionRecord) => tx.type === filter);`);


// SettingsScreen.tsx
const settingsFile = 'src/screens/SettingsScreen.tsx';
replaceExact(settingsFile, 
`  const {
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
    useShallow((state) => ({`,
`  const {
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
    useShallow((state: any) => ({`);


// TransakWebViewScreen.tsx
const transakFile = 'src/screens/TransakWebViewScreen.tsx';
replaceExact(transakFile,
`import { useTransactionStore } from '../stores/transactionStore';
import type { TransakOrderStatus } from '../types/fiatGateway';`,
`import { useTransactionStore } from '../stores/transactionStore';
import type { TransakOrderStatus } from '../types/fiatGateway';`);

// wait TransakWebViewScreen is currently:
// import { useWalletStore } from '../stores/walletStore';
// import { useTransactionStore } from '../stores/transactionStore';
// import type { TransakOrderStatus } from '../types/fiatGateway';
// Oh wait, in task-266 it said: Module '"../stores/walletStore"' has no exported member 'TransakOrderStatus'.
// Let me just read it and replace.
let transakContent = fs.readFileSync(transakFile, 'utf8');
transakContent = transakContent.replace(`import { useTransactionStore, TransakOrderStatus } from '../stores/walletStore';`, ``);
transakContent = transakContent.replace(`import { useTransactionStore } from '../stores/transactionStore';\nimport type { TransakOrderStatus } from '../types/fiatGateway';`, `import { useTransactionStore } from '../stores/transactionStore';\nimport type { TransakOrderStatus } from '../types/fiatGateway';`);
transakContent = transakContent.replace(`import { useWalletStore, TransakOrderStatus } from '../stores/walletStore';`, `import { useWalletStore } from '../stores/walletStore';`);
transakContent = transakContent.replace(`const { setLatestTransakOrder, activeChain, address } = useWalletStore();`, `const { activeChain, address } = useWalletStore();\n  const setLatestTransakOrder = useTransactionStore(s => s.setLatestTransakOrder);`);
fs.writeFileSync(transakFile, transakContent);

// OnrampAmountScreen.tsx
const onrampFile = 'src/screens/OnrampAmountScreen.tsx';
replaceExact(onrampFile, `navigation.navigate("OnrampQuotes"`, `navigation.navigate("OnrampWidget"`);

