import ExpoModulesCore

/**
 * Expo bridge for Stellar Private Payments native ops (iOS).
 * Phase 1b: Swift stubs matching Android / Rust C ABI semantics.
 * Phase 1c: link packages/spp-native staticlib via UniFFI or C ABI.
 */
public class SppNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SppNative")

    Function("version") { () -> String in
      return "0.1.0-native-ios"
    }

    Function("ping") { (input: String?) -> String in
      guard let input = input, !input.isEmpty else {
        return "pong"
      }
      return "pong:\(input)"
    }

    Function("capabilities") { () -> [String: Any] in
      return [
        "version": "0.1.0-native-ios",
        "ping": true,
        "poolOps": false,
        "aspLeaf": false,
        "backend": "native"
      ]
    }

    Function("deposit") { (amount: String) -> [String: Any] in
      return self.notReady(op: "deposit", detail: "amount=\(amount)")
    }

    Function("transfer") { (amount: String, recipient: String) -> [String: Any] in
      return self.notReady(
        op: "transfer",
        detail: "amount=\(amount) recipientLen=\(recipient.count)"
      )
    }

    Function("withdraw") { (amount: String, to: String) -> [String: Any] in
      return self.notReady(op: "withdraw", detail: "amount=\(amount) toLen=\(to.count)")
    }

    Function("ensureAsp") { () -> [String: Any] in
      return [
        "ok": false,
        "code": "SPP_ASP_NOT_READY",
        "op": "ensure_asp",
        "message":
          "ASP leaf helper not linked yet. Select pXLM under Privacy; native derive comes with the SPP staticlib."
      ]
    }

    Function("deriveKeys") { (sigHex: String, network: String) -> [String: Any] in
      return [
        "ok": false,
        "code": "SPP_DERIVE_NOT_READY",
        "op": "derive_keys",
        "message":
          "iOS staticlib link pending (sigLen=\(sigHex.count) network=\(network))."
      ]
    }
  }

  private func notReady(op: String, detail: String) -> [String: Any] {
    return [
      "ok": false,
      "code": "SPP_OPS_NOT_READY",
      "op": op,
      "message":
        "Native sdk/pool not linked yet (\(detail)). Phase 0 CLI path works; native link is next."
    ]
  }
}
