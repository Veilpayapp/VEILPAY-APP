use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

pub mod verifier;
pub mod verifying_key;

use verifier::{recipient_to_field, verify_withdraw_proof};

// Deterministic localnet placeholder (seed = "veil_pool"); replace on deploy.
declare_id!("5rP5zFGQiXNPiPpDZ8kfu7TArWp7U9wsHSHx5k58KuXL");

/// Deploy gate (SEC-007 residual): until an incremental Poseidon Merkle tree
/// lands, the pool only stores a single known root (`merkle_root = commitment`).
/// Allowing a second deposit would overwrite that root and **permanently lock**
/// the first note's funds. Cap leaves at 1 so multi-user / multi-deposit use
/// fails closed instead of stranding value.
pub const MAX_SCAFFOLD_LEAVES: u64 = 1;

#[program]
pub mod veil_pool {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.mint = ctx.accounts.mint.key();
        pool.merkle_root = [0u8; 32];
        pool.leaf_count = 0;
        pool.bump = ctx.bumps.pool;
        pool.paused = false;
        Ok(())
    }

    pub fn deposit(
        ctx: Context<Deposit>,
        commitment: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(!pool.paused, VeilError::PoolPaused);
        require!(amount > 0, VeilError::InvalidAmount);

        // SC-M1: uniqueness before the scaffold leaf cap so a re-submit of the
        // same commitment still surfaces DuplicateCommitment.
        require!(!pool.commitment_exists.contains(commitment), VeilError::DuplicateCommitment);

        // Deploy gate: single-leaf scaffold only (see MAX_SCAFFOLD_LEAVES).
        require!(
            pool.leaf_count < MAX_SCAFFOLD_LEAVES,
            VeilError::ScaffoldSingleLeafOnly
        );

        pool.commitment_exists.insert(commitment)?;

        // Transfer tokens from depositor to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.pool_token_account.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;

        // Single known root = this commitment (not a multi-leaf Merkle root).
        pool.leaf_count += 1;
        pool.merkle_root = commitment;

        emit!(NewCommitment {
            commitment,
            amount,
            leaf_index: pool.leaf_count - 1,
            token: ctx.accounts.mint.key(),
        });

        Ok(())
    }

    /// Withdraw `amount` to `recipient`, gated by a Groth16 proof against the
    /// canonical public-input layout
    /// `[merkleRoot, nullifierHash, recipient, amount]` (see `withdraw.circom`
    /// and EVM `IGroth16Verifier`).
    ///
    /// SEC-007: proof verification is real BN254 Groth16 via `groth16-solana`
    /// (alt_bn128 syscalls) with the circuit verifying key embedded at build
    /// time. Malformed / forged proofs fail closed with `InvalidProof`.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        nullifier_hash: [u8; 32],
        proof: Vec<u8>,
        merkle_root: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(!pool.paused, VeilError::PoolPaused);
        require!(amount > 0, VeilError::InvalidAmount);

        // Reject proofs against the zero root (uninitialized tree) and against
        // any root the pool has not stamped. Single-root storage for now —
        // ring-buffer parity with EVM is a follow-up, not a verifier bypass.
        require!(merkle_root != [0u8; 32], VeilError::InvalidMerkleRoot);
        require!(merkle_root == pool.merkle_root, VeilError::InvalidMerkleRoot);

        // SC-C3: check nullifier before the expensive pairing.
        require!(
            !pool.nullifiers_spent.contains(nullifier_hash),
            VeilError::NullifierSpent
        );

        // Recipient is bound into the proof as a 32-byte BE field element
        // (the Solana pubkey bytes). Out-of-range keys fail closed.
        let recipient_key = ctx.accounts.recipient.key();
        let recipient_field = recipient_to_field(&recipient_key.to_bytes())
            .ok_or(VeilError::InvalidProof)?;

        // SEC-007 / SC-C1: real Groth16 verification (fail-closed).
        require!(
            verify_withdraw_proof(
                &proof,
                &merkle_root,
                &nullifier_hash,
                &recipient_field,
                amount,
            ),
            VeilError::InvalidProof
        );

        // Mark nullifier spent before transfer (Checks-Effects-Interactions).
        pool.nullifiers_spent.insert(nullifier_hash)?;

        // Snapshot PDA signer seeds before the CPI so we do not hold a
        // mutable borrow of `pool` across `to_account_info()`.
        let mint_key = pool.mint;
        let bump = pool.bump;
        let seeds: &[&[u8]] = &[b"pool", mint_key.as_ref(), &[bump]];
        let signer = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
            amount,
        )?;

        emit!(Withdrawal {
            nullifier: nullifier_hash,
            amount,
            recipient: recipient_key,
            token: ctx.accounts.mint.key(),
        });

        Ok(())
    }

    // SC-M4 fix: pause/unpause for emergency stops
    pub fn pause(ctx: Context<AdminAction>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(
            pool.authority == ctx.accounts.authority.key(),
            VeilError::Unauthorized
        );
        pool.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminAction>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(
            pool.authority == ctx.accounts.authority.key(),
            VeilError::Unauthorized
        );
        pool.paused = false;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(token::mint = mint, token::authority = pool)]
    pub pool_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32], amount: u64)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"pool", mint.key().as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, token::mint = mint)]
    pub pool_token_account: Account<'info, TokenAccount>,
    #[account(constraint = mint.key() == pool.mint @ VeilError::InvalidMint)]
    pub mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut, token::mint = mint, token::authority = depositor)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(nullifier_hash: [u8; 32], proof: Vec<u8>, merkle_root: [u8; 32], amount: u64)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"pool", mint.key().as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, token::mint = mint, token::authority = pool)]
    pub pool_token_account: Account<'info, TokenAccount>,
    #[account(constraint = mint.key() == pool.mint @ VeilError::InvalidMint)]
    pub mint: Account<'info, anchor_spl::token::Mint>,
    /// CHECK: Recipient of the withdrawal; pubkey is bound into the ZK public inputs.
    pub recipient: AccountInfo<'info>,
    #[account(mut, token::mint = mint, token::authority = recipient)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// SC-H2 fix: admin action accounts for authority-gated operations
