//! Bound PrivatePool session (feature `pool-ops` only).
//!
//! Mirrors CLI `session::PoolSession`: LocalSigner + LocalProver + LocalStorage.
//! Never log secret keys. App opens one session per account before deposit/transfer/withdraw.

#![cfg(feature = "pool-ops")]

use std::fs;
use std::path::{Path, PathBuf};

use parking_lot::Mutex as ParkingMutex;
use serde::Deserialize;
use stellar_private_payments_sdk::{
    LocalSigner, PrivatePoolConfig, ProverArtifacts, TransferRecipient,
    blocking::PrivatePool,
    types::{ContractConfig, EncryptionPublicKey, NoteAmount, NotePublicKey},
};

use crate::pool_ops::{is_stellar_g_address, parse_amount_stroops, validate_transfer_recipient};

/// JSON config from RN (secret key never logged).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenConfig {
    pub rpc_url: String,
    pub network_passphrase: String,
    /// Stellar secret seed (S…) — cleared from process memory only after open.
    pub secret_key: String,
    pub user_address: String,
    pub pool_contract_id: String,
    /// Absolute path for wallet SQLite (app documents dir).
    pub storage_path: String,
    /// Directory with policy_tx_2_2.{wasm,r1cs} + policy_tx_2_2_proving_key.bin
    pub circuits_dir: String,
    /// Full deployments.json body (ContractConfig).
    pub contract_config: ContractConfig,
}

struct BoundSession {
    pool: PrivatePool,
    user_address: String,
    #[allow(dead_code)] // surfaced via session_info_json
    pool_contract_id: String,
}

/// `PrivatePool` is `!Send` (dyn Prover / Signer). Ops are serialized by this mutex
/// and intended for the single RN/JNI caller thread; wrap so a process-global
/// session can live in a `Sync` static.
struct SendBoundSession(BoundSession);

// SAFETY: access only while holding SESSION mutex; no concurrent use of inner pool.
unsafe impl Send for SendBoundSession {}

static SESSION: ParkingMutex<Option<SendBoundSession>> = ParkingMutex::new(None);

fn load_prover_artifacts(circuits_dir: &Path) -> Result<ProverArtifacts, String> {
    let pk = circuits_dir.join("policy_tx_2_2_proving_key.bin");
    let wasm = circuits_dir.join("policy_tx_2_2.wasm");
    let r1cs = circuits_dir.join("policy_tx_2_2.r1cs");
    for p in [&pk, &wasm, &r1cs] {
        if !p.is_file() {
            return Err(format!("missing circuit asset: {}", p.display()));
        }
    }
    Ok(ProverArtifacts {
        proving_key: fs::read(&pk).map_err(|e| format!("read proving key: {e}"))?,
        circuit_wasm: fs::read(&wasm).map_err(|e| format!("read wasm: {e}"))?,
        circuit_r1cs: fs::read(&r1cs).map_err(|e| format!("read r1cs: {e}"))?,
    })
}

/// Open (or replace) the process-global pool session.
pub fn open_session(config_json: &str) -> Result<(), String> {
    let mut cfg: SessionOpenConfig =
        serde_json::from_str(config_json).map_err(|e| format!("invalid session config: {e}"))?;

    if !is_stellar_g_address(&cfg.user_address) {
        return Err("user_address must be a G… Stellar address".into());
    }
    if cfg.secret_key.trim().is_empty() || !cfg.secret_key.starts_with('S') {
        return Err("secret_key must be a Stellar S… seed".into());
    }
    if cfg.pool_contract_id.trim().is_empty() {
        return Err("pool_contract_id required".into());
    }
    if cfg.storage_path.trim().is_empty() {
        return Err("storage_path required".into());
    }
    if cfg.circuits_dir.trim().is_empty() {
        return Err("circuits_dir required".into());
    }

    // Ensure parent dir for sqlite exists.
    if let Some(parent) = Path::new(&cfg.storage_path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create storage dir: {e}"))?;
    }

    let circuits = PathBuf::from(&cfg.circuits_dir);
    let artifacts = load_prover_artifacts(&circuits)?;

    let signer = Box::new(
        LocalSigner::new(
            cfg.secret_key.trim(),
            cfg.network_passphrase.clone(),
            cfg.user_address.clone(),
        )
        .map_err(|e| format!("signer: {e}"))?,
    );
    // Drop secret from config string ASAP (cfg still holds it until drop).
    cfg.secret_key.clear();

    let pool_config = PrivatePoolConfig {
        rpc_url: cfg.rpc_url,
        contract_config: cfg.contract_config,
        pool_contract_id: cfg.pool_contract_id.clone(),
        user_address: cfg.user_address.clone(),
        storage_path: cfg.storage_path,
        prover_artifacts: artifacts,
    };

    let pool = PrivatePool::open(pool_config, signer).map_err(|e| format!("open pool: {e}"))?;

    let mut guard = SESSION.lock();
    *guard = Some(SendBoundSession(BoundSession {
        pool,
        user_address: cfg.user_address,
        pool_contract_id: cfg.pool_contract_id,
    }));
    Ok(())
}

