package expo.modules.sppnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Expo bridge for Stellar Private Payments native ops.
 *
 * Phase 1b: pure Kotlin stubs when `libspp_native.so` is absent.
 * Phase 1c: [SppNativeRust.tryLoad] succeeds → call Rust C ABI via JNI;
 *           flip `poolOps` / `aspLeaf` from capability bitmask when sdk/pool lands.
 *
 * Product path is native-only — not a WebView of sdk/web.
 */
class SppNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SppNative")

    OnCreate {
      SppNativeRust.tryLoad()
    }

    Function("version") {
      if (SppNativeRust.loaded) {
        SppNativeRust.nativeVersion()
      } else {
        KOTLIN_STUB_VERSION
      }
    }

    Function("ping") { input: String? ->
      if (SppNativeRust.loaded) {
        SppNativeRust.nativePing(input)
      } else if (input.isNullOrEmpty()) {
        "pong"
      } else {
        "pong:$input"
      }
    }

    Function("capabilities") {
      if (SppNativeRust.loaded) {
        val bits = SppNativeRust.nativeCapabilities()
        mapOf(
          "version" to SppNativeRust.nativeVersion(),
          "ping" to ((bits and CAP_PING) != 0),
          "poolOps" to ((bits and CAP_POOL_OPS) != 0),
          "aspLeaf" to ((bits and CAP_ASP_LEAF) != 0),
          "backend" to "native"
        )
      } else {
        mapOf(
          "version" to KOTLIN_STUB_VERSION,
          "ping" to true,
          // Flip when Rust sdk/pool is linked via NDK (CAP_POOL_OPS).
          "poolOps" to false,
          "aspLeaf" to false,
          "backend" to "native"
        )
      }
    }

    Function("deposit") { amount: String ->
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativeDeposit(amount))
      } else {
        notReady("deposit", "amount=$amount")
      }
    }

    Function("transfer") { amount: String, recipient: String ->
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativeTransfer(amount, recipient))
      } else {
        notReady("transfer", "amount=$amount recipientLen=${recipient.length}")
      }
    }

    Function("withdraw") { amount: String, to: String ->
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativeWithdraw(amount, to))
      } else {
        notReady("withdraw", "amount=$amount toLen=${to.length}")
      }
    }

    Function("ensureAsp") {
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativeEnsureAsp())
      } else {
        mapOf(
          "ok" to false,
          "code" to "SPP_ASP_NOT_READY",
          "op" to "ensure_asp",
          "message" to
            "ASP leaf helper not linked in native module yet. Select pXLM under Privacy to set up keys; NDK .so enables leaf compute."
        )
      }
    }

    Function("deriveKeys") { sigHex: String, network: String ->
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativeDeriveKeys(sigHex, network))
      } else {
        mapOf(
          "ok" to false,
          "code" to "SPP_DERIVE_NOT_READY",
          "op" to "derive_keys",
          "message" to
            "Rust libspp_native.so not loaded. Build with cargo-ndk to enable Poseidon2 key derive + ASP leaf."
        )
      }
    }

    Function("poolReadiness") {
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativePoolReadiness())
      } else {
        mapOf(
          "ok" to false,
          "op" to "pool_readiness",
          "poolOpsLinked" to false,
          "capPoolOps" to false,
          "message" to "libspp_native.so not loaded; EAS post-install cargo-ndk builds the .so",
          "requirements" to listOf(
            "Ship libspp_native.so via EAS NDK hook",
            "Link sdk/pool feature pool-ops",
            "Ship policy_tx_2_2 circuit artifacts"
          )
        )
      }
    }
  }

  private fun notReady(op: String, detail: String): Map<String, Any?> {
    return mapOf(
      "ok" to false,
      "code" to "SPP_OPS_NOT_READY",
      "op" to op,
      "message" to
        "Native sdk/pool not linked yet ($detail). Phase 0 CLI path works; NDK link is next."
    )
  }

  /** Parse JSON from Rust C ABI op stubs into a Map for Expo. */
  private fun jsonResult(raw: String): Map<String, Any?> {
    return try {
      val o = JSONObject(raw)
      val out = mutableMapOf<String, Any?>()
      val keys = o.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        out[k] = o.opt(k)
      }
      out
    } catch (_: Exception) {
      mapOf(
        "ok" to false,
        "code" to "SPP_NATIVE_BAD_JSON",
        "message" to "Native returned non-JSON result"
      )
    }
  }

  companion object {
    private const val KOTLIN_STUB_VERSION = "0.1.0-native-android"
    private const val CAP_PING = 1
    private const val CAP_POOL_OPS = 1 shl 1
    private const val CAP_ASP_LEAF = 1 shl 2
  }
}
