const fs = require('fs');

function fixWithdraw() {
  let lines = fs.readFileSync('src/screens/WithdrawFiatScreen.tsx', 'utf-8').split('\n');
  
  // import settingsStore
  const importIdx = lines.findIndex(l => l.includes('import { useWalletStore }'));
  if (importIdx !== -1 && !lines[importIdx + 1].includes('useSettingsStore')) {
    lines.splice(importIdx + 1, 0, 'import { useSettingsStore } from "../stores/settingsStore";');
  }

  // replace biometricsEnabled destructure
  const stateStartIdx = lines.findIndex(l => l.includes('const { address, activeChain, balance, biometricsEnabled } = useWalletStore('));
  if (stateStartIdx !== -1) {
    lines[stateStartIdx] = '  const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);';
    lines.splice(stateStartIdx + 1, 0, '  const { address, activeChain, balance } = useWalletStore(');
    
    // remove biometricsEnabled: state.biometricsEnabled,
    const bioIdx = lines.findIndex((l, i) => i > stateStartIdx && l.includes('biometricsEnabled: state.biometricsEnabled,'));
    if (bioIdx !== -1) {
      lines.splice(bioIdx, 1);
    }
  }

  fs.writeFileSync('src/screens/WithdrawFiatScreen.tsx', lines.join('\n'));
}

function fixSend() {
  let lines = fs.readFileSync('src/screens/SendPaymentScreen.tsx', 'utf-8').split('\n');
  
  const importIdx = lines.findIndex(l => l.includes('import { useWalletStore'));
  if (importIdx !== -1 && !lines[importIdx + 1].includes('useSettingsStore')) {
    lines.splice(importIdx + 1, 0, 'import { useSettingsStore } from "../stores/settingsStore";');
  }

  const startIdx = lines.findIndex(l => l.includes('const {'));
  const storeEndIdx = lines.findIndex((l, i) => i > startIdx && l.includes('} = useWalletStore('));
  
  if (startIdx !== -1 && storeEndIdx !== -1) {
    // Check if biometricsEnabled is inside
    const hasBio = lines.slice(startIdx, storeEndIdx).some(l => l.includes('biometricsEnabled'));
    if (hasBio) {
      // Remove it
      lines = lines.filter((l, i) => !(i > startIdx && i <= storeEndIdx && l.includes('biometricsEnabled')));
      
      // Add settings store call before startIdx
      lines.splice(startIdx, 0, '  const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);');
      
      // Also remove it from useShallow
      const shallowBioIdx = lines.findIndex(l => l.includes('biometricsEnabled: state.biometricsEnabled'));
      if (shallowBioIdx !== -1) {
        lines.splice(shallowBioIdx, 1);
      }
    }
  }
  
  fs.writeFileSync('src/screens/SendPaymentScreen.tsx', lines.join('\n'));
}

function fixSettings() {
  let lines = fs.readFileSync('src/screens/SettingsScreen.tsx', 'utf-8').split('\n');
  
  const importIdx = lines.findIndex(l => l.includes('import { SUPPORTED_CHAINS, useWalletStore }'));
  if (importIdx !== -1 && !lines[importIdx + 1].includes('useSettingsStore')) {
    lines.splice(importIdx + 1, 0, 'import { useSettingsStore } from "../stores/settingsStore";');
  }

  const startIdx = lines.findIndex(l => l.includes('} = useWalletStore('));
  if (startIdx !== -1) {
    // Let's just find the entire block and replace it.
    let content = fs.readFileSync('src/screens/SettingsScreen.tsx', 'utf-8');
    const oldBlock = `  const {
    address,
    activeChain,
    setActiveChain,
    biometricsEnabled,
    notificationsEnabled,
    analyticsEnabled,
    defaultPrivacyLevel,
    setBiometricsEnabled,
    setNotificationsEnabled,
    setAnalyticsEnabled,
    setPrivacyLevel,
    theme,
    setTheme,
    disconnect,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
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
      disconnect: state.disconnect,
    }))
  );`;
  
    const newBlock = `  const {
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
  );`;

    content = content.split(oldBlock).join(newBlock);
    fs.writeFileSync('src/screens/SettingsScreen.tsx', content);
  }
}

function fixHistory() {
  let content = fs.readFileSync('src/screens/TransactionHistoryScreen.tsx', 'utf-8');
  
  if (!content.includes('import { useTransactionStore')) {
    content = content.replace("import { useWalletStore } from '../stores/walletStore';", "import { useWalletStore } from '../stores/walletStore';\nimport { useTransactionStore } from '../stores/transactionStore';");
  }
  
  const oldBlock = `  const {
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
  );`;
  
  const newBlock = `  const {
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
  );`;

  content = content.split(oldBlock).join(newBlock);
  content = content.replace("displayTransactions.map((tx) => {", "displayTransactions.map((tx: import('../types/transactions').TransactionRecord) => {");
  
  fs.writeFileSync('src/screens/TransactionHistoryScreen.tsx', content);
}

function fixTransakWeb() {
  let lines = fs.readFileSync('src/screens/TransakWebViewScreen.tsx', 'utf-8').split('\n');
  
  // replace imports
  const i1 = lines.findIndex(l => l.includes('import { useWalletStore } from'));
  const i2 = lines.findIndex(l => l.includes('import { useTransactionStore, TransakOrderStatus } from'));
  if (i1 !== -1 && i2 !== -1) {
    lines[i2] = "import { useTransactionStore } from '../stores/transactionStore';\nimport type { TransakOrderStatus } from '../types/fiatGateway';";
  }

  // replace destructure
  const d = lines.findIndex(l => l.includes('const { setLatestTransakOrder, activeChain, address } = useWalletStore();'));
  if (d !== -1) {
    lines[d] = "  const { activeChain, address } = useWalletStore();\n  const setLatestTransakOrder = useTransactionStore(s => s.setLatestTransakOrder);";
  }
  
  fs.writeFileSync('src/screens/TransakWebViewScreen.tsx', lines.join('\n'));
}

try { fixWithdraw(); } catch (e) { console.error(e) }
try { fixSend(); } catch (e) { console.error(e) }
try { fixSettings(); } catch (e) { console.error(e) }
try { fixHistory(); } catch (e) { console.error(e) }
try { fixTransakWeb(); } catch (e) { console.error(e) }

console.log('Fixed arrays safely');
