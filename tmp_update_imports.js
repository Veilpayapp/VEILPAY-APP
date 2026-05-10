const fs = require('fs');
const files = [
  'apps/consumer-app/src/components/TransakChooserModal.tsx',
  'apps/consumer-app/src/components/FeatureCard.tsx',
  'apps/consumer-app/src/components/NetworkSelectorModal.tsx',
  'apps/consumer-app/src/components/EmptyState.tsx',
  'apps/consumer-app/src/screens/ReceiveQRScreen.tsx',
  'apps/consumer-app/src/screens/PrivacyLevelScreen.tsx',
  'apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx',
  'apps/consumer-app/src/screens/OnboardingScreen.tsx',
  'apps/consumer-app/src/screens/CreateWalletScreen.tsx',
  'apps/consumer-app/src/screens/SettingsScreen.tsx',
  'apps/consumer-app/src/screens/WalletConnectScreen.tsx',
  'apps/consumer-app/src/screens/TokenSelectorScreen.tsx',
  'apps/consumer-app/src/screens/HomeDashboardScreen.tsx',
  'apps/consumer-app/src/screens/TransactionHistoryScreen.tsx',
  'apps/consumer-app/src/screens/ImportWalletScreen.tsx',
  'apps/consumer-app/src/screens/TransactionDetailsScreen.tsx',
  'apps/consumer-app/src/screens/AddCustomNetworkScreen.tsx',
];

for (const f of files) {
  let content = fs.readFileSync(f, 'utf8');
  
  // Replace import paths for HybridCard -> SovereignCard
  content = content.replace(/from\s+(['"'][^'"']*)HybridCard(['"'])/g, "from $1SovereignCard$2");
  
  // Replace import paths for HybridButton -> SovereignButton
  content = content.replace(/from\s+(['"'][^'"']*)HybridButton(['"'])/g, "from $1SovereignButton$2");
  
  // ReplaceAll usages in the file
  content = content.replace(/HybridCard/g, 'SovereignCard');
  content = content.replace(/HybridButton/g, 'SovereignButton');
  
  fs.writeFileSync(f, content, 'utf8');
  console.log('Updated: ' + f);
}
