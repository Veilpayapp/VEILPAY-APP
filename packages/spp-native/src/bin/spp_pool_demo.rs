//! Desktop dogfood: open pool session and deposit/transfer/withdraw via CAP_POOL_OPS.
//!
//! Build (MSVC + stack; target on X: recommended):
//!   cargo build --release --features pool-ops --bin spp_pool_demo
//!
//! Run (never logs secret):
//!   set SPP_SECRET_KEY=S...
//!   set SPP_USER_ADDRESS=G...
//!   set SPP_CIRCUITS_DIR=X:\veilpay\spp-demo\circuits
//!   set SPP_STORAGE_PATH=X:\veilpay\spp-demo\data\wallet.sqlite
//!   spp_pool_demo deposit 0.1
//!
//! Env:
//!   SPP_SECRET_KEY       required (S… seed)
//!   SPP_USER_ADDRESS     required (G…)
//!   SPP_CIRCUITS_DIR     required
//!   SPP_STORAGE_PATH     required
//!   SPP_RPC_URL          default testnet Soroban RPC
//!   SPP_NETWORK_PASSPHRASE default Test SDF Network
//!   SPP_POOL_ID          default native XLM pool
//!   SPP_CONTRACT_CONFIG  optional path to deployments.json (else embedded testnet)

#[cfg(not(feature = "pool-ops"))]
fn main() {
    eprintln!("spp_pool_demo requires --features pool-ops");
    std::process::exit(2);
}

#[cfg(feature = "pool-ops")]
fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

#[cfg(feature = "pool-ops")]
fn run() -> Result<(), String> {
    use std::env;

    let mut args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        print_usage();
        return Err("missing command".into());
    }
    let cmd = args.remove(0);

    match cmd.as_str() {
        "ping" => {
            println!("pong spp_pool_demo {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "open" => {
            let cfg = load_open_config()?;
            open_session(&cfg)?;
            println!("ok pool_open user={} pool={}", cfg.user_address, cfg.pool_contract_id);
            // Keep process open? For one-shot we just prove open works then drop.
            spp_native::session_close_for_demo();
            Ok(())
        }
        "deposit" => {
            let amount = args.first().cloned().ok_or("usage: deposit <amount>")?;
            let cfg = load_open_config()?;
            open_session(&cfg)?;
            let tx = deposit(&amount)?;
            println!("ok deposit amount={amount} txHash={tx}");
            spp_native::session_close_for_demo();
            Ok(())
        }
        "transfer" => {
            let amount = args.first().cloned().ok_or("usage: transfer <amount> <G…|keys:note:enc>")?;
            let recipient = args.get(1).cloned().ok_or("usage: transfer <amount> <recipient>")?;
            let cfg = load_open_config()?;
            open_session(&cfg)?;
            let tx = transfer(&amount, &recipient)?;
            println!("ok transfer amount={amount} txHash={tx}");
            spp_native::session_close_for_demo();
            Ok(())
        }
        "withdraw" => {
            let amount = args.first().cloned().ok_or("usage: withdraw <amount> [G…]")?;
            let to = args.get(1).cloned().unwrap_or_default();
            let cfg = load_open_config()?;
            open_session(&cfg)?;
            let tx = withdraw(&amount, &to)?;
            println!("ok withdraw amount={amount} txHash={tx}");
            spp_native::session_close_for_demo();
            Ok(())
        }
        "help" | "-h" | "--help" => {
            print_usage();
            Ok(())
        }
        other => Err(format!("unknown command: {other}")),
    }
}

#[cfg(feature = "pool-ops")]
fn print_usage() {
    eprintln!(
        "spp_pool_demo — desktop CAP_POOL_OPS dogfood\n\
         \n\
         Commands:\n\
           ping\n\
           open\n\
           deposit <amount>\n\
           transfer <amount> <G…|keys:noteHex:encHex>\n\
           withdraw <amount> [G…]\n\
         \n\
         Required env: SPP_SECRET_KEY SPP_USER_ADDRESS SPP_CIRCUITS_DIR SPP_STORAGE_PATH\n\
         Optional: SPP_RPC_URL SPP_NETWORK_PASSPHRASE SPP_POOL_ID SPP_CONTRACT_CONFIG\n\
         Never pass secrets on the command line if your shell history is shared."
    );
}