pub fn close_session() {
    let mut guard = SESSION.lock();
    *guard = None;
}

pub fn session_bound() -> bool {
    SESSION.lock().is_some()
}

#[allow(dead_code)] // reserved for diagnostics FFI
pub fn session_info_json() -> String {
    let guard = SESSION.lock();
    match guard.as_ref() {
        Some(SendBoundSession(s)) => serde_json::json!({
            "ok": true,
            "op": "session_info",
            "bound": true,
            "userAddress": s.user_address,
            "poolContractId": s.pool_contract_id,
        })
        .to_string(),
        None => serde_json::json!({
            "ok": false,
            "op": "session_info",
            "bound": false,
            "code": "SPP_POOL_SESSION_UNBOUND",
            "message": "Call pool_open with config before deposit/transfer/withdraw",
        })
        .to_string(),
    }
}

fn with_pool<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&PrivatePool) -> Result<T, String>,
{
    let guard = SESSION.lock();
    let session = guard
        .as_ref()
        .ok_or_else(|| "SPP_POOL_SESSION_UNBOUND: open session first".to_string())?;
    f(&session.0.pool)
}

pub fn deposit(amount: &str) -> Result<String, String> {
    let stroops = parse_amount_stroops(amount).map_err(|e| e.0)?;
    let amount = NoteAmount::from(stroops);
    let result = with_pool(|pool| {
        pool.deposit(amount)
            .map_err(|e| format!("deposit: {e}"))
    })?;
    Ok(result.tx_hash)
}

pub fn transfer(amount: &str, recipient_wire: &str) -> Result<String, String> {
    let stroops = parse_amount_stroops(amount).map_err(|e| e.0)?;
    validate_transfer_recipient(recipient_wire).map_err(|e| e.0)?;
    let amount = NoteAmount::from(stroops);
    let recipient = parse_recipient(recipient_wire)?;
    let results = with_pool(|pool| {
        pool.transfer(recipient, amount)
            .map_err(|e| format!("transfer: {e}"))
    })?;
    results
        .last()
        .map(|r| r.tx_hash.clone())
        .ok_or_else(|| "transfer returned no transactions".into())
}

pub fn withdraw(amount: &str, to: &str) -> Result<String, String> {
    let stroops = parse_amount_stroops(amount).map_err(|e| e.0)?;
    let amount = NoteAmount::from(stroops);
    let recipient = if to.trim().is_empty() {
        let guard = SESSION.lock();
        guard
            .as_ref()
            .map(|s| s.0.user_address.clone())
            .ok_or_else(|| "SPP_POOL_SESSION_UNBOUND".to_string())?
    } else {
        if !is_stellar_g_address(to) {
            return Err("withdraw destination must be a G… address".into());
        }
        to.trim().to_string()
    };
    let results = with_pool(|pool| {
        pool.withdraw(amount, recipient)
            .map_err(|e| format!("withdraw: {e}"))
    })?;
    results
        .last()
        .map(|r| r.tx_hash.clone())
        .ok_or_else(|| "withdraw returned no transactions".into())
}

#[allow(dead_code)]
pub fn balance_stroops() -> Result<String, String> {
    with_pool(|pool| {
        let bal = pool.balance().map_err(|e| format!("balance: {e}"))?;
        Ok(u128::from(bal).to_string())
    })
}

#[allow(dead_code)]
pub fn sync() -> Result<(), String> {
    with_pool(|pool| pool.sync().map_err(|e| format!("sync: {e}")))
}

fn parse_recipient(wire: &str) -> Result<TransferRecipient, String> {
    let w = wire.trim();
    if w.starts_with("keys:") {
        let rest = &w["keys:".len()..];
        let parts: Vec<&str> = rest.splitn(2, ':').collect();
        if parts.len() != 2 {
            return Err("keys recipient must be keys:<note>:<enc>".into());
        }
        let note = NotePublicKey::parse(parts[0])
            .map_err(|e| format!("invalid note public key: {e}"))?;
        let enc = EncryptionPublicKey::parse(parts[1])
            .map_err(|e| format!("invalid encryption public key: {e}"))?;
        return Ok(TransferRecipient::keys(note, enc));
    }
    Ok(TransferRecipient::from(w))
}
