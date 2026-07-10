//! SPP key derivation + ASP membership leaf (matches vendor `sdk/prover`).
//!
//! Message: `"Privacy Pool Key Derivation [v1]"`
//! Leaf: `poseidon2_hash2(note_pubkey, membership_blinding, domain=1)`

use ark_bn254::Fr;
use ark_ff::{BigInteger, PrimeField};
use ark_serialize::CanonicalSerialize;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zkhash::{
    fields::bn256::FpBN256 as Scalar,
    poseidon2::{
        poseidon2::Poseidon2,
        poseidon2_instance_bn256::POSEIDON2_BN256_PARAMS_3,
    },
};

const NOTE_KEY_DOMAIN: &[u8] = b"privacy-pool/note-key/v1";
const ENCRYPTION_KEY_DOMAIN: &[u8] = b"privacy-pool/encryption-key/v1";
const MEMBERSHIP_BLINDING_DOMAIN: &[u8] = b"privacy-pool/asp-secret/v1";

const FIELD_SIZE: usize = 32;

#[derive(Debug)]
pub struct DeriveError(pub String);

impl std::fmt::Display for DeriveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for DeriveError {}

#[derive(Debug, Clone)]
pub struct DerivedSppKeys {
    pub note_public_key_hex: String,
    pub encryption_public_key_hex: String,
    /// Membership blinding LE hex (32 bytes) — SecureStore only on app side.
    pub membership_blinding_hex: String,
    /// ASP leaf as decimal string for Soroban `insert_leaf` (U256).
    pub asp_leaf_decimal: String,
    /// ASP leaf LE hex for debugging / storage.
    pub asp_leaf_hex: String,
}

/// Derive privacy keys + ASP leaf from a 64-byte Ed25519 SEP-53 signature.
pub fn derive_from_signature(signature: &[u8], network_context: &str) -> Result<DerivedSppKeys, DeriveError> {
    if signature.len() != 64 {
        return Err(DeriveError(
            "Signature must be 64 bytes (Ed25519)".into(),
        ));
    }

    let note_sk = derive_note_private_key(signature)?;
    let note_pk = derive_public_key(&note_sk)?;
    let enc = derive_encryption_keypair(signature)?;
    let blinding = derive_membership_blinding(signature, network_context)?;
    let leaf = asp_membership_leaf(&note_pk, &blinding)?;

    Ok(DerivedSppKeys {
        note_public_key_hex: hex_encode(&note_pk),
        encryption_public_key_hex: hex_encode(&enc.public),
        membership_blinding_hex: hex_encode(&blinding),
        asp_leaf_decimal: field_le_to_decimal(&leaf),
        asp_leaf_hex: hex_encode(&leaf),
    })
}

fn derive_note_private_key(signature: &[u8]) -> Result<[u8; 32], DeriveError> {
    let key = hash_signature_with_domain(signature, NOTE_KEY_DOMAIN);
    let field = Fr::from_le_bytes_mod_order(&key);
    let mut result = [0u8; 32];
    field
        .serialize_compressed(&mut result[..])
        .map_err(|e| DeriveError(format!("serialize note sk: {e}")))?;
    Ok(result)
}

fn derive_encryption_keypair(signature: &[u8]) -> Result<EncKeys, DeriveError> {
    let seed = hash_signature_with_domain(signature, ENCRYPTION_KEY_DOMAIN);
    let mut secret_bytes = [0u8; 32];
    secret_bytes.copy_from_slice(&seed[..]);
    let secret = StaticSecret::from(secret_bytes);
    let public = PublicKey::from(&secret);
    Ok(EncKeys {
        public: public.to_bytes(),
        private: secret.to_bytes(),
    })
}

struct EncKeys {
    public: [u8; 32],
    #[allow(dead_code)]
    private: [u8; 32],
}

fn derive_membership_blinding(signature: &[u8], network_context: &str) -> Result<[u8; 32], DeriveError> {
    let key = hash_signature_with_domain_and_context(
        signature,
        MEMBERSHIP_BLINDING_DOMAIN,
        network_context.as_bytes(),
    );
    let field = Fr::from_le_bytes_mod_order(&key);
    let mut result = [0u8; 32];
    field
        .serialize_compressed(&mut result[..])
        .map_err(|e| DeriveError(format!("serialize blinding: {e}")))?;
    Ok(result)
}

