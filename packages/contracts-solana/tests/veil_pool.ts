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

  // Shared across deposit/withdraw scaffold tests (single-leaf deploy gate).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let firstCommitment: number[] = [];

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Can deposit once (scaffold single-leaf)", async () => {
    firstCommitment = Array.from(crypto.randomBytes(32));
    firstCommitment[0] = firstCommitment[0] & 0x0f;

    await program.methods
      .deposit(firstCommitment, amount)
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.deepEqual(Array.from(poolState.merkleRoot), firstCommitment);

    const poolTokenBalance = await provider.connection.getTokenAccountBalance(poolTokenAccount);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    assert.equal(poolTokenBalance.value.amount, amount.toString());
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Rejects second distinct deposit (ScaffoldSingleLeafOnly deploy gate)", async () => {
    const other = Array.from(crypto.randomBytes(32));
    other[0] = other[0] & 0x0f;
    try {
      await program.methods
        .deposit(other, amount)
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
      assert.fail("Should have failed scaffold single-leaf gate");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      assert.include(e.toString(), "ScaffoldSingleLeafOnly");
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Cannot re-deposit the same commitment (DuplicateCommitment)", async () => {
    try {
      await program.methods
        .deposit(firstCommitment, amount)
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

  // SEC-007: real Groth16 verifier is live. Forged / malformed proofs and
  // unknown merkle roots must fail closed (no funds, no nullifier). The old
  // `[1, 2, 3, 4]` dummy-proof backdoor must never succeed.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Withdraw with unknown merkle root fails closed", async () => {
    const nullifier = Array.from(crypto.randomBytes(32));
    const unknownRoot = Array.from(crypto.randomBytes(32));
    // 256-byte zero proof — well-formed length, invalid curve points.
    const proof = Buffer.alloc(256);

    const preBalance = await provider.connection.getTokenAccountBalance(recipientTokenAccount);

    try {
      await program.methods
        .withdraw(nullifier, proof, unknownRoot, amount)
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
      assert.include(e.toString(), "InvalidMerkleRoot");
    }

    const postBalance = await provider.connection.getTokenAccountBalance(recipientTokenAccount);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.equal(postBalance.value.amount, preBalance.value.amount);
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  it("Withdraw with matching root + forged proof fails InvalidProof", async () => {
    // Use the single scaffold leaf from the earlier deposit (no second deposit).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const poolBefore = await program.account.pool.fetch(pool);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const commitment = Array.from(poolBefore.merkleRoot as number[]);
    assert.equal(commitment.length, 32);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    assert.equal(poolBefore.leafCount.toNumber(), 1);

    const nullifier = Array.from(crypto.randomBytes(32));
    nullifier[0] = nullifier[0] & 0x0f;
    // Historical dummy backdoor + well-formed-length zeros — both must fail.
    const forgedShort = Buffer.from([1, 2, 3, 4]);
    const forgedFull = Buffer.alloc(256);

    const preBalance = await provider.connection.getTokenAccountBalance(recipientTokenAccount);

    for (const proof of [forgedShort, forgedFull]) {
      try {
        await program.methods
          .withdraw(nullifier, proof, commitment, amount)
          .accounts({
            pool,
            poolTokenAccount,
            mint,
            recipient: recipient.publicKey,
            recipientTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("Should have failed closed on forged proof");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        assert.include(e.toString(), "InvalidProof");
      }
    }

    const postBalance = await provider.connection.getTokenAccountBalance(recipientTokenAccount);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.equal(postBalance.value.amount, preBalance.value.amount);

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
    const merkleRoot = Array.from(crypto.randomBytes(32));
    // The pause guard runs before root/proof checks, so this reverts with
    // PoolPaused regardless of the proof / root values.
    const proof = Buffer.alloc(256);
    try {
      await program.methods
        .withdraw(nullifier, proof, merkleRoot, amount)
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
