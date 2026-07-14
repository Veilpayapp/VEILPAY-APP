# Data subject requests (PRIV-002)

## Scope

VeilPay’s consumer app is **self-custody first**. Most user data lives on the
device (seed phrase in SecureStore, local transaction cache, address book).
A small amount of optional analytics may leave the device when the user opts in.

This document covers:

1. **In-app local wipe** (user self-serve)
2. **Operator / support DSAR** for cloud analytics

## In-app local wipe

**Settings → Erase all local data**

After confirmation and biometric/PIN auth, the app:

| Step | What is removed |
|------|-----------------|
| Mnemonic | SecureStore seed phrase |
| Wallet session | Connected address + chain state |
| Transactions | Local history cache |
| Address book | Saved recipients |
| Analytics | Local Mixpanel identity + opt-out (`deleteAnalyticsData`) |

Code entry points:

- `apps/consumer-app/src/utils/accountWipe.ts` — `wipeLocalAccountData()`
- `apps/consumer-app/src/screens/SettingsScreen.tsx` — UI + auth gate
- Analytics-only erase remains available as **Delete analytics data** (PRIV-001)

### What local wipe does *not* do

- Cannot erase on-chain history (public ledger is immutable).
- Does not automatically delete Mixpanel *server-side* profiles (see below).

## Operator DSAR (Mixpanel / support)

When a user emails support with a DSAR:

1. Confirm control of the wallet (signed message or prior support verification).
2. Collect the **hashed `wallet_id_hash`** the app uses for analytics (never ask
   for the seed phrase).
3. File a Mixpanel erasure request for that distinct_id / hash.
4. Confirm completion to the user and record the ticket id.

Local erase is always available without waiting for support; server-side erase
is the residual step for opted-in analytics.
