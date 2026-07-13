package expo.modules.sppnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
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
      if (SppNativeRust.tryLoad()) {
        initPlatformVerifier()
      }
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

    Function("platformInit") {
      if (SppNativeRust.loaded) {
        initPlatformVerifier()
      } else {
        mapOf(
          "ok" to false,
          "code" to "SPP_OPS_NOT_READY",
          "op" to "platform_init",
          "message" to "libspp_native.so not loaded"
        )
      }
    }

    Function("deposit") { amount: String ->
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativeDeposit(amount))
      } else {
        notReady("deposit", "pool-ops unavailable")
      }
    }

    Function("transfer") { amount: String, recipient: String ->
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativeTransfer(amount, recipient))
      } else {
        notReady("transfer", "pool-ops unavailable")
      }
    }

    Function("withdraw") { amount: String, to: String ->
      if (SppNativeRust.loaded) {
        jsonResult(SppNativeRust.nativeWithdraw(amount, to))
      } else {
        notReady("withdraw", "pool-ops unavailable")
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

    Function("poolOpen") { configJson: String ->
      if (!SppNativeRust.loaded) {
        return@Function notReady("pool_open", "libspp_native.so not loaded")
      }
      try {
        jsonResult(SppNativeRust.nativePoolOpen(configJson))
      } catch (e: UnsatisfiedLinkError) {
        linkMissing("pool_open", e)
      } catch (e: Exception) {
        nativeException("pool_open", e)
      }
    }

    Function("poolClose") {
      if (!SppNativeRust.loaded) {
        return@Function mapOf("ok" to true, "op" to "pool_close", "message" to "no-op without .so")
      }
      try {
        jsonResult(SppNativeRust.nativePoolClose())
      } catch (e: UnsatisfiedLinkError) {
        // Close is best-effort on outdated .so
        mapOf("ok" to true, "op" to "pool_close", "message" to "no-op (symbol missing)")
      } catch (e: Exception) {
        mapOf("ok" to true, "op" to "pool_close", "message" to (e.message ?: "close failed"))
      }
    }

    // DATA-001: chain-backed note recovery primitives (session must be open).
    // Catch UnsatisfiedLinkError: older .so may load but lack pool_sync/balance symbols.
    Function("poolSync") {
      if (!SppNativeRust.loaded) {
        return@Function notReady("pool_sync", "libspp_native.so not loaded")
      }
      try {
        jsonResult(SppNativeRust.nativePoolSync())
      } catch (e: UnsatisfiedLinkError) {
        linkMissing("pool_sync", e)
      } catch (e: Exception) {
        nativeException("pool_sync", e)
      }
    }

    Function("poolBalance") {
      if (!SppNativeRust.loaded) {
        return@Function notReady("pool_balance", "libspp_native.so not loaded")
      }
      try {
        jsonResult(SppNativeRust.nativePoolBalance())
      } catch (e: UnsatisfiedLinkError) {
        linkMissing("pool_balance", e)
      } catch (e: Exception) {
        nativeException("pool_balance", e)
      }
    }

    /**
     * Writable absolute path for SQLite + circuit staging (no file:// prefix).
     * Prefers external app files dir so `adb push .../Android/data/<pkg>/files/` works.
     */
    Function("appDataDir") {
      appDataDirPath()
    }

    Function("ensureCircuitAssets") {
      ensureCircuitAssets()
    }
  }

  private fun appDataDirPath(): String {
    val ctx = appContext.reactContext ?: return ""
    val external = ctx.getExternalFilesDir(null)
    val dir = external ?: ctx.filesDir
    return dir.absolutePath.trimEnd('/')
  }

  private fun initPlatformVerifier(): Map<String, Any?> {
    val ctx = appContext.reactContext?.applicationContext
      ?: appContext.reactContext
      ?: return mapOf(
        "ok" to false,
        "code" to "SPP_NO_CONTEXT",
        "op" to "platform_init",
        "message" to "Android context unavailable for rustls platform verifier initialization"
      )

    return try {
      jsonResult(SppNativeRust.nativeInitPlatform(ctx))
    } catch (e: UnsatisfiedLinkError) {
      mapOf(
        "ok" to false,
        "code" to "SPP_PLATFORM_INIT_UNAVAILABLE",
        "op" to "platform_init",
        "message" to "Native rustls platform verifier init symbol unavailable"
      )
    } catch (e: Exception) {
      mapOf(
        "ok" to false,
        "code" to "SPP_PLATFORM_INIT_EXCEPTION",
        "op" to "platform_init",
        "message" to (e.message ?: "rustls platform verifier initialization failed")
      )
    }
  }

  private fun ensureCircuitAssets(): Map<String, Any?> {
    val ctx = appContext.reactContext
      ?: return mapOf(
        "ok" to false,
        "code" to "SPP_NO_CONTEXT",
        "op" to "ensure_circuit_assets",
        "message" to "Android context unavailable for circuit asset seeding"
      )
    val root = appDataDirPath()
    if (root.isEmpty()) {
      return mapOf(
        "ok" to false,
        "code" to "SPP_STORAGE_PATH",
        "op" to "ensure_circuit_assets",
        "message" to "No writable app data directory for SPP circuit assets"
      )
    }

    val targetDir = File(root, "spp/circuits")
    if (!targetDir.exists() && !targetDir.mkdirs()) {
      return mapOf(
        "ok" to false,
        "code" to "SPP_STORAGE_PATH",
        "op" to "ensure_circuit_assets",
        "message" to "Could not create SPP circuit asset directory"
      )
    }

    val copied = mutableListOf<String>()
    val missing = mutableListOf<String>()
    val required = listOf(
      "policy_tx_2_2_proving_key.bin",
      "policy_tx_2_2.wasm",
      "policy_tx_2_2.r1cs"
    )

    for (name in required) {
      val out = File(targetDir, name)
      if (out.exists() && out.length() > 0L) continue

      try {
        ctx.assets.open("spp/circuits/$name").use { input ->
          out.outputStream().use { output -> input.copyTo(output) }
        }
        copied.add(name)
      } catch (_: Exception) {
        missing.add(name)
        if (out.exists() && out.length() == 0L) out.delete()
      }
    }

    return if (missing.isEmpty()) {
      mapOf(
        "ok" to true,
        "op" to "ensure_circuit_assets",
        "message" to if (copied.isEmpty()) "Circuit assets already staged" else "Circuit assets staged from APK",
        "circuitsDir" to targetDir.absolutePath,
        "copied" to copied
      )
    } else {
      mapOf(
        "ok" to false,
        "code" to "SPP_CIRCUITS_NOT_BUNDLED",
        "op" to "ensure_circuit_assets",
        "message" to "APK missing bundled SPP circuit assets: ${missing.joinToString(", ")}",
        "circuitsDir" to targetDir.absolutePath
      )
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

  /** Older jniLibs may omit newer JNI exports — never throw into Expo (red banner). */
  private fun linkMissing(op: String, e: UnsatisfiedLinkError): Map<String, Any?> {
    return mapOf(
      "ok" to false,
      "code" to "SPP_JNI_SYMBOL_MISSING",
      "op" to op,
      "message" to
        "Native library is outdated (missing $op). Rebuild libspp_native.so with pool-ops."
    )
  }

  private fun nativeException(op: String, e: Exception): Map<String, Any?> {
    return mapOf(
      "ok" to false,
      "code" to "SPP_NATIVE_EXCEPTION",
      "op" to op,
      "message" to (e.message ?: "Native $op failed")
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
