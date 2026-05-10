# Android App Links Setup

This app already declares Android app links in `android/app/src/main/AndroidManifest.xml`:

- Scheme link: `veilpay://...`
- HTTPS app link host: `https://veilpay.app/...` with `android:autoVerify="true"`

If generic HTTPS links still open in the browser, domain verification has not completed for your package + signing certificate.

## 1) Publish `assetlinks.json` On Your Domain

Host this file at:

- `https://veilpay.app/.well-known/assetlinks.json`

Example payload:

```json
[
  {
    "relation": [
      "delegate_permission/common.handle_all_urls"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "com.veilpay.consumer",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
      ]
    }
  }
]
```

Requirements:

- Must be served with `200 OK`.
- Must be served from the exact `/.well-known/assetlinks.json` path.
- Must use `application/json` content type.
- Must not redirect.
- Fingerprint must match the signing cert of the installed build.
- The helper script reads fingerprints from Gradle `signingReport` and outputs valid JSON.

## 2) Get SHA-256 Signing Fingerprints

From `apps/consumer-app/android`:

```powershell
.\gradlew signingReport
```

Or from project root using the helper script:

```powershell
.\scripts\generate-assetlinks-json.ps1 -PrintOnly
```

Write a deployable file:

```powershell
.\scripts\generate-assetlinks-json.ps1 -OutputPath .\assetlinks.json
```

Debug-only fingerprint output:

```powershell
.\scripts\generate-assetlinks-json.ps1 -Variants debug -PrintOnly
```

Use the SHA-256 value for the build you are installing:

- Debug builds: debug signing key fingerprint
- Release builds: production release signing key fingerprint

Latest locally generated debug fingerprint (2026-03-31):

- `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`

If both debug and release builds are used for testing, include both fingerprints in `sha256_cert_fingerprints`.

Generated file (ready to publish):

- `apps/consumer-app/assetlinks.json`

## 3) Verify On Device/Emulator

Use the script:

```powershell
.\scripts\verify-app-links.ps1 -OpenIntents
```

Or manually:

```powershell
adb shell pm get-app-links com.veilpay.consumer
adb shell am start -W -a android.intent.action.VIEW -d "https://veilpay.app/send?address=0x1111111111111111111111111111111111111111"
```

Optional re-verify flow:

```powershell
adb shell pm set-app-links --package com.veilpay.consumer 0 all
adb shell pm verify-app-links --re-verify com.veilpay.consumer
adb shell pm get-app-links com.veilpay.consumer
```

## 4) Expected Behavior

- `veilpay://...` should route into the app (already validated).
- Generic `https://veilpay.app/...` should route directly into the app only after domain verification succeeds.
- If verification is pending/denied, Android may open the browser by default.

## 5) Latest Validation Snapshot (2026-03-31)

Observed on emulator package `com.veilpay.consumer`:

- Domain verification state returned: `veilpay.app: 1024`
- Custom scheme intent (`veilpay://...`) opened `com.veilpay.consumer/.MainActivity`
- Generic HTTPS intent (`https://veilpay.app/...`) opened Chrome
- Explicit HTTPS intent with component target opened `com.veilpay.consumer/.MainActivity`

Interpretation:

- App intent filters are functioning.
- Domain association is still incomplete for default HTTPS routing.
- Next fix is server-side `assetlinks.json` + correct signing fingerprint(s).