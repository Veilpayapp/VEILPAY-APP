//! SEC-007: on-chain Groth16 (BN254) verification for VeilPool withdraw.
//!
//! Mirrors the EVM public-input contract in `IGroth16Verifier` /
//! `withdraw.circom`:
//!
//!   publicInputs[0] = merkleRoot
//!   publicInputs[1] = nullifierHash
//!   publicInputs[2] = recipient  (32-byte BE field element)
//!   publicInputs[3] = amount     (u64 left-padded to 32 BE bytes)
//!
//! Proof encoding matches EVM `abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)`:
//! 256 bytes of big-endian field limbs = `A (64) || B (128) || C (64)`.
//! The Solana alt_bn128 pairing orientation requires **negated A**; we negate
//! on-chain so callers can reuse the same proof bytes as EVM.
//!
//! Fail-closed: any length / parse / field / pairing failure returns `false`
//! (never panics). The pool maps `false` → `VeilError::InvalidProof`.

use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

use crate::verifying_key::VERIFYINGKEY;

/// Number of public inputs for the Withdraw circuit.
pub const NR_PUBLIC_INPUTS: usize = 4;

/// Canonical uncompressed Groth16 proof size (A||B||C).
pub const PROOF_LEN: usize = 256;

/// BN254 base-field modulus `q` (big-endian), used to negate G1 y-coords.
///
/// q = 21888242871839275222246405745257275088696311157297823662689037894645226208583
const BN254_FQ_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// Verify a withdraw proof against the four canonical public inputs.
///
/// Returns `false` on any malformation or failed pairing — never panics.
pub fn verify_withdraw_proof(
    proof: &[u8],
    merkle_root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32],
    amount: u64,
) -> bool {
    let Ok((proof_a, proof_b, proof_c)) = parse_and_negate_proof(proof) else {
        return false;
    };

    let public_inputs = build_public_inputs(merkle_root, nullifier_hash, recipient, amount);

    verify_with_vk(
        &proof_a,
        &proof_b,
        &proof_c,
        &public_inputs,
        &VERIFYINGKEY,
    )
}

/// Build the load-bearing public-input array in circuit declaration order.
pub fn build_public_inputs(
    merkle_root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32],
    amount: u64,
) -> [[u8; 32]; NR_PUBLIC_INPUTS] {
    [
        *merkle_root,
        *nullifier_hash,
        *recipient,
        u64_to_be_field(amount),
    ]
}

/// Encode a u64 amount as a 32-byte big-endian BN254 field element.
pub fn u64_to_be_field(amount: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&amount.to_be_bytes());
    out
}

/// Map a Solana `Pubkey` (32 raw bytes) to a public-input field element.
///
/// The bytes are interpreted as a big-endian integer and must lie strictly
/// below the BN254 scalar field size. Callers that hit `None` should treat
/// the withdraw as `InvalidProof` (fail-closed) — statistically rare for
/// random Ed25519 keys, and the prover must use the same encoding.
pub fn recipient_to_field(pubkey_bytes: &[u8; 32]) -> Option<[u8; 32]> {
    if groth16_solana::groth16::is_less_than_bn254_field_size_be(pubkey_bytes) {
        Some(*pubkey_bytes)
    } else {
        None
    }
}

fn verify_with_vk(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; NR_PUBLIC_INPUTS],
    vk: &Groth16Verifyingkey,
) -> bool {
    let mut verifier = match Groth16Verifier::new(proof_a, proof_b, proof_c, public_inputs, vk) {
        Ok(v) => v,
        Err(_) => return false,
    };
    verifier.verify().is_ok()
}

/// Parse EVM-style 256-byte proof and return `(-A, B, C)` in BE form.
fn parse_and_negate_proof(proof: &[u8]) -> Result<([u8; 64], [u8; 128], [u8; 64]), ()> {
    if proof.len() != PROOF_LEN {
        return Err(());
    }

    let a: [u8; 64] = proof[0..64].try_into().map_err(|_| ())?;
    let b: [u8; 128] = proof[64..192].try_into().map_err(|_| ())?;
    let c: [u8; 64] = proof[192..256].try_into().map_err(|_| ())?;

    let a_neg = negate_g1_be(&a)?;
    Ok((a_neg, b, c))
}

/// G1 negation over BN254: `(x, y) → (x, q - y)` for y ≠ 0; identity stays.
fn negate_g1_be(point: &[u8; 64]) -> Result<[u8; 64], ()> {
    let mut out = *point;
    let y = &point[32..64];
    if y.iter().all(|&b| b == 0) {
        // Point at infinity / y=0: leave unchanged.
        return Ok(out);
    }
    let y_neg = fq_sub_mod(BN254_FQ_MODULUS_BE, y.try_into().map_err(|_| ())?)?;
    out[32..64].copy_from_slice(&y_neg);
    Ok(out)
}

