# Graph Report - apps\consumer-app  (2026-04-25)

## Corpus Check
- 106 files · ~106,159 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 463 nodes · 607 edges · 25 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 104 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 34|Community 34]]

## God Nodes (most connected - your core abstractions)
1. `trackEvent()` - 31 edges
2. `captureError()` - 15 edges
3. `poolCall()` - 11 edges
4. `getStoredMnemonic()` - 10 edges
5. `createFallbackQuote()` - 10 edges
6. `RpcProviderPool` - 9 edges
7. `toQuoteFromApi()` - 9 edges
8. `estimateTransactionGas()` - 8 edges
9. `handleExternalWallet()` - 7 edges
10. `setClipboardString()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `handleGlobalError()` --calls--> `captureError()`  [INFERRED]
  apps\consumer-app\App.tsx → apps\consumer-app\src\utils\sentry.ts
- `bootstrapSession()` --calls--> `isWalletInitialized()`  [INFERRED]
  apps\consumer-app\App.tsx → apps\consumer-app\src\utils\transactions.ts
- `bootstrapSession()` --calls--> `validateAddress()`  [INFERRED]
  apps\consumer-app\App.tsx → apps\consumer-app\src\utils\deepLinking.ts
- `bootstrapSession()` --calls--> `getStoredMnemonic()`  [INFERRED]
  apps\consumer-app\App.tsx → apps\consumer-app\src\utils\transactions.ts
- `bootstrapSession()` --calls--> `deriveAddressFromMnemonic()`  [INFERRED]
  apps\consumer-app\App.tsx → apps\consumer-app\src\utils\bip39.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (36): trackEvent(), getClipboardModule(), getClipboardString(), setClipboardString(), createDemoEvmAddress(), handleBack(), handleGetTestnetETH(), handleGoHome() (+28 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (26): getCurrencySymbol(), buildTransakDepositUrl(), buildTransakWithdrawUrl(), calculateDepositFees(), calculateWithdrawalFees(), estimateCryptoAmount(), estimateFiatPayout(), formatFiat() (+18 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (22): bootstrapSession(), handleGlobalError(), fetchAllBalances(), fetchERC20Balances(), fetchNativeBalance(), withTimeout(), buildEndpoints(), getCircuit() (+14 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (18): handleImport(), handleBackupWallet(), handleExportPrivateKey(), clearStoredMnemonic(), createProvider(), deriveWalletFromMnemonic(), estimateGas(), getBalance() (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (14): parseDeepLink(), parseQueryParams(), validateAddress(), fetchBlockchainTransactions(), fetchIndexerTransactions(), fetchTransactionHistoryPage(), getChainTypeFromKey(), getCursor() (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (10): deriveAddressFromMnemonic(), deriveMultipleAddressesFromMnemonic(), generateMnemonic(), getSecureRandomBytesAsync(), sha256(), sha256PureJs(), validateMnemonic(), generateSecureSeed() (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.22
Nodes (12): applyBuffer(), buildStaticFallback(), computeUsdCost(), estimateTransactionGas(), fetchLiveEstimate(), getCacheKey(), isGasExpensive(), checkMnemonic() (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.36
Nodes (13): buildRequestKey(), createFallbackQuote(), createFallbackQuoteMap(), fetchFromCoinGecko(), getCachedQuotes(), getCachedTokenMarketQuote(), getTokenMarketData(), getTokenMarketQuote() (+5 more)

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (5): useBalancePolling(), normalizeAddress(), useActiveChain(), useWalletAddress(), validateAddress()

### Community 10 - "Community 10"
Cohesion: 0.18
Nodes (3): renderScreen(), ErrorBoundary, renderScreen()

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (7): cachePrice(), convertEthToUsd(), fetchFromCoinCap(), fetchFromCoinGecko(), getCachedPrice(), getETHPrice(), isCacheFresh()

### Community 12 - "Community 12"
Cohesion: 0.29
Nodes (8): createWalletConnectSession(), extractApprovalResult(), getSignClient(), getWalletConnectProjectId(), hasWalletConnectProjectId(), normalizeWalletConnectUri(), parseWalletConnectAccount(), toPublicSessionRequest()

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (7): hasRuntimeAnalyticsEnabled(), identifyUser(), initAnalytics(), resetAnalyticsUser(), shouldEnableAnalytics(), trackScreenView(), withMixpanel()

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (2): Ensure-MetroRunning(), Test-MetroRunning()

### Community 16 - "Community 16"
Cohesion: 0.33
Nodes (1): MainActivity

### Community 18 - "Community 18"
Cohesion: 0.33
Nodes (2): useToast(), TransactionHistoryScreen()

### Community 19 - "Community 19"
Cohesion: 0.4
Nodes (2): configureNotificationHandler(), ensureConfigured()

### Community 21 - "Community 21"
Cohesion: 0.5
Nodes (2): Get-AdbPath(), Get-SdkPath()

### Community 22 - "Community 22"
Cohesion: 0.6
Nodes (3): buildAlchemyUrl(), buildInfuraUrl(), getRpcUrl()

### Community 24 - "Community 24"
Cohesion: 0.5
Nodes (1): MainApplication

### Community 25 - "Community 25"
Cohesion: 0.5
Nodes (2): NetworkStatusBanner(), useNetworkStatus()

### Community 26 - "Community 26"
Cohesion: 0.5
Nodes (2): BiometricPrompt(), useBiometrics()

### Community 28 - "Community 28"
Cohesion: 0.83
Nodes (3): canTriggerHaptics(), triggerLightImpactHaptic(), triggerNotificationHaptic()

### Community 29 - "Community 29"
Cohesion: 0.83
Nodes (3): getApiKey(), getBackendBaseUrl(), registerPushDeviceToken()

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (2): isUrlAllowed(), openExternalUrl()

## Knowledge Gaps
- **Thin community `Community 14`** (8 nodes): `Ensure-AdbReverse()`, `Ensure-Java()`, `Ensure-MetroRunning()`, `Get-SdkPath()`, `Test-MetroRunning()`, `Wait-ForBootCompleted()`, `Wait-ForEmulatorDevice()`, `run-android-emulator.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (6 nodes): `MainActivity.kt`, `MainActivity`, `.createReactActivityDelegate()`, `.getMainComponentName()`, `.invokeDefaultOnBackPressed()`, `.onCreate()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (6 nodes): `Toast.tsx`, `TransactionHistoryScreen.tsx`, `Toast()`, `useToast()`, `renderHeader()`, `TransactionHistoryScreen()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (6 nodes): `usePushNotifications.ts`, `configureNotificationHandler()`, `ensureConfigured()`, `getProjectId()`, `isRunningInExpoGo()`, `usePushNotifications()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (5 nodes): `verify-app-links.ps1`, `Ensure-Device()`, `Get-AdbPath()`, `Get-SdkPath()`, `Invoke-DeepLinkIntent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (4 nodes): `MainApplication.kt`, `MainApplication`, `.onConfigurationChanged()`, `.onCreate()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (4 nodes): `NetworkStatusBanner()`, `NetworkStatusBanner.tsx`, `useNetworkStatus.ts`, `useNetworkStatus()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (4 nodes): `BiometricPrompt()`, `BiometricPrompt.tsx`, `useBiometrics.ts`, `useBiometrics()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (3 nodes): `isUrlAllowed()`, `openExternalUrl()`, `externalLink.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `trackEvent()` connect `Community 0` to `Community 13`, `Community 7`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `captureError()` connect `Community 2` to `Community 3`, `Community 4`, `Community 7`, `Community 10`, `Community 15`, `Community 22`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `signAndSendTransaction()` connect `Community 7` to `Community 2`, `Community 3`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 27 inferred relationships involving `trackEvent()` (e.g. with `handleBack()` and `handleConfirmSend()`) actually correct?**
  _`trackEvent()` has 27 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `captureError()` (e.g. with `handleGlobalError()` and `bootstrapSession()`) actually correct?**
  _`captureError()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `poolCall()` (e.g. with `fetchNativeBalance()` and `fetchLiveEstimate()`) actually correct?**
  _`poolCall()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `getStoredMnemonic()` (e.g. with `bootstrapSession()` and `handleBackupWallet()`) actually correct?**
  _`getStoredMnemonic()` has 5 INFERRED edges - model-reasoned connections that need verification._