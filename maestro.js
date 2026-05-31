const fs = require('fs');

const importFlow = `appId: com.veilpay.consumer
---
- launchApp:
    clearState: true
- assertVisible: 'Veilpay'
- tapOn: 'IMPORT WALLET'
- assertVisible: 'Secret Recovery Phrase'
- tapOn: 'Enter your 12 or 24-word phrase'
- inputText: 'apple banana cherry date elderberry fig grape honeydew kiwi lemon mango nectarine'
- tapOn: 'CONTINUE'
- assertVisible: 'Wallet Imported'
`;

const sendFlow = `appId: com.veilpay.consumer
---
- launchApp
- assertVisible: 'SEND'
- tapOn: 'SEND'
- assertVisible: 'SEND PAYMENT'
- tapOn: 'Enter Ethereum address'
- inputText: '0x1234567890123456789012345678901234567890'
- tapOn: '0.00'
- inputText: '0.1'
- tapOn: 'Add a note for this transaction'
- inputText: 'E2E Test'
- tapOn: 'CONTINUE'
- assertVisible: 'PRIVATE BY DEFAULT'
`;

const onrampFlow = `appId: com.veilpay.consumer
---
- launchApp
- assertVisible: 'BUY CRYPTO'
- tapOn: 'BUY CRYPTO'
- assertVisible: 'Select Provider'
- tapOn: 'Transak'
- assertVisible: 'You Pay'
- tapOn: '100'
- tapOn: 'CONTINUE TO PAYMENT'
`;

const privacyFlow = `appId: com.veilpay.consumer
---
- launchApp
- tapOn: 'SEND'
- tapOn: 'Enter Ethereum address'
- inputText: '0x1234567890123456789012345678901234567890'
- tapOn: '0.00'
- inputText: '1.5'
- tapOn: 'CONTINUE'
- assertVisible: 'PRIVATE BY DEFAULT'
- tapOn: 'MAXIMUM PRIVACY'
- assertVisible: 'Relayer Fee'
- tapOn: 'CONFIRM PAYMENT'
`;

const networkFlow = `appId: com.veilpay.consumer
---
- launchApp:
    clearState: true
- stopApp
# Simulate network degradation/offline
- runFlow:
    when:
      platform: Android
    commands:
      - runScript: 'adb shell svc wifi disable; adb shell svc data disable'
- launchApp
- assertVisible: 'Retrying connection'
# Re-enable network
- runFlow:
    when:
      platform: Android
    commands:
      - runScript: 'adb shell svc wifi enable; adb shell svc data enable'
- assertVisible: 'SEND'
`;

fs.writeFileSync('d:/Veilpay/apps/consumer-app/.maestro/flow_wallet_import.yaml', importFlow);
fs.writeFileSync('d:/Veilpay/apps/consumer-app/.maestro/flow_send_payment.yaml', sendFlow);
fs.writeFileSync('d:/Veilpay/apps/consumer-app/.maestro/flow_fiat_onramp.yaml', onrampFlow);
fs.writeFileSync('d:/Veilpay/apps/consumer-app/.maestro/flow_max_privacy_payment.yaml', privacyFlow);
fs.writeFileSync('d:/Veilpay/apps/consumer-app/.maestro/flow_network_degradation.yaml', networkFlow);
console.log('Maestro E2E flows fleshed out.');
