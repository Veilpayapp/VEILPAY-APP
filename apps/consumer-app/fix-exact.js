const fs = require('fs');

function f(file, from, to) {
  let c = fs.readFileSync(file, 'utf-8');
  c = c.split(from).join(to);
  fs.writeFileSync(file, c);
}

// HomeDashboardScreen
let file = 'src/screens/HomeDashboardScreen.tsx';
f(file, 
  `import { useTransactionStore } from "../stores/transactionStore";\nimport { useTransactionStore } from "../stores/transactionStore";`, 
  `import { useTransactionStore } from "../stores/transactionStore";`
);
f(file,
  `  const {
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
  );`,
  `  const {
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
  );`
);

// OnrampAmountScreen
file = 'src/screens/OnrampAmountScreen.tsx';
f(file, `navigation.navigate("OnrampQuotes"`, `navigation.navigate("OnrampWidget"`);

// SendPaymentScreen
file = 'src/screens/SendPaymentScreen.tsx';
f(file, `import { useWalletStore } from "../stores/walletStore";`, `import { useWalletStore } from "../stores/walletStore";\nimport { useSettingsStore } from "../stores/settingsStore";`);
f(file, `const {
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
  );`, `const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const {
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
  );`);

// SettingsScreen
file = 'src/screens/SettingsScreen.tsx';
f(file, `import { SUPPORTED_CHAINS, useWalletStore } from "../stores/walletStore";`, `import { SUPPORTED_CHAINS, useWalletStore } from "../stores/walletStore";\nimport { useSettingsStore } from "../stores/settingsStore";`);

// TransactionHistoryScreen
file = 'src/screens/TransactionHistoryScreen.tsx';
f(file, `import { useWalletStore } from '../stores/walletStore';`, `import { useWalletStore } from '../stores/walletStore';\nimport { useTransactionStore } from '../stores/transactionStore';`);
f(file, `const {
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
  );`, `const {
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
  );`);
f(file, `displayTransactions.map((tx) => {`, `displayTransactions.map((tx: import('../types/transactions').TransactionRecord) => {`);

// TransakWebViewScreen
file = 'src/screens/TransakWebViewScreen.tsx';
f(file, `import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore, TransakOrderStatus } from '../stores/transactionStore';`, `import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore } from '../stores/transactionStore';
import type { TransakOrderStatus } from '../types/fiatGateway';`);
f(file, `const { setLatestTransakOrder, activeChain, address } = useWalletStore();`, `const { activeChain, address } = useWalletStore();\n  const setLatestTransakOrder = useTransactionStore(state => state.setLatestTransakOrder);`);

console.log('Fixed all exactly');
