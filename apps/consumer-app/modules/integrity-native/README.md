# @veilpay/expo-integrity-native

Google Play Integrity (app attestation) bridge for Veilpay — Hardening #2.

The backend now gates the onramp (`/url`, `/quotes`) and RPC-proxy routes behind
Play Integrity: a request only passes if it carries a Play Integrity token minted
against a backend-issued nonce, verified server-side via Google's
`decodeIntegrityToken` endpoint. This module is the *client* half that mints
that token on-device.

## Current status

The JS surface (`src/index.ts`) and the Expo module skeleton are in place, and
the backend verifier is complete and tested. The **native Kotlin implementation
is intentionally NOT registered yet** (`expo-module.config.json` has an empty
`android.modules` list). That is deliberate: the Play Integrity SDK cannot
compile or run until the Play Console wiring below exists, and leaving it
unregistered keeps the app buildable while attestation is in rollout.

## What the backend needs (set via Doppler / env)

| Env var | Source | Example |
| --- | --- | --- |
| `PLAY_INTEGRITY_ENABLED` | operator | `false` (flip to `true` to enforce) |
| `PLAY_INTEGRITY_PACKAGE_NAME` | Play Console | `com.veilpay.consumer` |
| `PLAY_INTEGRITY_APP_CERT_SHA256` | Play Console → app signature (SHA-256 fingerprint) | `AA:BB:CC:...` |
| `PLAY_INTEGRITY_SERVICE_ACCOUNT_B64` | Google Cloud service account JSON (base64) for the Cloud project linked to the Play Console app | `eyJ...` |
| `PLAY_INTEGRITY_MIN_DEVICE_VERDICT` | operator | `MEETS_DEVICE_INTEGRITY` |

Fail-closed behaviour: in production with `PLAY_INTEGRITY_ENABLED=true` but any
of the three required values missing, the backend **refuses to boot**. With the
flag off in production, the attested endpoints return `503 ATTESTATION_NOT_CONFIGURED`
rather than silently opening. In dev/test with the flag off they pass through so
the app keeps working during rollout. When `PLAY_INTEGRITY_ENABLED=true` is set,
the app must send attestation headers (below).

## Irreducible Play Console steps (must be done by a Googler/ops, cannot be done from this repo)

1. **Register the app in Play Console** and add the **Play Integrity API** to the
   linked Google Cloud project.
2. Enable **Google Play App Signing** and copy the **SHA-256 certificate fingerprint**
   → `PLAY_INTEGRITY_APP_CERT_SHA256`.
3. Create a **service account** in the linked Cloud project, grant it
   `Play Integrity` access, download its JSON key → `PLAY_INTEGRITY_SERVICE_ACCOUNT_B64`.
4. Add `com.google.android.play:integrity` to Gradle ([build.gradle](android/build.gradle))
   and implement the Kotlin module (below).

## Native Kotlin implementation (reference)

When the above is in place, add this module class and register it in
`expo-module.config.json` under `android.modules`, then uncomment the
`implementation "com.google.android.play:integrity"` dependency. The code below
is written against the documented Play Integrity API but has NOT been compiled
or run against a live token in this repo — validate it on a device with Google's
Play Integrity test tooling before shipping.

```kotlin
package expo.modules.integritynative

import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class IntegrityNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("IntegrityNative")
    AsyncFunction("requestIntegrityToken") { nonce: String ->
      val manager = IntegrityManagerFactory.create(appContext.reactContext ?: context)
      val request = IntegrityTokenRequest.builder().setNonce(nonce).build()
      // Await the Task<String> and return it to JS (promise bridging omitted here —
      // wire through a suspendCoroutine / Tasks.await as your module convention dictates).
      Tasks.await(manager.requestIntegrityToken(request))
    }
  }
}
```

## Client rollout

The app's [attestation service](../../src/services/attestation.ts) only attaches
headers when `EXPO_PUBLIC_PLAY_INTEGRITY_ENABLED=true`. Keep it off until the
backend + native module are both live in a given environment, then flip both
together. Until the native module is linked, requests are sent without
attestation headers and the backend fail-closes them — so the app will surface
attestation failures rather than silently pass, which is the intended posture.
