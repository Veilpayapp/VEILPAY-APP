package expo.modules.sppnative

/**
 * Optional JNI entry to `libspp_native.so` (packages/spp-native).
 *
 * Phase 1b: Kotlin stubs in [SppNativeModule] are the live path.
 * Phase 1c: build the cdylib for Android ABIs, drop under jniLibs, then
 * [tryLoad] succeeds and [SppNativeModule] prefers these externals.
 *
 * C ABI symbols (also available for non-JNI callers):
 *   spp_native_version, spp_native_ping, spp_native_capabilities,
 *   spp_native_deposit, spp_native_transfer, spp_native_withdraw,
 *   spp_native_ensure_asp, spp_native_string_free
 *
 * JNI names below match packages/spp-native `android-jni` feature.
 */
internal object SppNativeRust {
  @Volatile
  var loaded: Boolean = false
    private set

  /**
   * Attempt to load the Rust cdylib. Safe to call multiple times.
   * Returns true when JNI externals are usable.
   */
  fun tryLoad(): Boolean {
    if (loaded) return true
    return try {
      System.loadLibrary("spp_native")
      loaded = true
      true
    } catch (_: UnsatisfiedLinkError) {
      loaded = false
      false
    }
  }

  @JvmStatic external fun nativeVersion(): String

  @JvmStatic external fun nativePing(input: String?): String

  /** Bitmask: bit0=ping, bit1=poolOps, bit2=aspLeaf */
  @JvmStatic external fun nativeCapabilities(): Int

  @JvmStatic external fun nativeDeposit(amount: String): String

  @JvmStatic external fun nativeTransfer(amount: String, recipient: String): String

  @JvmStatic external fun nativeWithdraw(amount: String, to: String): String

  @JvmStatic external fun nativeEnsureAsp(): String

  /** SEP-53 sig hex + network → JSON with leafDecimal / note pubkeys */
  @JvmStatic external fun nativeDeriveKeys(sigHex: String, network: String): String

  /** JSON readiness for CAP_POOL_OPS / sdk/pool link */
  @JvmStatic external fun nativePoolReadiness(): String

  /** Bind PrivatePool session (JSON config; never log). */
  @JvmStatic external fun nativePoolOpen(configJson: String): String

  @JvmStatic external fun nativePoolClose(): String
}
