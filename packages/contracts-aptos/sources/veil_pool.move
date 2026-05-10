module veilpay::veil_pool {
    use std::signer;
    use std::vector;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::account;
    use aptos_std::table::{Self, Table};

    /// Error codes
    const E_INVALID_AMOUNT: u64 = 1;
    const E_NULLIFIER_SPENT: u64 = 2;
    const E_INVALID_PROOF: u64 = 3;
    const E_UNAUTHORIZED: u64 = 4;

    /// Events
    struct NewCommitmentEvent has drop, store {
        commitment: vector<u8>,
        amount: u64,
        leaf_index: u64,
    }

    struct WithdrawalEvent has drop, store {
        nullifier: vector<u8>,
        amount: u64,
        recipient: address,
    }

    /// Pool resource
    struct Pool<phantom CoinType> has key {
        authority: address,
        balance: coin::Coin<CoinType>,
        leaf_count: u64,
        nullifiers: Table<vector<u8>, bool>,
        commitment_events: EventHandle<NewCommitmentEvent>,
        withdrawal_events: EventHandle<WithdrawalEvent>,
    }

    /// Initialize the pool
    public entry fun initialize<CoinType>(
        admin: &signer,
    ) {
        let addr = signer::address_of(admin);
        let pool = Pool<CoinType> {
            authority: addr,
            balance: coin::zero<CoinType>(),
            leaf_count: 0,
            nullifiers: table::new(),
            commitment_events: account::new_event_handle<NewCommitmentEvent>(admin),
            withdrawal_events: account::new_event_handle<WithdrawalEvent>(admin),
        };
        move_to(admin, pool);
    }

    /// Deposit funds into the pool
    public entry fun deposit<CoinType>(
        depositor: &signer,
        amount: u64,
        commitment: vector<u8>,
    ) acquires Pool {
        assert!(amount > 0, E_INVALID_AMOUNT);
        
        let addr = signer::address_of(depositor);
        let pool = borrow_global_mut<Pool<CoinType>>(@veilpay);
        
        // Extract coins from depositor
        let coins = coin::withdraw<CoinType>(depositor, amount);
        coin::merge(&mut pool.balance, coins);
        
        // Update leaf count
        let leaf_index = pool.leaf_count;
        pool.leaf_count = pool.leaf_count + 1;
        
        // Emit event
        event::emit_event(
            &mut pool.commitment_events,
            NewCommitmentEvent {
                commitment,
                amount,
                leaf_index,
            },
        );
    }

    /// Withdraw funds from the pool
    public entry fun withdraw<CoinType>(
        recipient: &signer,
        amount: u64,
        nullifier: vector<u8>,
        proof: vector<u8>,
    ) acquires Pool {
        let addr = signer::address_of(recipient);
        let pool = borrow_global_mut<Pool<CoinType>>(@veilpay);
        
        // Check nullifier not spent
        assert!(!table::contains(&pool.nullifiers, nullifier), E_NULLIFIER_SPENT);
        
        // Verify proof (placeholder - would integrate with actual verifier)
        assert!(verify_proof(proof, nullifier), E_INVALID_PROOF);
        
        // Mark nullifier as spent
        table::add(&mut pool.nullifiers, nullifier, true);
        
        // Withdraw coins
        let coins = coin::extract(&mut pool.balance, amount);
        coin::deposit(addr, coins);
        
        // Emit event
        event::emit_event(
            &mut pool.withdrawal_events,
            WithdrawalEvent {
                nullifier,
                amount,
                recipient: addr,
            },
        );
    }

    /// Placeholder proof verification
    /// SC-C2 fix: fail-closed stub. Must return false until a real
    /// Groth16 verifier is integrated. Returning true would allow
    /// anyone to withdraw pool funds without a valid proof.
    fun verify_proof(_proof: vector<u8>, _nullifier: vector<u8>): bool {
        false
    }

    #[view]
    public fun get_leaf_count<CoinType>(): u64 acquires Pool {
        let pool = borrow_global<Pool<CoinType>>(@veilpay);
        pool.leaf_count
    }
}
