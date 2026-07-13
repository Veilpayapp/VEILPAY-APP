use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("VeilPoo11111111111111111111111111111111111");

#[program]
pub mod veil_pool {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.merkle_root = [0u8; 32];
        pool.leaf_count = 0;
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

        // SC-M1 fix: enforce commitment uniqueness
        require!(!pool.commitment_exists.contains(commitment), VeilError::DuplicateCommitment);
        pool.commitment_exists.insert(commitment)?;

        // Transfer tokens from depositor to pool
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.pool_token_account.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;

        // Update pool state
        pool.leaf_count += 1;

        emit!(NewCommitment {
            commitment,
            amount,
            leaf_index: pool.leaf_count - 1,
            token: ctx.accounts.mint.key(),
        });

        Ok(())
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
        nullifier: [u8; 32],
        proof: Vec<u8>,
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(!pool.paused, VeilError::PoolPaused);

        // SC-C3 fix: check nullifier before allowing withdrawal
        require!(
            !pool.nullifiers_spent.contains(nullifier),
            VeilError::NullifierSpent
        );

        // SC-C1 fix: fail-closed proof verification
        require!(verify_proof(&proof, nullifier), VeilError::InvalidProof);

        // Mark nullifier as spent before transfer (Checks-Effects-Interactions)
        pool.nullifiers_spent.insert(nullifier)?;

        // Transfer tokens to recipient
        let seeds = &[
            b"pool",
            pool.mint.as_ref(),
            &[pool.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new_with_signer(cpi_program, cpi_accounts, signer), amount)?;

        emit!(Withdrawal {
            nullifier,
            amount,
            recipient: ctx.accounts.recipient.key(),
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

/// Verifies a withdrawal's zero-knowledge proof.
///
/// SECURITY (SC-C1 / SEC-007): hard fail-closed stub. This MUST return `false`
/// for every input until a real Groth16 (BN254) verifier is integrated, mirroring
/// the verifier already live on EVM (`Groth16Verifier.sol`). Because it always
/// returns `false`, `withdraw` is intentionally non-functional — the pool accepts
/// deposits but cannot release funds until the verifier lands.
///
/// Do NOT reintroduce any bypass (e.g. accepting a fixed dummy proof or gating the
/// bypass behind a Cargo feature): a build that accepts a forged proof lets anyone
/// drain the pool. The previous `[1, 2, 3, 4]` test backdoor was removed for exactly
/// this reason.
fn verify_proof(_proof: &[u8], _nullifier: [u8; 32]) -> bool {
    // TODO(SEC-007): integrate a groth16-solana verifier with an embedded verifying
    // key and structured public inputs (root, nullifier, recipient, amount).
    false
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
#[instruction(nullifier: [u8; 32], amount: u64)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"pool", mint.key().as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, token::mint = mint, token::authority = pool)]
    pub pool_token_account: Account<'info, TokenAccount>,
    #[account(constraint = mint.key() == pool.mint @ VeilError::InvalidMint)]
    pub mint: Account<'info, anchor_spl::token::Mint>,
    /// CHECK: Recipient of the withdrawal
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
