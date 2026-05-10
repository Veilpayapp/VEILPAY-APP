module veilpay::veil_registry {
    use std::signer;
    use std::string::String;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::timestamp;
    use aptos_std::table::{Self, Table};
    use aptos_std::simple_map::{Self, SimpleMap};

    /// Error codes
    const E_ALREADY_REGISTERED: u64 = 1;
    const E_NOT_MERCHANT: u64 = 2;
    const E_INACTIVE: u64 = 3;
    const E_NOT_OWNER: u64 = 4;
    const E_UNAUTHORIZED: u64 = 5;

    /// Events
    struct MerchantRegisteredEvent has drop, store {
        merchant_id: vector<u8>,
        owner: address,
        metadata: String,
    }

    struct ViewingKeyPublishedEvent has drop, store {
        merchant_id: vector<u8>,
        chain_id: u64,
        viewing_key: vector<u8>,
    }

    struct MerchantDeactivatedEvent has drop, store {
        merchant_id: vector<u8>,
        owner: address,
    }

    /// Merchant resource
    struct Merchant has key {
        owner: address,
        metadata: String,
        active: bool,
        registered_at: u64,
        viewing_keys: SimpleMap<u64, vector<u8>>,
        settlement_addresses: SimpleMap<u64, address>,
        merchant_events: EventHandle<MerchantRegisteredEvent>,
        viewing_key_events: EventHandle<ViewingKeyPublishedEvent>,
    }

    /// Registry holding all merchants
    struct Registry has key {
        admin: address,
        merchants: Table<address, vector<u8>>,
        merchant_ids: Table<vector<u8>, address>,
    }

    /// Initialize registry — only the deployer can call this
    public entry fun initialize(admin: &signer) {
        let addr = signer::address_of(admin);
        move_to(admin, Registry {
            admin: addr,
            merchants: table::new(),
            merchant_ids: table::new(),
        });
    }

    /// Register a new merchant
    public entry fun register_merchant(
        owner: &signer,
        merchant_id: vector<u8>,
        metadata: String,
    ) acquires Registry, Merchant {
        let addr = signer::address_of(owner);

        // Check not already registered
        let registry = borrow_global_mut<Registry>(@veilpay);
        assert!(!table::contains(&registry.merchants, addr), E_ALREADY_REGISTERED);

        // SC-M9 fix: use real timestamp instead of hardcoded 0
        let now = timestamp::now_seconds();

        // Create merchant resource
        move_to(owner, Merchant {
            owner: addr,
            metadata,
            active: true,
            registered_at: now,
            viewing_keys: simple_map::create(),
            settlement_addresses: simple_map::create(),
            merchant_events: account::new_event_handle<MerchantRegisteredEvent>(owner),
            viewing_key_events: account::new_event_handle<ViewingKeyPublishedEvent>(owner),
        });

        // Update registry
        table::add(&mut registry.merchants, addr, merchant_id);
        table::add(&mut registry.merchant_ids, merchant_id, addr);

        // Emit event
        let merchant = borrow_global_mut<Merchant>(addr);
        event::emit_event(
            &mut merchant.merchant_events,
            MerchantRegisteredEvent {
                merchant_id,
                owner: addr,
                metadata,
            },
        );
    }

    /// SC-H3 fix: upsert pattern for viewing key publication
    /// Uses add_or_replace to prevent abort on duplicate chain_id
    public entry fun publish_viewing_key(
        owner: &signer,
        chain_id: u64,
        viewing_key: vector<u8>,
    ) acquires Merchant {
        let addr = signer::address_of(owner);
        let merchant = borrow_global_mut<Merchant>(addr);

        assert!(merchant.owner == addr, E_NOT_MERCHANT);
        assert!(merchant.active, E_INACTIVE);

        // SC-H3 fix: use upsert (add or replace) instead of add which aborts on duplicates
        if (simple_map::contains_key(&merchant.viewing_keys, chain_id)) {
            simple_map::borrow_mut(&mut merchant.viewing_keys, chain_id) = viewing_key;
        } else {
            simple_map::add(&mut merchant.viewing_keys, chain_id, viewing_key);
        };

        event::emit_event(
            &mut merchant.viewing_key_events,
            ViewingKeyPublishedEvent {
                merchant_id: simple_map::borrow(&merchant.viewing_keys, chain_id).clone(),
                chain_id,
                viewing_key,
            },
        );
    }

    /// Set chain settlement address (SC-M8 fix: actually use settlement_addresses)
    public entry fun set_chain_address(
        owner: &signer,
        chain_id: u64,
        settlement_address: address,
    ) acquires Merchant {
        let addr = signer::address_of(owner);
        let merchant = borrow_global_mut<Merchant>(addr);

        assert!(merchant.owner == addr, E_NOT_MERCHANT);
        assert!(merchant.active, E_INACTIVE);

        if (simple_map::contains_key(&merchant.settlement_addresses, chain_id)) {
            simple_map::borrow_mut(&mut merchant.settlement_addresses, chain_id) = settlement_address;
        } else {
            simple_map::add(&mut merchant.settlement_addresses, chain_id, settlement_address);
        };
    }

    /// SC-M7 fix: merchant self-deactivation
    public entry fun deactivate_merchant(owner: &signer) acquires Merchant {
        let addr = signer::address_of(owner);
        let merchant = borrow_global_mut<Merchant>(addr);
        assert!(merchant.owner == addr, E_NOT_OWNER);
        merchant.active = false;
    }

    /// Reactivate a merchant
    public entry fun reactivate_merchant(owner: &signer) acquires Merchant {
        let addr = signer::address_of(owner);
        let merchant = borrow_global_mut<Merchant>(addr);
        assert!(merchant.owner == addr, E_NOT_OWNER);
        merchant.active = true;
    }

    #[view]
    public fun is_merchant(address: address): bool acquires Registry {
        let registry = borrow_global<Registry>(@veilpay);
        table::contains(&registry.merchants, address)
    }

    #[view]
    public fun is_merchant_active(address: address): bool acquires Merchant {
        if (exists<Merchant>(address)) {
            let merchant = borrow_global<Merchant>(address);
            merchant.active
        } else {
            false
        }
    }
}
