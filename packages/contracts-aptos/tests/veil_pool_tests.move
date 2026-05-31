#[test_only]
module veilpay::veil_pool_tests {
    use std::signer;
    use aptos_framework::coin;
    use aptos_framework::account;
    use veilpay::veil_pool;

    struct TestCoin {}

    fun setup_test(admin: &signer, depositor: &signer) {
        account::create_account_for_test(signer::address_of(admin));
        account::create_account_for_test(signer::address_of(depositor));

        let (burn_cap, freeze_cap, mint_cap) = coin::initialize<TestCoin>(
            admin,
            std::string::utf8(b"Test Coin"),
            std::string::utf8(b"TEST"),
            8,
            true,
        );

        coin::register<TestCoin>(depositor);
        let coins = coin::mint<TestCoin>(1000, &mint_cap);
        coin::deposit(signer::address_of(depositor), coins);
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);
        coin::destroy_freeze_cap(freeze_cap);
        
        veil_pool::initialize<TestCoin>(admin);
    }

    #[test(admin = @veilpay, depositor = @0x123)]
    fun test_deposit(admin: &signer, depositor: &signer) {
        setup_test(admin, depositor);
        
        veil_pool::deposit<TestCoin>(depositor, 100, x"1234");
        
        assert!(veil_pool::get_leaf_count<TestCoin>() == 1, 0);
    }

    #[test(admin = @veilpay, depositor = @0x123)]
    #[expected_failure(abort_code = veilpay::veil_pool::E_INVALID_AMOUNT, location = veilpay::veil_pool)]
    fun test_deposit_zero(admin: &signer, depositor: &signer) {
        setup_test(admin, depositor);
        
        veil_pool::deposit<TestCoin>(depositor, 0, x"1234");
    }

    #[test(admin = @veilpay, depositor = @0x123, recipient = @0x456)]
    #[expected_failure(abort_code = veilpay::veil_pool::E_INVALID_PROOF, location = veilpay::veil_pool)]
    fun test_withdraw_invalid_proof(admin: &signer, depositor: &signer, recipient: &signer) {
        setup_test(admin, depositor);
        account::create_account_for_test(signer::address_of(recipient));
        coin::register<TestCoin>(recipient);
        
        veil_pool::deposit<TestCoin>(depositor, 100, x"1234");
        
        // This should fail because verify_proof always returns false in the current implementation
        veil_pool::withdraw<TestCoin>(recipient, 100, x"5678", x"abcd");
    }
}
