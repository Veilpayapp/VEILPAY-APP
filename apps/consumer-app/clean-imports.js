const fs = require('fs');

const files = [
  'src/hooks/useOnramp.ts',
  'src/navigation/AppNavigator.tsx',
  'src/screens/DepositCryptoScreen.tsx',
  'src/screens/ExportPrivateKeyScreen.tsx',
  'src/screens/PrivacyLevelScreen.tsx',
  'src/screens/SendPaymentScreen.tsx',
  'src/screens/SettingsScreen.tsx',
  'src/screens/TransactionHistoryScreen.tsx',
  'src/screens/TransakWebViewScreen.tsx',
  'src/stores/__tests__/walletStore.test.ts',
  'src/stores/transactionStore.ts'
];

files.forEach(f => {
  try {
    let lines = fs.readFileSync(f, 'utf8').split('\n');
    let out = [];
    let seenUseWalletStore = false;
    let seenUseTransactionStore = false;
    let seenUseSettingsStore = false;
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (line.includes('import { useWalletStore } from \'../stores/walletStore\';') || line.includes('import { useWalletStore } from "../stores/walletStore";')) {
        if (seenUseWalletStore) continue;
        seenUseWalletStore = true;
      }
      if (line.includes('import { useTransactionStore } from \'../stores/transactionStore\';') || line.includes('import { useTransactionStore } from "../stores/transactionStore";')) {
        if (seenUseTransactionStore) continue;
        seenUseTransactionStore = true;
      }
      if (line.includes('import { useSettingsStore } from \'../stores/settingsStore\';') || line.includes('import { useSettingsStore } from "../stores/settingsStore";')) {
        if (seenUseSettingsStore) continue;
        seenUseSettingsStore = true;
      }
      out.push(line);
    }
    fs.writeFileSync(f, out.join('\n'));
  } catch (e) {
  }
});
console.log('Fixed imports again');
