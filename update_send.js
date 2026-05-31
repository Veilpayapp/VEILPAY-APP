const fs = require('fs');
const file = 'd:/Veilpay/apps/consumer-app/src/screens/SendPaymentScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Change SUPPORTED_CHAIN_TYPES to only 'evm'
content = content.replace(
  "const SUPPORTED_CHAIN_TYPES = new Set(['evm', 'svm', 'mvm', 'xlm']);",
  "const SUPPORTED_CHAIN_TYPES = new Set(['evm']);"
);

// 2. Wrap the inputs
const startMarker = "            {/* Recipient Address */}";
const endMarker = "            {/* Privacy Notice */}";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex > -1 && endIndex > -1) {
  const originalInputs = content.substring(startIndex, endIndex);
  const newInputs = `            {isNativeTransferSupported ? (
              <>
${originalInputs}              </>
            ) : (
              <SovereignCard backgroundColor={colors.surfaceCard} padding={24} style={{ marginBottom: 24, alignItems: 'center' }}>
                <Icon name="info" size={32} color={colors.accent} />
                <Text style={[styles.headerTitle, { marginTop: 16, marginBottom: 8, textAlign: 'center' }]}>
                  {activeChain?.name?.toUpperCase()} COMING SOON
                </Text>
                <Text style={[styles.privacyDesc, { textAlign: 'center' }]}>
                  Send payments are currently only supported on EVM networks in this build. Support for {activeChain?.name} is actively being developed.
                </Text>
              </SovereignCard>
            )}
`;
  content = content.substring(0, startIndex) + newInputs + content.substring(endIndex);
  fs.writeFileSync(file, content);
  console.log("Updated SendPaymentScreen.tsx");
} else {
  console.log("Could not find markers.");
}