#[cfg(feature = "pool-ops")]
struct OpenCfg {
    json: String,
    user_address: String,
    pool_contract_id: String,
}

#[cfg(feature = "pool-ops")]
fn load_open_config() -> Result<OpenCfg, String> {
    use std::env;
    use std::fs;

    let secret = env::var("SPP_SECRET_KEY").map_err(|_| "SPP_SECRET_KEY required".to_string())?;
    let user = env::var("SPP_USER_ADDRESS").map_err(|_| "SPP_USER_ADDRESS required".to_string())?;
    let circuits = env::var("SPP_CIRCUITS_DIR").map_err(|_| "SPP_CIRCUITS_DIR required".to_string())?;
    let storage = env::var("SPP_STORAGE_PATH").map_err(|_| "SPP_STORAGE_PATH required".to_string())?;
    let rpc = env::var("SPP_RPC_URL")
        .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".into());
    let passphrase = env::var("SPP_NETWORK_PASSPHRASE")
        .unwrap_or_else(|_| "Test SDF Network ; September 2015".into());
    let pool = env::var("SPP_POOL_ID").unwrap_or_else(|_| {
        "CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH".into()
    });

    let contract_config: serde_json::Value = if let Ok(path) = env::var("SPP_CONTRACT_CONFIG") {
        let raw = fs::read_to_string(&path).map_err(|e| format!("read SPP_CONTRACT_CONFIG: {e}"))?;
        serde_json::from_str(&raw).map_err(|e| format!("parse SPP_CONTRACT_CONFIG: {e}"))?
    } else {
        serde_json::from_str(TESTNET_DEPLOYMENTS).map_err(|e| e.to_string())?
    };

    // Never include secret in logs — only in JSON for open_session.
    let json = serde_json::json!({
        "rpcUrl": rpc,
        "networkPassphrase": passphrase,
        "secretKey": secret.trim(),
        "userAddress": user.trim(),
        "poolContractId": pool.trim(),
        "storagePath": storage.trim(),
        "circuitsDir": circuits.trim(),
        "contractConfig": contract_config,
    })
    .to_string();

    Ok(OpenCfg {
        json,
        user_address: user.trim().to_string(),
        pool_contract_id: pool.trim().to_string(),
    })
}

#[cfg(feature = "pool-ops")]
fn open_session(cfg: &OpenCfg) -> Result<(), String> {
    spp_native::session_open_for_demo(&cfg.json)
}

#[cfg(feature = "pool-ops")]
fn deposit(amount: &str) -> Result<String, String> {
    spp_native::session_deposit_for_demo(amount)
}

#[cfg(feature = "pool-ops")]
fn transfer(amount: &str, recipient: &str) -> Result<String, String> {
    spp_native::session_transfer_for_demo(amount, recipient)
}

#[cfg(feature = "pool-ops")]
fn withdraw(amount: &str, to: &str) -> Result<String, String> {
    spp_native::session_withdraw_for_demo(amount, to)
}

#[cfg(feature = "pool-ops")]
const TESTNET_DEPLOYMENTS: &str = r#"{
  "network": "testnet",
  "deployer": "GDF4BXPQY5N4BEO24UIHM4NVB62MW7HDWH7SVHKLVZAMLP5IIHCFQORC",
  "admin": "GDF4BXPQY5N4BEO24UIHM4NVB62MW7HDWH7SVHKLVZAMLP5IIHCFQORC",
  "asp_membership": "CDSJXWV5JITIQLXNM4AEI53RY2UQLOQBCG6WKYCFPWS5AHBAD3FWAVNH",
  "asp_non_membership": "CBG3BT6KHJM3UQGSUP2GHPQE5FLPEYBFVF47DCDHH6UOYQ6KDT5URJTI",
  "verifier": "CCKNCZXDGM7Z7EHL7PVQEYRDK636TZJIDODO5TSAS5BME2JYGMFR3MU3",
  "public_key_registry": "CB3IAFWZPU5H5MQ4NEMQCWLZJ6PAYZWLAA4DZIRZZCWXSI2WV6C7L556",
  "pools": [
    {
      "poolContractId": "CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH",
      "tokenContractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      "deploymentLedger": 3479862,
      "enabled": true,
      "asset": { "kind": "native" }
    }
  ]
}"#;
