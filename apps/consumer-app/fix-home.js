const fs = require('fs');

function fix(filePath, from, to) {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.split(from).join(to);
  fs.writeFileSync(filePath, content);
}

const file = 'src/screens/HomeDashboardScreen.tsx';

// 1. imports
fix(file, 'import { useWalletStore, SUPPORTED_CHAINS } from "../stores/walletStore";', 'import { useWalletStore, SUPPORTED_CHAINS } from "../stores/walletStore";\nimport { useTransactionStore } from "../stores/transactionStore";');

// 2. Destructure
const oldStoreCall = `  const {
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
  );`;

const newStoreCall = `  const {
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
  );`;

fix(file, oldStoreCall, newStoreCall);

// 3. transaction mapping fix
fix(file, 'displayTransactions.slice(0, 5).map((tx) => {', 'displayTransactions.slice(0, 5).map((tx: import("../types/transactions").TransactionRecord) => {');

console.log('Fixed HomeDashboardScreen');
