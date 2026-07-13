//! VeilPay SPP native FFI.
//!
//! - `version` / `ping` / `capabilities`
//! - `derive_keys` — SEP-53 signature → note/enc pubkeys + ASP leaf (Poseidon2)
//! - `pool_open` / deposit / transfer / withdraw when feature `pool-ops` links sdk/pool
//!
//! Product path is native-only — **not** a product WebView of `sdk/web`.

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
#[cfg(feature = "pool-ops")]
use std::panic::{catch_unwind, AssertUnwindSafe};

#[cfg(feature = "android-jni")]
mod android_jni;

mod derive;
mod pool_ops;

#[cfg(feature = "pool-ops")]
mod session;

/// Package version string (semver from Cargo).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Capability flags (bitmask) for the RN bridge.
///
/// - bit 0: `ping` / `version` available
/// - bit 1: pool ops (deposit/transfer/withdraw) — set when sdk/pool linked
/// - bit 2: ASP membership leaf helper — set when derive_keys ready
pub const CAP_PING: u32 = 1;
pub const CAP_POOL_OPS: u32 = 1 << 1;
pub const CAP_ASP_LEAF: u32 = 1 << 2;

/// True when feature `pool-ops` links `stellar-private-payments-sdk`.
#[inline]
fn pool_ops_linked() -> bool {
    cfg!(feature = "pool-ops")
}

/// Returns a heap-allocated C string with the native library version.
///
/// Caller must free with [`spp_native_string_free`].
#[no_mangle]
pub extern "C" fn spp_native_version() -> *mut c_char {
    to_c_string(VERSION)
}

/// Returns capability bitmask: ping + asp leaf; pool ops only with feature `pool-ops`.
#[no_mangle]
pub extern "C" fn spp_native_capabilities() -> u32 {
    let mut caps = CAP_PING | CAP_ASP_LEAF;
    if pool_ops_linked() {
        caps |= CAP_POOL_OPS;
    }
    caps
}

/// JSON readiness report for linking sdk/pool (what CAP_POOL_OPS needs).
#[no_mangle]
pub extern "C" fn spp_native_pool_readiness() -> *mut c_char {
    to_c_string(&pool_ops::pool_readiness_json(pool_ops_linked()))
}

/// Echoes `input` with a fixed prefix for RN bridge smoke tests.
#[no_mangle]
pub extern "C" fn spp_native_ping(input: *const c_char) -> *mut c_char {
    let reply = if input.is_null() {
        "pong".to_string()
    } else {
        let raw = unsafe { CStr::from_ptr(input) };
        match raw.to_str() {
            Ok(s) if s.is_empty() => "pong".to_string(),
            Ok(s) => format!("pong:{s}"),
            Err(_) => "pong:invalid-utf8".to_string(),
        }
    };
    to_c_string(&reply)
}

/// Open pool session (JSON config). Required before deposit/transfer/withdraw when `pool-ops`.
///
/// Config camelCase: rpcUrl, networkPassphrase, secretKey, userAddress, poolContractId,
/// storagePath, circuitsDir, contractConfig (deployments.json body).
/// Never log the returned or input secret material.
#[no_mangle]
pub extern "C" fn spp_native_pool_open(config_json: *const c_char) -> *mut c_char {
    let raw = c_str_or_empty(config_json);
    if raw.is_empty() {
        return to_c_string(&pool_ops::invalid_json(
            "pool_open",
            "SPP_INVALID_CONFIG",
            "config JSON required",
        ));
    }
    #[cfg(feature = "pool-ops")]
    {
        return match session::open_session(&raw) {
            Ok(()) => to_c_string(
                r#"{"ok":true,"op":"pool_open","message":"session bound"}"#,
            ),
            Err(e) => {
                let code = if e.contains("SPP_POOL_SESSION") {
                    "SPP_POOL_SESSION_ERROR"
                } else if e.contains("missing circuit") {
                    "SPP_CIRCUITS_MISSING"
                } else if e.contains("secret") {
                    "SPP_INVALID_CONFIG"
                } else {
                    "SPP_POOL_OPEN_FAILED"
                };
                to_c_string(&pool_ops::invalid_json("pool_open", code, &e))
            }
        };
    }
    #[cfg(not(feature = "pool-ops"))]
    {
        to_c_string(&pool_ops::invalid_json(
            "pool_open",
            "SPP_OPS_NOT_READY",
            "sdk/pool not linked (build with --features pool-ops)",
        ))
    }
}

