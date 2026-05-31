const fs = require('fs');

function extractStore(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // HomeDashboardScreen
  if (filePath.includes('HomeDashboardScreen')) {
    content = content.replace(/transactions:\s*state\.transactions,/g, '');
    content = content.replace(/isLoadingTransactions:\s*state\.isLoadingTransactions,/g, '');
    content = content.replace(/refreshTransactions:\s*state\.refreshTransactions,/g, '');
    content = content.replace(/latestTransakOrder:\s*state\.latestTransakOrder,/g, '');
    content = content.replace(/latestOnrampOrder:\s*state\.latestOnrampOrder,/g, '');
    content = content.replace(/clearLatestTransakOrder:\s*state\.clearLatestTransakOrder,/g, '');
    content = content.replace(/clearLatestOnrampOrder:\s*state\.clearLatestOnrampOrder,/g, '');

    content = content.replace(/transactions,/g, '');
    content = content.replace(/isLoadingTransactions,/g, '');
    content = content.replace(/refreshTransactions,/g, '');
    content = content.replace(/latestTransakOrder,/g, '');
    content = content.replace(/latestOnrampOrder,/g, '');
    content = content.replace(/clearLatestTransakOrder,/g, '');
    content = content.replace(/clearLatestOnrampOrder,/g, '');
    
    // Add transaction store correctly
    const txStore = `
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
    content = content.replace('const { checkOrderStatus } = useOnramp();', txStore + '\n  const { checkOrderStatus } = useOnramp();');
    content = content.replace(/tx =>/g, '(tx: any) =>');
    content = content.replace(/\(tx\)/g, '(tx: any)');
  }

  // SendPaymentScreen
  if (filePath.includes('SendPaymentScreen')) {
    content = content.replace(/biometricsEnabled:\s*state\.biometricsEnabled,/g, '');
    content = content.replace(/biometricsEnabled,/g, '');
    if (!content.includes('useSettingsStore')) {
        content = content.replace('import { useWalletStore }', 'import { useSettingsStore } from "../stores/settingsStore";\nimport { useWalletStore }');
        content = content.replace('const {', 'const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);\n  const {');
    }
  }

  // TransactionHistoryScreen
  if (filePath.includes('TransactionHistoryScreen')) {
    content = content.replace(/transactions:\s*state\.transactions,/g, '');
    content = content.replace(/hasMoreTransactions:\s*state\.hasMoreTransactions,/g, '');
    content = content.replace(/isLoadingTransactions:\s*state\.isLoadingTransactions,/g, '');
    content = content.replace(/transactionsError:\s*state\.transactionsError,/g, '');
    content = content.replace(/refreshTransactions:\s*state\.refreshTransactions,/g, '');
    content = content.replace(/loadMoreTransactions:\s*state\.loadMoreTransactions,/g, '');

    content = content.replace(/transactions,/g, '');
    content = content.replace(/hasMoreTransactions,/g, '');
    content = content.replace(/isLoadingTransactions,/g, '');
    content = content.replace(/transactionsError,/g, '');
    content = content.replace(/refreshTransactions,/g, '');
    content = content.replace(/loadMoreTransactions,/g, '');
    
    // Add transaction store correctly
    const txStore = `
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
  );`;
    content = content.replace('const styles = useStyles(themeStyles);', 'const styles = useStyles(themeStyles);\n' + txStore);
    if (!content.includes("import { useTransactionStore }")) {
       content = content.replace("import { useWalletStore }", "import { useTransactionStore } from '../stores/transactionStore';\nimport { useWalletStore }");
    }
    content = content.replace(/tx =>/g, '(tx: any) =>');
    content = content.replace(/\(tx\)/g, '(tx: any)');
    
    // fix duplicate
    content = content.replace(/import \{ useTransactionStore \} from '\.\.\/stores\/transactionStore';\nimport \{ useTransactionStore \} from '\.\.\/stores\/transactionStore';/g, "import { useTransactionStore } from '../stores/transactionStore';");
  }

  // TransakWebViewScreen
  if (filePath.includes('TransakWebViewScreen')) {
    content = content.replace("import { useTransactionStore, TransakOrderStatus } from '../stores/transactionStore';", "import { useTransactionStore } from '../stores/transactionStore';\nimport type { TransakOrderStatus } from '../types/fiatGateway';");
    content = content.replace("import { useTransactionStore, TransakOrderStatus } from '../stores/walletStore';", "import { useTransactionStore } from '../stores/transactionStore';\nimport type { TransakOrderStatus } from '../types/fiatGateway';");
    content = content.replace("const { setLatestTransakOrder, activeChain, address } = useWalletStore();", "const { activeChain, address } = useWalletStore();\n  const setLatestTransakOrder = useTransactionStore(state => state.setLatestTransakOrder);");
  }

  // OnrampAmountScreen
  if (filePath.includes('OnrampAmountScreen')) {
    content = content.replace(/OnrampQuotes/g, 'OnrampWidget');
  }

  fs.writeFileSync(filePath, content);
}

extractStore('src/screens/HomeDashboardScreen.tsx');
extractStore('src/screens/SendPaymentScreen.tsx');
extractStore('src/screens/TransactionHistoryScreen.tsx');
extractStore('src/screens/TransakWebViewScreen.tsx');
extractStore('src/screens/OnrampAmountScreen.tsx');

console.log('Fixed stores via crude regex.');
