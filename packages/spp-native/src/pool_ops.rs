//! Pool op validation + readiness (pre–sdk/pool link).
//!
//! Real prove/submit lives in `stellar-private-payments-sdk` (`sdk/pool`).
//! Until that crate is linked (feature `pool-ops`), deposit/transfer/withdraw
//! stay fail-closed after input validation. This module is the stable ABI
//! surface those ops will call into.

use serde_json::json;

/// XLM uses 7 decimal places (stroops).
pub const XLM_DECIMALS: u32 = 7;
const STROOPS_PER_XLM: u128 = 10_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmountError(pub String);

/// Parse a positive decimal amount string into stroops.
pub fn parse_amount_stroops(amount: &str) -> Result<u128, AmountError> {
    let s = amount.trim();
    if s.is_empty() {
        return Err(AmountError("amount is empty".into()));
    }
    if s.starts_with('-') {
        return Err(AmountError("amount must be positive".into()));
    }
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() > 2 {
        return Err(AmountError("invalid amount format".into()));
    }
    let whole = parts[0];
    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) {
        return Err(AmountError("invalid whole part".into()));
    }
    let frac = if parts.len() == 2 { parts[1] } else { "" };
    if frac.len() > XLM_DECIMALS as usize {
        return Err(AmountError(format!(
            "at most {XLM_DECIMALS} decimal places"
        )));
    }
    if !frac.chars().all(|c| c.is_ascii_digit()) {
        return Err(AmountError("invalid fractional part".into()));
    }
    let whole_n: u128 = whole
        .parse()
        .map_err(|_| AmountError("amount too large".into()))?;
    let frac_pad = format!("{frac:0<width$}", width = XLM_DECIMALS as usize);
    let frac_n: u128 = if frac_pad.is_empty() {
        0
    } else {
        frac_pad
            .parse()
            .map_err(|_| AmountError("fraction too large".into()))?
    };
    whole_n
        .checked_mul(STROOPS_PER_XLM)
        .and_then(|w| w.checked_add(frac_n))
        .filter(|&v| v > 0)
        .ok_or_else(|| AmountError("amount must be positive".into()))
}

/// Validate Stellar G… address shape (56 chars after G, base32 charset).
pub fn is_stellar_g_address(addr: &str) -> bool {
    let a = addr.trim();
    if a.len() != 56 || !a.starts_with('G') {
        return false;
    }
    a.chars()
        .all(|c| matches!(c, 'A'..='Z' | '2'..='7'))
}

/// Recipient wire formats accepted by FFI transfer:
/// - `G…` Stellar address
/// - `keys:<noteHex>:<encHex>` out-of-band note keys
pub fn validate_transfer_recipient(wire: &str) -> Result<(), AmountError> {
    let w = wire.trim();
    if w.is_empty() {
        return Err(AmountError("recipient is empty".into()));
    }
    if w.starts_with("keys:") {
        let rest = &w["keys:".len()..];
        let parts: Vec<&str> = rest.splitn(2, ':').collect();
        if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
            return Err(AmountError(
                "keys recipient must be keys:<notePublicKey>:<encryptionPublicKey>".into(),
            ));
        }
        return Ok(());
    }
    if is_stellar_g_address(w) {
        return Ok(());
    }
    Err(AmountError(
        "recipient must be G… address or keys:<note>:<enc>".into(),
    ))
}

/// What is still required before CAP_POOL_OPS can flip true.
pub fn pool_readiness_json(pool_ops_linked: bool) -> String {
    json!({
        "ok": pool_ops_linked,
        "op": "pool_readiness",
        "poolOpsLinked": pool_ops_linked,
        "capPoolOps": pool_ops_linked,
        "requirements": [
            "Link stellar-private-payments-sdk (sdk/pool) into spp-native feature pool-ops",
            "Ship policy_tx_2_2 wasm + r1cs + proving key (~7.8MB) as app assets",
            "Wire LocalProver + LocalSigner + LocalStorage session per account",
            "On-device Android prove bench within UX budget",
        ],
        "message": if pool_ops_linked {
            "Pool ops ready"
        } else {
            "sdk/pool not linked; deposit/transfer/withdraw validate inputs then fail closed"
        },
    })
    .to_string()
}

/// Structured not-ready after successful validation (sdk still unlinked).
pub fn ops_not_ready_json(op: &str, amount_stroops: u128) -> String {
    json!({
        "ok": false,
        "code": "SPP_OPS_NOT_READY",
        "op": op,
        "amountStroops": amount_stroops.to_string(),
        "message": "Native sdk/pool not linked yet; Phase 0 CLI path works. Inputs validated.",
    })
    .to_string()
}

pub fn invalid_json(op: &str, code: &str, message: &str) -> String {
    json!({
        "ok": false,
        "code": code,
        "op": op,
        "message": message,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whole_and_fractional() {
        assert_eq!(parse_amount_stroops("1").unwrap(), 10_000_000);
        assert_eq!(parse_amount_stroops("0.5").unwrap(), 5_000_000);
        assert_eq!(parse_amount_stroops("1.0000001").unwrap(), 10_000_001);
    }

    #[test]
    fn rejects_zero_negative_empty() {
        assert!(parse_amount_stroops("0").is_err());
        assert!(parse_amount_stroops("0.0").is_err());
        assert!(parse_amount_stroops("-1").is_err());
        assert!(parse_amount_stroops("").is_err());
        assert!(parse_amount_stroops("1.12345678").is_err());
    }

    #[test]
    fn stellar_g_address_shape() {
        let good = "GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME";
        assert!(is_stellar_g_address(good));
        assert!(!is_stellar_g_address("not-g"));
        assert!(!is_stellar_g_address(""));
    }

    #[test]
    fn transfer_recipient_formats() {
        let g = "GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME";
        assert!(validate_transfer_recipient(g).is_ok());
        assert!(validate_transfer_recipient("keys:aa:bb").is_ok());
        assert!(validate_transfer_recipient("keys:only").is_err());
        assert!(validate_transfer_recipient("").is_err());
    }

    #[test]
    fn readiness_lists_requirements() {
        let j = pool_readiness_json(false);
        assert!(j.contains("poolOpsLinked\":false"));
        assert!(j.contains("proving key"));
    }
}