/// publicKey = Poseidon2(privateKey, 0, domain=0x03)
fn derive_public_key(private_key: &[u8; 32]) -> Result<[u8; 32], DeriveError> {
    let sk = bytes_to_scalar(private_key)?;
    let pk = poseidon2_hash2_internal(sk, Scalar::from(0u64), Some(Scalar::from(3u64)));
    scalar_to_bytes32(&pk)
}

/// leaf = poseidon2_hash2(note_pubkey, membership_blinding, domain=1)
fn asp_membership_leaf(note_pubkey: &[u8; 32], membership_blinding: &[u8; 32]) -> Result<[u8; 32], DeriveError> {
    let a = bytes_to_scalar(note_pubkey)?;
    let b = bytes_to_scalar(membership_blinding)?;
    let domain = Scalar::from(1u64);
    let result = poseidon2_hash2_internal(a, b, Some(domain));
    scalar_to_bytes32(&result)
}

fn poseidon2_hash2_internal(a: Scalar, b: Scalar, domain: Option<Scalar>) -> Scalar {
    let poseidon2 = Poseidon2::new(&POSEIDON2_BN256_PARAMS_3);
    let input = match domain {
        Some(d) => vec![a, b, d],
        None => vec![a, b, Scalar::from(0u64)],
    };
    let perm = poseidon2.permutation(&input);
    perm[0]
}

fn hash_signature_with_domain(signature: &[u8], domain: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(signature);
    hasher.finalize().into()
}

fn hash_signature_with_domain_and_context(
    signature: &[u8],
    domain: &[u8],
    context: &[u8],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update([0u8]);
    hasher.update(context);
    hasher.update([0u8]);
    hasher.update(signature);
    hasher.finalize().into()
}

fn bytes_to_scalar(bytes: &[u8]) -> Result<Scalar, DeriveError> {
    if bytes.len() != FIELD_SIZE {
        return Err(DeriveError(format!(
            "Expected {FIELD_SIZE} bytes, got {}",
            bytes.len()
        )));
    }
    Ok(Scalar::from_le_bytes_mod_order(bytes))
}

fn scalar_to_bytes32(scalar: &Scalar) -> Result<[u8; 32], DeriveError> {
    let src = scalar.into_bigint().to_bytes_le();
    if src.len() > FIELD_SIZE {
        return Err(DeriveError("scalar too large".into()));
    }
    let mut out = [0u8; FIELD_SIZE];
    out[..src.len()].copy_from_slice(&src);
    Ok(out)
}

fn field_le_to_decimal(le: &[u8; 32]) -> String {
    // Interpret LE field bytes as big integer (little-endian limbs).
    let mut acc = num_bigint::BigUint::from(0u32);
    let two56 = num_bigint::BigUint::from(1u32) << 8;
    // LE: low byte first
    for (i, b) in le.iter().enumerate() {
        acc += num_bigint::BigUint::from(*b) << (8 * i);
    }
    let _ = two56;
    acc.to_string()
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn parse_sig_hex(hex: &str) -> Result<Vec<u8>, DeriveError> {
    let s = hex.trim().trim_start_matches("0x");
    if s.len() != 128 {
        return Err(DeriveError(format!(
            "expected 64-byte sig (128 hex chars), got {}",
            s.len()
        )));
    }
    let mut out = Vec::with_capacity(64);
    for i in 0..64 {
        let byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)
            .map_err(|e| DeriveError(format!("hex: {e}")))?;
        out.push(byte);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_is_deterministic() {
        let sig = [7u8; 64];
        let a = derive_from_signature(&sig, "testnet").expect("derive");
        let b = derive_from_signature(&sig, "testnet").expect("derive");
        assert_eq!(a.note_public_key_hex, b.note_public_key_hex);
        assert_eq!(a.asp_leaf_decimal, b.asp_leaf_decimal);
        assert_eq!(a.encryption_public_key_hex, b.encryption_public_key_hex);
    }

    #[test]
    fn network_context_changes_leaf() {
        let sig = [9u8; 64];
        let a = derive_from_signature(&sig, "testnet").unwrap();
        let b = derive_from_signature(&sig, "mainnet").unwrap();
        assert_ne!(a.asp_leaf_decimal, b.asp_leaf_decimal);
    }

    #[test]
    fn leaf_decimal_is_numeric() {
        let sig = [1u8; 64];
        let d = derive_from_signature(&sig, "testnet").unwrap();
        assert!(d.asp_leaf_decimal.chars().all(|c| c.is_ascii_digit()));
        assert!(!d.asp_leaf_decimal.is_empty());
    }
}