/// Compute `a - b` mod q for two 32-byte big-endian integers, assuming
/// `a == q` (modulus) and `0 < b < q`. Used only for G1 y-negation.
fn fq_sub_mod(modulus: [u8; 32], b: [u8; 32]) -> Result<[u8; 32], ()> {
    // schoolbook subtraction modulus - b, both BE.
    let mut result = [0u8; 32];
    let mut borrow: i16 = 0;
    for i in (0..32).rev() {
        let diff = modulus[i] as i16 - b[i] as i16 - borrow;
        if diff < 0 {
            result[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            result[i] = diff as u8;
            borrow = 0;
        }
    }
    if borrow != 0 {
        return Err(());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_proof_fails_closed() {
        let root = [1u8; 32];
        let nullifier = [2u8; 32];
        let recipient = [3u8; 32];
        assert!(!verify_withdraw_proof(&[], &root, &nullifier, &recipient, 100));
    }

    #[test]
    fn short_proof_fails_closed() {
        let root = [1u8; 32];
        let nullifier = [2u8; 32];
        let recipient = [3u8; 32];
        // Historical dummy backdoor bytes — must never verify.
        assert!(!verify_withdraw_proof(
            &[1, 2, 3, 4],
            &root,
            &nullifier,
            &recipient,
            100
        ));
    }

    #[test]
    fn wrong_length_256_minus_one_fails() {
        let root = [1u8; 32];
        let nullifier = [2u8; 32];
        let recipient = [3u8; 32];
        assert!(!verify_withdraw_proof(
            &[0u8; 255],
            &root,
            &nullifier,
            &recipient,
            1
        ));
    }

    #[test]
    fn all_zero_proof_fails_closed() {
        let root = [1u8; 32];
        let nullifier = [2u8; 32];
        let recipient = [3u8; 32];
        // Well-formed length but not a valid curve pairing.
        assert!(!verify_withdraw_proof(
            &[0u8; PROOF_LEN],
            &root,
            &nullifier,
            &recipient,
            1000
        ));
    }

    #[test]
    fn u64_field_encoding_is_be_padded() {
        let enc = u64_to_be_field(0x0102_0304_0506_0708);
        assert_eq!(&enc[..24], &[0u8; 24]);
        assert_eq!(&enc[24..], &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    }

    #[test]
    fn public_input_order_is_canonical() {
        let root = [0x11u8; 32];
        let nullifier = [0x22u8; 32];
        let recipient = [0x33u8; 32];
        let pubs = build_public_inputs(&root, &nullifier, &recipient, 42);
        assert_eq!(pubs[0], root);
        assert_eq!(pubs[1], nullifier);
        assert_eq!(pubs[2], recipient);
        assert_eq!(pubs[3], u64_to_be_field(42));
    }

    #[test]
    fn recipient_field_rejects_out_of_range() {
        // BN254 Fr modulus itself is NOT a valid public input.
        let modulus = [
            0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
            0x58, 0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93,
            0xf0, 0x00, 0x00, 0x01,
        ];
        // Note: Fr modulus equals Fq modulus for BN254 numerically? Actually Fr and Fq differ.
        // Fr = 21888242871839275222246405745257275088548364400416034343698204186575808495617
        // Using all 0xFF is safely ≥ both moduli.
        let too_big = [0xffu8; 32];
        assert!(recipient_to_field(&too_big).is_none());
        let small = [0u8; 32];
        assert!(recipient_to_field(&small).is_some());
        let _ = modulus; // documented for readers; Fr check uses the crate helper.
    }

    #[test]
    fn negate_g1_y_zero_is_identity() {
        let mut p = [0u8; 64];
        p[31] = 1; // x = 1, y = 0
        let n = negate_g1_be(&p).unwrap();
        assert_eq!(n, p);
    }

    #[test]
    fn negate_g1_flips_y() {
        let mut p = [0u8; 64];
        // x = 1, y = 1
        p[31] = 1;
        p[63] = 1;
        let n = negate_g1_be(&p).unwrap();
        assert_eq!(&n[..32], &p[..32]); // x unchanged
        // y' = q - 1
        let expected_y = fq_sub_mod(BN254_FQ_MODULUS_BE, {
            let mut y = [0u8; 32];
            y[31] = 1;
            y
        })
        .unwrap();
        assert_eq!(&n[32..], &expected_y);
    }

    #[test]
    fn vk_has_four_public_inputs() {
        assert_eq!(VERIFYINGKEY.nr_pubinputs, 4);
        assert_eq!(VERIFYINGKEY.vk_ic.len(), 5); // IC0 + 4
    }

    #[test]
    fn scaffold_leaf_cap_is_one() {
        // Deploy gate constant lives on the program crate root.
        assert_eq!(crate::MAX_SCAFFOLD_LEAVES, 1);
    }

    #[test]
    fn parse_rejects_non_256() {
        assert!(parse_and_negate_proof(&[0u8; 128]).is_err());
        assert!(parse_and_negate_proof(&[0u8; 256]).is_ok());
    }
}