/// Close bound pool session (drops prover + sqlite handle).
#[no_mangle]
pub extern "C" fn spp_native_pool_close() -> *mut c_char {
    #[cfg(feature = "pool-ops")]
    {
        session::close_session();
        return to_c_string(r#"{"ok":true,"op":"pool_close"}"#);
    }
    #[cfg(not(feature = "pool-ops"))]
    {
        to_c_string(r#"{"ok":true,"op":"pool_close","message":"no-op without pool-ops"}"#)
    }
}

/// Shield / deposit — validates amount; prove/submit when session bound + `pool-ops`.
#[no_mangle]
pub extern "C" fn spp_native_deposit(amount: *const c_char) -> *mut c_char {
    let amount_s = c_str_or_empty(amount);
    match pool_ops::parse_amount_stroops(&amount_s) {
        Ok(stroops) => {
            #[cfg(feature = "pool-ops")]
            {
                return match catch_pool_panic("deposit", || session::deposit(&amount_s)) {
                    Ok(tx_hash) => to_c_string(&format!(
                        r#"{{"ok":true,"op":"deposit","txHash":{},"amountStroops":"{}"}}"#,
                        json_str(&tx_hash),
                        stroops
                    )),
                    Err(e) => {
                        let code = if e.contains("SPP_NATIVE_PANIC") {
                            "SPP_NATIVE_PANIC"
                        } else if e.contains("SPP_POOL_SESSION_UNBOUND") {
                            "SPP_POOL_SESSION_UNBOUND"
                        } else if e.contains("ASP membership") {
                            "SPP_ASP_REQUIRED"
                        } else {
                            "SPP_DEPOSIT_FAILED"
                        };
                        to_c_string(&pool_ops::invalid_json("deposit", code, &e))
                    }
                };
            }
            #[cfg(not(feature = "pool-ops"))]
            {
                to_c_string(&pool_ops::ops_not_ready_json("deposit", stroops))
            }
        }
        Err(e) => to_c_string(&pool_ops::invalid_json(
            "deposit",
            "SPP_INVALID_AMOUNT",
            &e.0,
        )),
    }
}

/// Private transfer — validates amount + recipient wire format.
#[no_mangle]
pub extern "C" fn spp_native_transfer(
    amount: *const c_char,
    recipient: *const c_char,
) -> *mut c_char {
    let amount_s = c_str_or_empty(amount);
    let recipient_s = c_str_or_empty(recipient);
    let stroops = match pool_ops::parse_amount_stroops(&amount_s) {
        Ok(s) => s,
        Err(e) => {
            return to_c_string(&pool_ops::invalid_json(
                "transfer",
                "SPP_INVALID_AMOUNT",
                &e.0,
            ));
        }
    };
    if let Err(e) = pool_ops::validate_transfer_recipient(&recipient_s) {
        return to_c_string(&pool_ops::invalid_json(
            "transfer",
            "SPP_INVALID_RECIPIENT",
            &e.0,
        ));
    }
    #[cfg(feature = "pool-ops")]
    {
        return match catch_pool_panic("transfer", || session::transfer(&amount_s, &recipient_s)) {
            Ok(tx_hash) => to_c_string(&format!(
                r#"{{"ok":true,"op":"transfer","txHash":{},"amountStroops":"{}"}}"#,
                json_str(&tx_hash),
                stroops
            )),
            Err(e) => {
                let code = if e.contains("SPP_NATIVE_PANIC") {
                    "SPP_NATIVE_PANIC"
                } else if e.contains("SPP_POOL_SESSION_UNBOUND") {
                    "SPP_POOL_SESSION_UNBOUND"
                } else {
                    "SPP_TRANSFER_FAILED"
                };
                to_c_string(&pool_ops::invalid_json("transfer", code, &e))
            }
        };
    }
    #[cfg(not(feature = "pool-ops"))]
    {
        to_c_string(&pool_ops::ops_not_ready_json("transfer", stroops))
    }
}

/// Unshield / withdraw — validates amount + optional G… destination.
#[no_mangle]
pub extern "C" fn spp_native_withdraw(amount: *const c_char, to: *const c_char) -> *mut c_char {
    let amount_s = c_str_or_empty(amount);
    let to_s = c_str_or_empty(to);
    let stroops = match pool_ops::parse_amount_stroops(&amount_s) {
        Ok(s) => s,
        Err(e) => {
            return to_c_string(&pool_ops::invalid_json(
                "withdraw",
                "SPP_INVALID_AMOUNT",
                &e.0,
            ));
        }
    };
    if !to_s.is_empty() && !pool_ops::is_stellar_g_address(&to_s) {
        return to_c_string(&pool_ops::invalid_json(
            "withdraw",
            "SPP_INVALID_RECIPIENT",
            "withdraw destination must be a G… address",
        ));
    }
    #[cfg(feature = "pool-ops")]
    {
        return match catch_pool_panic("withdraw", || session::withdraw(&amount_s, &to_s)) {
            Ok(tx_hash) => to_c_string(&format!(
                r#"{{"ok":true,"op":"withdraw","txHash":{},"amountStroops":"{}"}}"#,
                json_str(&tx_hash),
                stroops
            )),
            Err(e) => {
                let code = if e.contains("SPP_NATIVE_PANIC") {
                    "SPP_NATIVE_PANIC"
                } else if e.contains("SPP_POOL_SESSION_UNBOUND") {
                    "SPP_POOL_SESSION_UNBOUND"
                } else {
                    "SPP_WITHDRAW_FAILED"
                };
                to_c_string(&pool_ops::invalid_json("withdraw", code, &e))
            }
        };
    }
    #[cfg(not(feature = "pool-ops"))]
    {
        to_c_string(&pool_ops::ops_not_ready_json("withdraw", stroops))
    }
}

/// DATA-001: sync pool notes from chain into the native SDK sqlite store.
/// Requires an open session + `pool-ops`.
#[no_mangle]
pub extern "C" fn spp_native_pool_sync() -> *mut c_char {
    #[cfg(feature = "pool-ops")]
    {
        return match catch_pool_panic("pool_sync", || {
            session::sync().map(|_| "synced".to_string())
        }) {
            Ok(_) => to_c_string(r#"{"ok":true,"op":"pool_sync","message":"synced"}"#),
            Err(e) => {
                let code = if e.contains("SPP_POOL_SESSION_UNBOUND") {
                    "SPP_POOL_SESSION_UNBOUND"
                } else if e.contains("SPP_NATIVE_PANIC") {
                    "SPP_NATIVE_PANIC"
                } else {
                    "SPP_SYNC_FAILED"
                };
                to_c_string(&pool_ops::invalid_json("pool_sync", code, &e))
            }
        };
    }
    #[cfg(not(feature = "pool-ops"))]
    {
        to_c_string(&pool_ops::invalid_json(
            "pool_sync",
            "SPP_OPS_NOT_READY",
            "sdk/pool not linked (build with --features pool-ops)",
        ))
    }
}

/// DATA-001: private balance in stroops after sync (session required).
#[no_mangle]
pub extern "C" fn spp_native_pool_balance() -> *mut c_char {
    #[cfg(feature = "pool-ops")]
    {
        return match catch_pool_panic("pool_balance", || session::balance_stroops()) {
            Ok(stroops) => to_c_string(&format!(
                r#"{{"ok":true,"op":"pool_balance","balanceStroops":{}}}"#,
                json_str(&stroops)
            )),
            Err(e) => {
                let code = if e.contains("SPP_POOL_SESSION_UNBOUND") {
                    "SPP_POOL_SESSION_UNBOUND"
                } else if e.contains("SPP_NATIVE_PANIC") {
                    "SPP_NATIVE_PANIC"
                } else {
                    "SPP_BALANCE_FAILED"
                };
                to_c_string(&pool_ops::invalid_json("pool_balance", code, &e))
            }
        };
    }
    #[cfg(not(feature = "pool-ops"))]
    {
        to_c_string(&pool_ops::invalid_json(
            "pool_balance",
            "SPP_OPS_NOT_READY",
            "sdk/pool not linked (build with --features pool-ops)",
        ))
    }
}

/// Ensure ASP — without args returns not-ready for insert; use derive_keys first.
#[no_mangle]
pub extern "C" fn spp_native_ensure_asp() -> *mut c_char {
    to_c_string(
        r#"{"ok":false,"code":"SPP_ASP_NEEDS_DERIVE","op":"ensure_asp","leafDecimal":null,"message":"Call derive_keys with SEP-53 signature first, then insert_leaf from the app"}"#,
    )
}

/// Derive note/enc public keys + ASP membership leaf from SEP-53 signature.
///
/// # Args
/// * `sig_hex` — 64-byte Ed25519 signature as 128 hex chars (optional 0x)
/// * `network` — `"testnet"` or `"mainnet"` (membership blinding context)
///
/// # Returns
/// JSON: `{ ok, notePublicKeyHex, encryptionPublicKeyHex, membershipBlindingHex,
///          leafDecimal, leafHex, code?, message? }`
/// Caller frees with [`spp_native_string_free`].
#[no_mangle]
pub extern "C" fn spp_native_derive_keys(
    sig_hex: *const c_char,
    network: *const c_char,
) -> *mut c_char {
    let sig_s = c_str_or_empty(sig_hex);
    let net = c_str_or_empty(network);
    let network = if net.is_empty() { "testnet" } else { net.as_str() };

    let sig = match derive::parse_sig_hex(&sig_s) {
        Ok(s) => s,
        Err(e) => {
            return to_c_string(&format!(
                r#"{{"ok":false,"code":"SPP_INVALID_SIG","op":"derive_keys","message":{}}}"#,
                json_str(&e.0)
            ));
        }
    };

    match derive::derive_from_signature(&sig, network) {
        Ok(k) => to_c_string(&format!(
            r#"{{"ok":true,"op":"derive_keys","notePublicKeyHex":{npk},"encryptionPublicKeyHex":{epk},"membershipBlindingHex":{mb},"leafDecimal":{leaf},"leafHex":{lh}}}"#,
            npk = json_str(&k.note_public_key_hex),
            epk = json_str(&k.encryption_public_key_hex),
            mb = json_str(&k.membership_blinding_hex),
            leaf = json_str(&k.asp_leaf_decimal),
            lh = json_str(&k.asp_leaf_hex),
        )),
        Err(e) => to_c_string(&format!(
            r#"{{"ok":false,"code":"SPP_DERIVE_FAILED","op":"derive_keys","message":{}}}"#,
            json_str(&e.0)
        )),
    }
}

/// Frees a string returned by this library.
///
/// # Safety
/// `ptr` must be null or a pointer previously returned by this crate.
#[no_mangle]
pub unsafe extern "C" fn spp_native_string_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    drop(unsafe { CString::from_raw(ptr) });
}

fn c_str_or_empty(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .unwrap_or("")
        .to_string()
}

fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

fn to_c_string(s: &str) -> *mut c_char {
    CString::new(s)
        .unwrap_or_else(|_| CString::new("error").expect("static"))
        .into_raw()
}

#[cfg(feature = "pool-ops")]
fn catch_pool_panic<F>(op: &str, f: F) -> Result<String, String>
where
    F: FnOnce() -> Result<String, String>,
{
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => result,
        Err(payload) => {
            let panic_message = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown Rust panic".to_string());
            Err(format!(
                "SPP_NATIVE_PANIC: {op} aborted before returning a result: {panic_message}"
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn version_is_semverish() {
        let ptr = spp_native_version();
        let s = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
        assert!(s.starts_with('0') || s.contains('.'), "got {s}");
        unsafe { spp_native_string_free(ptr) };
    }

    #[test]
    fn capabilities_include_asp_leaf() {
        let caps = spp_native_capabilities();
        assert_eq!(caps & CAP_PING, CAP_PING);
        assert_eq!(caps & CAP_ASP_LEAF, CAP_ASP_LEAF);
        #[cfg(feature = "pool-ops")]
        assert_eq!(caps & CAP_POOL_OPS, CAP_POOL_OPS);
        #[cfg(not(feature = "pool-ops"))]
        assert_eq!(caps & CAP_POOL_OPS, 0);
    }

    #[test]
    fn ping_null_and_value() {
        let p1 = spp_native_ping(std::ptr::null());
        assert_eq!(unsafe { CStr::from_ptr(p1) }.to_str().unwrap(), "pong");
        unsafe { spp_native_string_free(p1) };

        let input = CString::new("rn").unwrap();
        let p2 = spp_native_ping(input.as_ptr());
        assert_eq!(unsafe { CStr::from_ptr(p2) }.to_str().unwrap(), "pong:rn");
        unsafe { spp_native_string_free(p2) };
    }

    #[test]
    fn deposit_validates_then_not_ready() {
        let amount = CString::new("1.0").unwrap();
        let ptr = spp_native_deposit(amount.as_ptr());
        let s = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
        unsafe { spp_native_string_free(ptr) };
        #[cfg(feature = "pool-ops")]
        {
            // Linked but no session: fail closed until pool_open.
            assert!(s.contains("SPP_POOL_SESSION_UNBOUND"), "got {s}");
        }
        #[cfg(not(feature = "pool-ops"))]
        {
            assert!(s.contains("SPP_OPS_NOT_READY"), "got {s}");
            assert!(s.contains("amountStroops"), "got {s}");
        }
    }

    #[test]
    fn deposit_rejects_bad_amount() {
        let amount = CString::new("0").unwrap();
        let ptr = spp_native_deposit(amount.as_ptr());
        let s = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
        unsafe { spp_native_string_free(ptr) };
        assert!(s.contains("SPP_INVALID_AMOUNT"), "got {s}");
    }

    #[test]
    fn transfer_rejects_bad_recipient() {
        let amount = CString::new("0.5").unwrap();
        let recip = CString::new("nope").unwrap();
        let ptr = spp_native_transfer(amount.as_ptr(), recip.as_ptr());
        let s = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
        unsafe { spp_native_string_free(ptr) };
        assert!(s.contains("SPP_INVALID_RECIPIENT"), "got {s}");
    }

    #[test]
    fn pool_readiness_reports_unlinked() {
        let ptr = spp_native_pool_readiness();
        let s = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
        unsafe { spp_native_string_free(ptr) };
        assert!(s.contains("requirements"));
        #[cfg(feature = "pool-ops")]
        {
            assert!(
                s.contains("poolOpsLinked\":true") || s.contains("\"poolOpsLinked\": true"),
                "got {s}"
            );
            assert!(s.contains("sessionBound"), "got {s}");
        }
        #[cfg(not(feature = "pool-ops"))]
        {
            assert!(s.contains("poolOpsLinked\":false") || s.contains("\"poolOpsLinked\": false"));
        }
    }

    #[test]
    fn derive_keys_returns_leaf_decimal() {
        let sig = "07".repeat(64);
        let sig_c = CString::new(sig).unwrap();
        let net = CString::new("testnet").unwrap();
        let ptr = spp_native_derive_keys(sig_c.as_ptr(), net.as_ptr());
        let s = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
        unsafe { spp_native_string_free(ptr) };
        assert!(s.contains("\"ok\":true"), "got {s}");
        assert!(s.contains("leafDecimal"), "got {s}");
        assert!(s.contains("notePublicKeyHex"), "got {s}");
    }
}
