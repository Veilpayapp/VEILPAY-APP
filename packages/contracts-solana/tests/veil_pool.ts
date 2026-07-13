import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import * as crypto from "crypto";

// For compilation without full IDL types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VeilPool = any;

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
describe("veil_pool", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const program = anchor.workspace.VeilPool as Program<VeilPool>;

  let mint: PublicKey;
  let pool: PublicKey;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let poolBump: number;
  let poolTokenAccount: PublicKey;
  
  const admin = Keypair.generate();
  const depositor = Keypair.generate();
  const recipient = Keypair.generate();
  
  let depositorTokenAccount: PublicKey;
  let recipientTokenAccount: PublicKey;
  
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const amount = new anchor.BN(1000);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  before(async () => {
    // Airdrop SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(depositor.publicKey, 10 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(recipient.publicKey, 10 * LAMPORTS_PER_SOL)
    );

    // Create token mint
    mint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

    // Derive Pool PDA
    [pool, poolBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mint.toBuffer()],
      program.programId
    );

    // Create Pool Token Account owned by Pool PDA
    const poolTokenKeypair = Keypair.generate();
    poolTokenAccount = await createAccount(
      provider.connection,
      admin,
      mint,
      pool,
      poolTokenKeypair
    );

    // Create Depositor Token Account and Mint some tokens
    depositorTokenAccount = await createAccount(
      provider.connection,
      depositor,
      mint,
      depositor.publicKey
    );
    await mintTo(
      provider.connection,
      admin,
      mint,
      depositorTokenAccount,
      admin,
      10000
    );

    // Create Recipient Token Account
    recipientTokenAccount = await createAccount(
      provider.connection,
      recipient,
      mint,
      recipient.publicKey
    );
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Is initialized!", async () => {
    await program.methods
      .initialize()
      .accounts({
        pool,
        poolTokenAccount,
        mint,
        authority: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const poolState = await program.account.pool.fetch(pool);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    assert.ok(poolState.authority.equals(admin.publicKey));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    assert.ok(poolState.mint.equals(mint));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    assert.equal(poolState.leafCount.toNumber(), 0);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.equal(poolState.paused, false);
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Can deposit", async () => {
    const commitment = Array.from(crypto.randomBytes(32));
    
    await program.methods
      .deposit(commitment, amount)
      .accounts({
        pool,
        poolTokenAccount,
        mint,
        depositor: depositor.publicKey,
        depositorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const poolState = await program.account.pool.fetch(pool);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    assert.equal(poolState.leafCount.toNumber(), 1);

    const poolTokenBalance = await provider.connection.getTokenAccountBalance(poolTokenAccount);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    assert.equal(poolTokenBalance.value.amount, amount.toString());
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Cannot deposit with duplicate commitment", async () => {
    const commitment = Array.from(crypto.randomBytes(32));
    
    await program.methods
      .deposit(commitment, amount)
      .accounts({
        pool,
        poolTokenAccount,
        mint,
        depositor: depositor.publicKey,
        depositorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    try {
      await program.methods
        .deposit(commitment, amount)
        .accounts({
          pool,
          poolTokenAccount,
          mint,
          depositor: depositor.publicKey,
          depositorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Should have failed duplicate commitment");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      assert.include(e.toString(), "DuplicateCommitment");
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Can pause the pool", async () => {
    await program.methods
      .pause()
      .accounts({
        pool,
        authority: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const poolState = await program.account.pool.fetch(pool);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.equal(poolState.paused, true);
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Cannot deposit when paused", async () => {
    const commitment = Array.from(crypto.randomBytes(32));
    try {
      await program.methods
        .deposit(commitment, amount)
        .accounts({
          pool,
          poolTokenAccount,
          mint,
          depositor: depositor.publicKey,
          depositorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Should have failed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      assert.include(e.toString(), "PoolPaused");
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Can unpause the pool", async () => {
    await program.methods
      .unpause()
      .accounts({
        pool,
        authority: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const poolState = await program.account.pool.fetch(pool);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.equal(poolState.paused, false);
  });

  // SEC-007: verify_proof is a hard fail-closed stub — no proof is accepted until a
  // real Groth16 verifier is integrated. Withdraw must revert with InvalidProof and
  // move no funds. (The old `[1, 2, 3, 4]` dummy-proof backdoor was removed.)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Withdraw fails closed (InvalidProof) until a real verifier is integrated", async () => {
    const nullifier = Array.from(crypto.randomBytes(32));
    const proof = Buffer.from([1, 2, 3, 4]);

    const preBalance = await provider.connection.getTokenAccountBalance(recipientTokenAccount);

    try {
      await program.methods
        .withdraw(nullifier, proof, amount)
        .accounts({
          pool,
          poolTokenAccount,
          mint,
          recipient: recipient.publicKey,
          recipientTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed closed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      assert.include(e.toString(), "InvalidProof");
    }

    // No funds released.
    const postBalance = await provider.connection.getTokenAccountBalance(recipientTokenAccount);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.equal(postBalance.value.amount, preBalance.value.amount);
  });

  // A rejected withdraw must not record its nullifier (verify_proof rejects before the
  // nullifier is inserted). On-chain double-spend rejection is re-tested once withdraw
  // is functional under the real verifier (SEC-007).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Fail-closed withdraw records no nullifier", async () => {
    const nullifier = Array.from(crypto.randomBytes(32));
    const proof = Buffer.from([1, 2, 3, 4]);

    try {
      await program.methods
        .withdraw(nullifier, proof, amount)
        .accounts({
          pool,
          poolTokenAccount,
          mint,
          recipient: recipient.publicKey,
          recipientTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed closed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      assert.include(e.toString(), "InvalidProof");
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const poolState = await program.account.pool.fetch(pool);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.equal(poolState.nullifiersSpent.spent.length, 0);
  });
  
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Cannot withdraw when paused", async () => {
    await program.methods
      .pause()
      .accounts({
        pool,
        authority: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    const nullifier = Array.from(crypto.randomBytes(32));
    // The pause guard runs before verify_proof, so this reverts with PoolPaused
    // regardless of the proof value.
    const proof = Buffer.from([1, 2, 3, 4]);
    try {
      await program.methods
        .withdraw(nullifier, proof, amount)
        .accounts({
          pool,
          poolTokenAccount,
          mint,
          recipient: recipient.publicKey,
          recipientTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      assert.include(e.toString(), "PoolPaused");
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Unauthorized pause fails", async () => {
    await program.methods
      .unpause()
      .accounts({
        pool,
        authority: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    try {
      await program.methods
        .pause()
        .accounts({
          pool,
          authority: depositor.publicKey,
        })
        .signers([depositor])
        .rpc();
      assert.fail("Should have failed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // It fails either Anchor's constraint or custom logic
      assert.ok(e);
    }
  });
});