#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(mut, seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    pub authority: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub merkle_root: [u8; 32],
    pub leaf_count: u64,
    pub bump: u8,
    // SC-C3 fix: on-chain nullifier tracking to prevent double-spending
    pub nullifiers_spent: NullifierSet,
    // SC-M1 fix: on-chain commitment tracking to prevent duplicates
    pub commitment_exists: CommitmentSet,
    // SC-M4 fix: pause flag for emergency stops
    pub paused: bool,
}

// Sparse nullifier set using a set of spent nullifiers
// Using a BTreeSet-like structure via Anchor's Set
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct NullifierSet {
    #[max_len(100)]
    pub spent: Vec<[u8; 32]>,
}

impl NullifierSet {
    pub fn contains(&self, nullifier: [u8; 32]) -> bool {
        self.spent.iter().any(|n| *n == nullifier)
    }

    pub fn insert(&mut self, nullifier: [u8; 32]) -> Result<()> {
        if self.contains(nullifier) {
            return err!(VeilError::NullifierSpent);
        }
        self.spent.push(nullifier);
        Ok(())
    }
}

impl Default for NullifierSet {
    fn default() -> Self {
        Self { spent: Vec::new() }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct CommitmentSet {
    #[max_len(100)]
    pub entries: Vec<[u8; 32]>,
}

impl CommitmentSet {
    pub fn contains(&self, commitment: [u8; 32]) -> bool {
        self.entries.iter().any(|c| *c == commitment)
    }

    pub fn insert(&mut self, commitment: [u8; 32]) -> Result<()> {
        if self.contains(commitment) {
            return err!(VeilError::DuplicateCommitment);
        }
        self.entries.push(commitment);
        Ok(())
    }
}

impl Default for CommitmentSet {
    fn default() -> Self {
        Self { entries: Vec::new() }
    }
}

#[error_code]
pub enum VeilError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Invalid proof")]
    InvalidProof,
    #[msg("Nullifier already spent")]
    NullifierSpent,
    #[msg("Pool is paused")]
    PoolPaused,
    #[msg("Duplicate commitment")]
    DuplicateCommitment,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid or unknown merkle root")]
    InvalidMerkleRoot,
    /// Multi-deposit blocked until incremental Merkle tree is implemented.
    /// A second deposit would overwrite `merkle_root` and lock prior notes.
    #[msg("Scaffold allows only one deposit until Merkle tree is live")]
    ScaffoldSingleLeafOnly,
}

#[event]
pub struct NewCommitment {
    pub commitment: [u8; 32],
    pub amount: u64,
    pub leaf_index: u64,
    pub token: Pubkey,
}

#[event]
pub struct Withdrawal {
    pub nullifier: [u8; 32],
    pub amount: u64,
    pub recipient: Pubkey,
    pub token: Pubkey,
}
