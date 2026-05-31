const fs = require('fs');
const path = require('path');

const srcDir = 'd:\\Veilpay\\apps\\consumer-app\\src';

const settingsKeys = ['theme', 'biometricsEnabled', 'notificationsEnabled', 'analyticsEnabled', 'defaultPrivacyLevel', 'pushToken', 'setTheme', 'setBiometricsEnabled', 'setNotificationsEnabled', 'setAnalyticsEnabled', 'setPrivacyLevel', 'setPushToken'];

const transactionKeys = ['transactions', 'transactionsCursor', 'hasMoreTransactions', 'isLoadingTransactions', 'transactionsError', 'latestTransakOrder', 'latestOnrampOrder', 'setTransactions', 'addTransaction', 'fetchTransactions', 'refreshTransactions', 'loadMoreTransactions', 'setLatestTransakOrder', 'clearLatestTransakOrder', 'setLatestOnrampOrder', 'clearLatestOnrampOrder', 'clearTransactions'];

function processFile(filePath) {
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;

  let content = fs.readFileSync(filePath, 'utf-8');
  let originalContent = content;

  // We need to see if the file uses settings or transactions from walletStore
  let usesSettings = false;
  let usesTransactions = false;

  settingsKeys.forEach(k => {
    if (new RegExp(`\\b${k}\\b`).test(content)) usesSettings = true;
  });
  transactionKeys.forEach(k => {
    if (new RegExp(`\\b${k}\\b`).test(content)) usesTransactions = true;
  });

  if (!usesSettings && !usesTransactions) return; // Only process if we need to add imports

  // 1. Add missing imports if needed
  if (usesSettings && !content.includes('settingsStore')) {
    content = content.replace(/(import .* from '.*\/walletStore';?)/, `$1\nimport { useSettingsStore, useThemeState, usePrivacyLevel } from '../stores/settingsStore';`);
    // Fix imports if the relative path is different
    content = content.replace(/import { useSettingsStore, useThemeState, usePrivacyLevel } from '\.\.\/stores\/settingsStore';/, (match, offset, string) => {
       const walletImport = string.match(/import .* from '(.*)\/walletStore';?/);
       if(walletImport) return `import { useSettingsStore, useThemeState, usePrivacyLevel } from '${walletImport[1]}/settingsStore';`;
       return match;
    });
  }

  if (usesTransactions && !content.includes('transactionStore')) {
    content = content.replace(/(import .* from '.*\/walletStore';?)/, `$1\nimport { useTransactionStore, useTransactions } from '../stores/transactionStore';`);
    content = content.replace(/import { useTransactionStore, useTransactions } from '\.\.\/stores\/transactionStore';/, (match, offset, string) => {
       const walletImport = string.match(/import .* from '(.*)\/walletStore';?/);
       if(walletImport) return `import { useTransactionStore, useTransactions } from '${walletImport[1]}/transactionStore';`;
       return match;
    });
  }

  // 2. Replace useWalletStore.getState()
  settingsKeys.forEach(k => {
    const r1 = new RegExp(`useWalletStore\\.getState\\(\\)\\.${k}`, 'g');
    content = content.replace(r1, `useSettingsStore.getState().${k}`);
  });
  transactionKeys.forEach(k => {
    const r1 = new RegExp(`useWalletStore\\.getState\\(\\)\\.${k}`, 'g');
    content = content.replace(r1, `useTransactionStore.getState().${k}`);
  });

  // 3. Replace destructured useWalletStore(...)
  // E.g. const { theme } = useWalletStore(); -> we need to manually fix these in the file.
  // We can do a simple string replace for specific hooks where known.
  
  // Specific hooks like useThemeState, usePrivacyLevel, useTransactions have been moved.
  content = content.replace(/import {([^}]*)useThemeState([^}]*)} from '.*\/walletStore';?/g, (match, p1, p2) => {
     return match.replace('useThemeState', '').replace(/,\s*,/g, ',');
  });
  content = content.replace(/import {([^}]*)usePrivacyLevel([^}]*)} from '.*\/walletStore';?/g, (match, p1, p2) => {
     return match.replace('usePrivacyLevel', '').replace(/,\s*,/g, ',');
  });
  content = content.replace(/import {([^}]*)useTransactions([^}]*)} from '.*\/walletStore';?/g, (match, p1, p2) => {
     return match.replace('useTransactions', '').replace(/,\s*,/g, ',');
  });

  // Just to be safe, we will rely on TS errors to fix complex destructuring,
  // but we can replace basic useWalletStore(state => state.X) usages
  settingsKeys.forEach(k => {
    const r1 = new RegExp(`useWalletStore\\(\\s*\\(?\\s*([a-zA-Z0-9_]+)\\s*\\)?\\s*=>\\s*\\1\\.${k}\\s*\\)`, 'g');
    content = content.replace(r1, `useSettingsStore($1 => $1.${k})`);
  });
  transactionKeys.forEach(k => {
    const r1 = new RegExp(`useWalletStore\\(\\s*\\(?\\s*([a-zA-Z0-9_]+)\\s*\\)?\\s*=>\\s*\\1\\.${k}\\s*\\)`, 'g');
    content = content.replace(r1, `useTransactionStore($1 => $1.${k})`);
  });

  // Simple destructuring replacements if they are the only thing destructured
  settingsKeys.forEach(k => {
    const r1 = new RegExp(`const\\s*{\\s*${k}\\s*}\\s*=\\s*useWalletStore\\(\\);?`, 'g');
    content = content.replace(r1, `const { ${k} } = useSettingsStore();`);
  });
  transactionKeys.forEach(k => {
    const r1 = new RegExp(`const\\s*{\\s*${k}\\s*}\\s*=\\s*useWalletStore\\(\\);?`, 'g');
    content = content.replace(r1, `const { ${k} } = useTransactionStore();`);
  });

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    console.log('Updated:', filePath);
  }
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else {
      processFile(fullPath);
    }
  }
}

walk(srcDir);
console.log('Done.');
