#[test_only]
module veilpay::veil_registry_tests {
    use std::signer;
    use std::string;
    use aptos_framework::account;
    use aptos_framework::timestamp;
    use veilpay::veil_registry;

    fun setup_test(admin: &signer, aptos_framework: &signer) {
        account::create_account_for_test(signer::address_of(admin));
        timestamp::set_time_has_started_for_testing(aptos_framework);
        veil_registry::initialize(admin);
    }

    #[test(admin = @veilpay, owner = @0x123, aptos_framework = @0x1)]
    fun test_register_merchant(admin: &signer, owner: &signer, aptos_framework: &signer) {
        setup_test(admin, aptos_framework);
        account::create_account_for_test(signer::address_of(owner));
        
        veil_registry::register_merchant(owner, x"1234", string::utf8(b"metadata"));
        
        assert!(veil_registry::is_merchant(signer::address_of(owner)), 0);
        assert!(veil_registry::is_merchant_active(signer::address_of(owner)), 1);
    }
    
    #[test(admin = @veilpay, owner = @0x123, aptos_framework = @0x1)]
    fun test_publish_viewing_key(admin: &signer, owner: &signer, aptos_framework: &signer) {
        setup_test(admin, aptos_framework);
        account::create_account_for_test(signer::address_of(owner));
        veil_registry::register_merchant(owner, x"1234", string::utf8(b"metadata"));
        
        veil_registry::publish_viewing_key(owner, 1, x"aaaa");
        // Update key
        veil_registry::publish_viewing_key(owner, 1, x"bbbb");
        veil_registry::publish_viewing_key(owner, 2, x"cccc");
    }

    #[test(admin = @veilpay, owner = @0x123, aptos_framework = @0x1)]
    fun test_set_chain_address(admin: &signer, owner: &signer, aptos_framework: &signer) {
        setup_test(admin, aptos_framework);
        account::create_account_for_test(signer::address_of(owner));
        veil_registry::register_merchant(owner, x"1234", string::utf8(b"metadata"));
        
        veil_registry::set_chain_address(owner, 1, @0x456);
        veil_registry::set_chain_address(owner, 1, @0x789);
        veil_registry::set_chain_address(owner, 2, @0x789);
    }

    #[test(admin = @veilpay, owner = @0x123, aptos_framework = @0x1)]
    fun test_deactivate_reactivate(admin: &signer, owner: &signer, aptos_framework: &signer) {
        setup_test(admin, aptos_framework);
        account::create_account_for_test(signer::address_of(owner));
        veil_registry::register_merchant(owner, x"1234", string::utf8(b"metadata"));
        
        veil_registry::deactivate_merchant(owner);
        assert!(!veil_registry::is_merchant_active(signer::address_of(owner)), 0);
        
        veil_registry::reactivate_merchant(owner);
        assert!(veil_registry::is_merchant_active(signer::address_of(owner)), 1);
    }
    
    #[test(admin = @veilpay, owner = @0x123, aptos_framework = @0x1)]
    #[expected_failure(abort_code = veilpay::veil_registry::E_ALREADY_REGISTERED, location = veilpay::veil_registry)]
    fun test_duplicate_registration(admin: &signer, owner: &signer, aptos_framework: &signer) {
        setup_test(admin, aptos_framework);
        account::create_account_for_test(signer::address_of(owner));
        veil_registry::register_merchant(owner, x"1234", string::utf8(b"metadata"));
        veil_registry::register_merchant(owner, x"5678", string::utf8(b"metadata2"));
    }

    #[test(admin = @veilpay, owner = @0x123, aptos_framework = @0x1)]
    #[expected_failure(abort_code = veilpay::veil_registry::E_INACTIVE, location = veilpay::veil_registry)]
    fun test_publish_inactive(admin: &signer, owner: &signer, aptos_framework: &signer) {
        setup_test(admin, aptos_framework);
        account::create_account_for_test(signer::address_of(owner));
        veil_registry::register_merchant(owner, x"1234", string::utf8(b"metadata"));
        veil_registry::deactivate_merchant(owner);
        veil_registry::publish_viewing_key(owner, 1, x"aaaa");
    }

    #[test(admin = @veilpay, owner = @0x123, aptos_framework = @0x1)]
    #[expected_failure(abort_code = veilpay::veil_registry::E_INACTIVE, location = veilpay::veil_registry)]
    fun test_set_chain_address_inactive(admin: &signer, owner: &signer, aptos_framework: &signer) {
        setup_test(admin, aptos_framework);
        account::create_account_for_test(signer::address_of(owner));
        veil_registry::register_merchant(owner, x"1234", string::utf8(b"metadata"));
        veil_registry::deactivate_merchant(owner);
        veil_registry::set_chain_address(owner, 1, @0x456);
    }

    #[test(admin = @veilpay, aptos_framework = @0x1)]
    fun test_is_merchant_active_not_exists(admin: &signer, aptos_framework: &signer) {
        setup_test(admin, aptos_framework);
        assert!(!veil_registry::is_merchant_active(@0x999), 0);
        assert!(!veil_registry::is_merchant(@0x999), 1);
    }
}
