# Veilpay On-Ramp: Complete Implementation Prompt

> **Purpose:** This document is a self-contained implementation prompt that covers every bug, gap, and improvement needed in the Veilpay crypto on-ramp flow. An engineer (human or AI) should be able to read this document alone and implement every fix without additional context.

---

## CODEBASE CONTEXT

- **Monorepo:** pnpm Turborepo at `D:\Veilpay`
- **Consumer app:** `apps/consumer-app` — React Native / Expo mobile wallet
- **Backend:** `apps/backend` — Express.js API with Prisma/PostgreSQL
- **State management:** Zustand with persisted stores
- **On-ramp flow:** `OnrampAmountScreen` → `OnrampQuotesScreen` → `OnrampWidgetScreen` (Onramp.money / MoonPay) or `TransakWebViewScreen` (Transak)
- **Wallet architecture:** 4 address types — `evm` (0x + 40 hex, shared across all EVM chains), `svm` (Base58, Solana), `mvm` (0x + 64 hex, Aptos), `xlm` (G + 55 base32, Stellar)
- **Existing correct pattern:** `DepositCryptoScreen.tsx:211-228` correctly resolves per-chain-type addresses using `useWalletStore.getState().addresses[targetChainType]` — use this as the reference implementation

---

## PHASE 1 — CRITICAL: FUND SAFETY + WIDGET FIXES

These fixes prevent fund loss and make the three provider widgets functional. Apply them first, in order.

---

### FIX 1: Add `fiatCurrency` to route params type definition

**File:** `apps/consumer-app/src/navigation/AppNavigator.tsx`  
**Lines:** 150-155  
**Problem:** `OnrampQuotes` route params do not include `fiatCurrency`. The fiat currency selected by the user on `OnrampAmountScreen` is never passed as a navigation param.

**Current code (line 150-155):**
```typescript
[SCREENS.ONRAMP_QUOTES]: {
  flow: 'buy' | 'sell';
  fiatAmount: string;
  cryptoToken: string;
  chainKey: string;
};
```

**Change to:**
```typescript
[SCREENS.ONRAMP_QUOTES]: {
  flow: 'buy' | 'sell';
  fiatAmount: string;
  fiatCurrency: string;
  cryptoToken: string;
  chainKey: string;
};
```

---

### FIX 2: Pass `fiatCurrency` from `OnrampAmountScreen` when navigating

**File:** `apps/consumer-app/src/screens/OnrampAmountScreen.tsx`  
**Lines:** 48-57  
**Problem:** `handleContinue` navigates to `OnrampQuotes` without passing `fiatCurrency`. The selected currency (`nativeCurrency` from Zustand) is lost. Also `nativeCurrency` is missing from the `useCallback` dependency array.

**Current code (line 48-57):**
```typescript
const handleContinue = useCallback(() => {
  if (!amount || !activeChain) return;
  
  navigation.navigate(SCREENS.ONRAMP_QUOTES, {
    flow,
    fiatAmount: amount,
    cryptoToken: activeChain.nativeToken.symbol,
    chainKey: activeChain.key,
  });
}, [amount, activeChain, flow, navigation]);
```

**Change to:**
```typescript
const handleContinue = useCallback(() => {
  if (!amount || !activeChain) return;
  
  navigation.navigate(SCREENS.ONRAMP_QUOTES, {
    flow,
    fiatAmount: amount,
    fiatCurrency: nativeCurrency,
    cryptoToken: activeChain.nativeToken.symbol,
    chainKey: activeChain.key,
  });
}, [amount, activeChain, flow, navigation, nativeCurrency]);
```

---

### FIX 3: Rewrite `OnrampQuotesScreen` — use route param `fiatCurrency`, fix `getOnrampUrl` call, fix display, fix address resolution

**File:** `apps/consumer-app/src/screens/OnrampQuotesScreen.tsx`

This file has 6 separate bugs:

**Bug 3a — Line 44:** `fiatCurrency` not destructured from `route.params`.  
**Bug 3b — Line 62:** `fetchQuotes` uses `nativeCurrency` from Zustand instead of route param.  
**Bug 3c — Line 79:** `nativeCurrency` missing from `useCallback` dependency array (stale closure).  
**Bug 3d — Lines 121-127:** `getOnrampUrl()` call is missing `fiatCurrency` param entirely.  
**Bug 3e — Line 106:** `walletAddress: address` uses `useWalletStore().address` (the active chain address) instead of resolving the correct address for the target `chainKey`. If user's active chain is Ethereum but `chainKey` is `solana`, the EVM address gets sent to the provider and funds are lost.  
**Bug 3f — Lines 177, 220:** Hardcoded `₹` rupee symbol instead of dynamic currency symbol.

**Changes required:**

1. **Line 44** — Add `fiatCurrency` to the destructured route params:
```typescript
// BEFORE:
const { flow, fiatAmount, cryptoToken, chainKey } = route.params;
// AFTER:
const { flow, fiatAmount, fiatCurrency, cryptoToken, chainKey } = route.params;
```

2. **Add a currency symbol helper** — either import from a new utility or inline. Create `apps/consumer-app/src/utils/currency.ts`:
```typescript
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥',
  AUD: 'A$', CAD: 'C$', AED: 'د.إ', TRY: '₺',
};
export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] || code;
}
```

3. **Add a chain-type address resolver** — create `apps/consumer-app/src/utils/chainAddressResolver.ts`:
```typescript
import { useWalletStore, type ChainType } from '../stores/walletStore';

const CHAIN_TYPE_MAP: Record<string, ChainType> = {
  ethereum: 'evm', polygon: 'evm', arbitrum: 'evm',
  base: 'evm', bsc: 'evm', sepolia: 'evm',
  solana: 'svm', 'solana-devnet': 'svm',
  aptos: 'mvm',
  stellar: 'xlm', 'stellar-testnet': 'xlm',
};

export function getChainType(chainKey: string): ChainType | null {
  return CHAIN_TYPE_MAP[chainKey.toLowerCase()] || null;
}

export function getAddressForChain(chainKey: string): string | null {
  const chainType = getChainType(chainKey);
  if (!chainType) return null;
  return useWalletStore.getState().addresses[chainType] || null;
}
```

4. **Rewrite `fetchQuotes`** — use `fiatCurrency` from route params, add it to dependency array:
```typescript
const fetchQuotes = useCallback(async () => {
  setIsLoading(true);
  setError(null);
  try {
    const baseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';
    const query = new URLSearchParams({
      fiatAmount,
      fiatCurrency,       // route param, not Zustand
      cryptoToken,
      flow,
    });
    const response = await fetch(`${baseUrl}/api/v1/onramp/quotes?${query.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch quotes');
    const data = await response.json();
    setQuotes(data.quotes || []);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Unknown error occurred');
  } finally {
    setIsLoading(false);
  }
}, [fiatAmount, fiatCurrency, cryptoToken, flow]);
```

5. **Rewrite `handleProviderSelect`** — resolve correct chain-type address, pass `fiatCurrency` to `getOnrampUrl`:
```typescript
const handleProviderSelect = async (provider: string) => {
  triggerLightImpactHaptic();

  // Resolve the correct address for the TARGET chain, not the active chain.
  const targetAddress = getAddressForChain(chainKey);
  if (!targetAddress) {
    alert(`No wallet found for ${chainKey.toUpperCase()}. Please create or import a wallet for this chain.`);
    return;
  }

  const transakFiat: FiatCurrency =
    (FIAT_CURRENCIES as readonly string[]).includes(fiatCurrency)
      ? (fiatCurrency as FiatCurrency)
      : 'USD';

  if (provider === 'transak') {
    if (chainKey === 'aptos') {
      alert('Transak does not support Aptos. Please select another provider.');
      return;
    }
    if (chainKey === 'stellar' || chainKey === 'stellar-testnet') {
      alert('Transak does not support Stellar. Please select another provider.');
      return;
    }

    const url = buildTransakDepositUrl({
      walletAddress: targetAddress,       // correct chain-type address
      fiatAmount: parseFloat(fiatAmount),
      fiatCurrency: transakFiat,
      cryptoToken,
      network: chainKey,
      paymentMethod: 'credit_debit_card',
    });

    navigation.navigate(SCREENS.TRANSAK_WEBVIEW, {
      url,
      title: flow === 'buy' ? 'Buy via Transak' : 'Sell via Transak',
      flow,
    });
  } else if (provider === 'onramp_money' || provider === 'moonpay') {
    if (chainKey === 'aptos' || chainKey === 'stellar' || chainKey === 'stellar-testnet') {
      alert(`${getProviderName(provider)} does not support ${chainKey}. Please select another provider.`);
      return;
    }

    setIsLoading(true);
    const session = await getOnrampUrl({
      fiatAmount,
      fiatCurrency,           // THE CRITICAL FIX — was missing entirely
      cryptoToken,
      chainKey,
      flow,
      provider,
      walletAddress: targetAddress,  // correct chain-type address (see Fix 4)
    });
    setIsLoading(false);

    if (session) {
      navigation.navigate(SCREENS.ONRAMP_WIDGET, {
        url: session.url,
        orderId: session.orderId,
        title: flow === 'buy'
          ? `Buy via ${getProviderName(provider)}`
          : `Sell via ${getProviderName(provider)}`,
      });
    }
  } else if (provider === 'stripe') {
    alert('Stripe integration coming soon.');
  }
};
```

6. **Fix display** — replace hardcoded `₹` with dynamic symbol. Import `getCurrencySymbol` from `../utils/currency`:

   - **Line 177:** Change `₹{fiatAmount}` to `{getCurrencySymbol(fiatCurrency)}{fiatAmount}`
   - **Line 220:** Change `₹{parseFloat(quote.providerFee) + parseFloat(quote.networkFee)}` to `{getCurrencySymbol(fiatCurrency)}{(parseFloat(quote.providerFee) + parseFloat(quote.networkFee)).toFixed(2)}`

7. **Remove the `useSettingsStore` import and `nativeCurrency` destructuring** from this screen — it should no longer read currency from Zustand. The source of truth is `route.params.fiatCurrency`.

---

### FIX 4: Rewrite `useOnramp` hook — accept `walletAddress`, require `fiatCurrency`, remove `|| 'INR'` fallbacks

**File:** `apps/consumer-app/src/hooks/useOnramp.ts`

**Problem 4a — Line 12:** `fiatCurrency` is optional in `OnrampQuoteRequest`. It should be required.  
**Problem 4b — Line 27:** `const { address } = useWalletStore()` — the hook always uses the active chain address. It should accept an explicit `walletAddress` param from the caller who has already resolved the correct chain-type address.  
**Problem 4c — Line 58:** `params.fiatCurrency || 'INR'` — silently defaults to INR.  
**Problem 4d — Line 87:** `params.fiatCurrency || 'INR'` — same silent INR default in order tracking.

**Changes required:**

1. **Update the interface (line 10-17):**
```typescript
export interface OnrampQuoteRequest {
  fiatAmount?: string;
  fiatCurrency: string;        // REQUIRED now — no more || 'INR'
  cryptoToken: string;
  chainKey: string;
  flow: 'buy' | 'sell';
  provider?: string;
  walletAddress?: string;      // NEW — caller provides the correct chain-type address
}
```

2. **In `getOnrampUrl` callback — use the explicit walletAddress, remove INR fallbacks:**

   - **Line 56:** Change `userAddress: address,` to `userAddress: params.walletAddress || address,`
   - **Line 58:** Change `fiatCurrency: params.fiatCurrency || 'INR',` to `fiatCurrency: params.fiatCurrency,`
   - **Line 82:** Change `walletAddress: address,` to `walletAddress: params.walletAddress || address,`
   - **Line 83:** Change `userAddress: address,` to `userAddress: params.walletAddress || address,`
   - **Line 87:** Change `fiatCurrency: params.fiatCurrency || 'INR',` to `fiatCurrency: params.fiatCurrency,`

---

### FIX 5: Remove hardcoded `'INR'` defaults from backend

Three files need changes:

#### 5a. Backend Zod schema

**File:** `apps/backend/src/controllers/onrampController.ts`  
**Line 29:** Change `fiatCurrency: z.string().default('INR'),` to `fiatCurrency: z.string().min(3).max(3),`

This makes `fiatCurrency` required. Any client not sending it will get a Zod validation error (400) instead of silently defaulting to INR.

#### 5b. Backend quotes endpoint

**File:** `apps/backend/src/controllers/onrampController.ts`  
**Lines 246, 256**

Replace:
```typescript
const { fiatAmount, fiatCurrency = 'INR', cryptoToken = 'ETH', flow = 'buy' } = req.query;
// ...
const currency = (typeof fiatCurrency === 'string' ? fiatCurrency : 'INR').toUpperCase();
```

With:
```typescript
const { fiatAmount, fiatCurrency, cryptoToken = 'ETH', flow = 'buy' } = req.query;
if (!fiatCurrency || typeof fiatCurrency !== 'string') {
  res.status(400).json({ error: 'fiatCurrency is required' });
  return;
}
const currency = fiatCurrency.toUpperCase();
```

#### 5c. Onramp.money URL builder

**File:** `apps/backend/src/lib/onramp.ts`  
**Line 24:** Change `fiatCurrency?: string;` to `fiatCurrency: string;` in the param type  
**Line 32:** Change `fiatCurrency = 'INR',` to `fiatCurrency,` (remove the default)

#### 5d. MoonPay URL builder

**File:** `apps/backend/src/lib/moonpay.ts`  
**Line 18:** Change `fiatCurrency?: string;` to `fiatCurrency: string;` in the param type  
**Line 26:** Change `fiatCurrency = 'INR',` to `fiatCurrency,` (remove the default)

---

### FIX 6: Fix Transak WebView `originWhitelist`

**File:** `apps/consumer-app/src/screens/TransakWebViewScreen.tsx`  
**Line 426**

**Problem:** The `originWhitelist` only allows `global.transak.com` and `global-stg.transak.com`. Transak's KYC flow redirects through third-party identity verification domains (sardine.ai, veriff.me, etc.) and card payment processor domains. The restrictive whitelist blocks these navigations, causing the widget to appear broken — the WebView shows a blank screen when Transak redirects to KYC.

**Change:**
```typescript
// BEFORE:
originWhitelist: ['https://global.transak.com', 'https://global-stg.transak.com'],
// AFTER:
originWhitelist: ['https://*'],
```

This matches the pattern already used by `OnrampWidgetScreen.tsx:113` for the Onramp.money/MoonPay WebView. The security boundary is enforced by the existing `handleShouldStartLoadWithRequest` callback in the Transak screen and the domain whitelist in `isAllowedOnrampUrl()` for the onramp screen.

---

### FIX 7: Add widget load timeout to `OnrampWidgetScreen`

**File:** `apps/consumer-app/src/screens/OnrampWidgetScreen.tsx`

**Problem:** There is no timeout. If MoonPay or Onramp.money fails to load (wrong currency, API key issue, network error), the user sees an infinite loading spinner with no way to know what happened.

**Changes:** Add a 30-second load timeout with retry + close UI.

After the existing `const [loading, setLoading] = useState(true);` on line 25, add:
```typescript
const [loadTimedOut, setLoadTimedOut] = useState(false);
const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add a timeout effect after the existing `useEffect` for order status polling (after line 69):
```typescript
useEffect(() => {
  loadTimeoutRef.current = setTimeout(() => {
    if (loading) {
      setLoadTimedOut(true);
      setLoading(false);
    }
  }, 30_000);

  return () => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
  };
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

Change `onLoadEnd` (line 107) to also clear the timeout:
```typescript
onLoadEnd: () => {
  setLoading(false);
  setLoadTimedOut(false);
  if (loadTimeoutRef.current) {
    clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = null;
  }
},
```

Add a timed-out error UI in the render, between the `FiatGatewayWebViewShell` header and `webViewProps`:
```typescript
errorState={loadTimedOut ? (
  <View style={styles.errorContainer}>
    <Icon name="close" size={28} color={colors.error} />
    <Text style={styles.errorTitle}>Gateway not responding</Text>
    <Text style={styles.errorText}>
      The payment gateway is taking too long to load. Check your connection and try again.
    </Text>
    <View style={styles.errorActions}>
      <TouchableOpacity
        onPress={() => {
          setLoadTimedOut(false);
          setLoading(true);
          loadTimeoutRef.current = setTimeout(() => {
            setLoadTimedOut(true);
            setLoading(false);
          }, 30_000);
          webViewRef.current?.reload();
        }}
        style={styles.retryButton}
      >
        <Text style={styles.retryButtonText}>RETRY</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
        <Text style={styles.closeButtonText}>CLOSE</Text>
      </TouchableOpacity>
    </View>
  </View>
) : null}
```

Add the styles for `errorContainer`, `errorTitle`, `errorText`, `errorActions`, `retryButton`, `retryButtonText`, `closeButton`, `closeButtonText` to the `themeStyles` — follow the exact same pattern used in `TransakWebViewScreen.tsx:523-584` for consistency.

---

### FIX 8: Add chain-level guards for unsupported providers

**File:** `apps/consumer-app/src/screens/OnrampQuotesScreen.tsx`  
(Already covered in Fix 3's rewrite of `handleProviderSelect`)

**What to guard:**

| Chain | Transak | Onramp.money | MoonPay |
|-------|---------|-------------|---------|
| ethereum, polygon, arbitrum, base, bsc | ✓ | ✓ | ✓ |
| solana | ✓ | ✓ | ✓ (verify in MoonPay dashboard) |
| aptos | BLOCK (maps to avalanche incorrectly) | BLOCK (no mapping) | BLOCK (invalid currency code) |
| stellar, stellar-testnet | BLOCK (no support) | BLOCK (no mapping) | BLOCK (invalid currency code) |
| sepolia, solana-devnet | BLOCK (testnets — providers reject) | BLOCK | BLOCK |

Show the user: `"[Provider] does not support [chain]. Please select another provider or switch chains."`

Also: **filter out providers from the quotes list** that don't support the current `chainKey`. Don't show a Transak quote card if `chainKey === 'aptos'`. This filtering should happen client-side after receiving quotes from the backend, or the backend should accept `chainKey` and filter quotes server-side.

---

## PHASE 2 — HONEST QUOTES

These fixes replace the fabricated quotes with real provider data.

---

### FIX 9: Replace fabricated quotes with real provider API calls

**File:** `apps/backend/src/controllers/onrampController.ts`  
**Lines:** 273-302

**Problem:** The `getOnrampQuotes` endpoint does NOT call any provider API. It takes a single Binance price and applies hardcoded fake markups:

```
onramp_money: baseRate × 1.010 → always cheapest → always "BEST RATE"
stripe:       baseRate × 1.015 → always second (but not even integrated)
transak:      baseRate × 1.020 → always third
moonpay:      baseRate × 1.025 → always most expensive
```

The sort at line 304 sorts by `estimatedCryptoAmount`, so this hardcoded order NEVER changes. Onramp.money always wins. This is dishonest.

Additionally:
- Network fees are hardcoded flat INR numbers (50, 60, 40, 80) regardless of selected currency. A USD user sees "$80 network fee" which is wrong.
- Stripe quotes are shown but Stripe is not integrated — clicking it shows "coming soon"
- The codebase already has a real Transak quote API client at `apps/consumer-app/src/utils/transakQuote.ts` (calls `https://api.transak.com/api/v1/pricing/public/quotes`) with full caching, timeout, and fallback support. It is completely unused by the aggregator flow.

**What to implement:**

1. **Option A (recommended — server-side aggregation):** Rewrite `getOnrampQuotes` to call each provider's real pricing API in parallel:
   - **Transak:** `GET https://api.transak.com/api/v1/pricing/public/quotes?partnerApiKey={key}&fiatCurrency={fiat}&cryptoCurrency={crypto}&network={network}&isBuyOrSell={flow}&fiatAmount={amount}` — the client code for this already exists in `transakQuote.ts:316-344`
   - **MoonPay:** `GET https://api.moonpay.com/v3/currencies/{crypto}/buy_quote?apiKey={key}&baseCurrencyCode={fiat}&baseCurrencyAmount={amount}` — verify exact endpoint in MoonPay docs
   - **Onramp.money:** Check their API docs for a quote/pricing endpoint. If none exists, use a reasonable estimate based on their published fee schedule rather than an arbitrary 1% markup.
   - Call all three in parallel with `Promise.allSettled` and a 5-second timeout each
   - Return real `estimatedCryptoAmount`, `exchangeRate`, `providerFee`, `networkFee` from each provider's response
   - If a provider's API call fails or times out, either omit that provider from results or mark it as `isAvailable: false` with a `reason` field

2. **Option B (simpler — client-side quotes):** Keep the backend quotes endpoint as a rough estimate only. Wire up the existing `useTransakQuote` hook on the client side for Transak's real quote. Fetch MoonPay and Onramp.money quotes client-side too. This approach is less clean but leverages existing code.

3. **Regardless of approach:**
   - Remove Stripe from the quotes list entirely until it's integrated. Don't show fake Stripe quotes.
   - Add a `fiatCurrency` field to each quote in the response so the frontend knows which currency the fees are denominated in.
   - Make network fees currency-aware — if user selects USD, fees should be in USD, not INR.
   - Sort by actual `estimatedCryptoAmount` (more crypto = better deal for the user).
   - The "BEST RATE" badge at `OnrampQuotesScreen.tsx:204` is fine IF the sort is based on real data.

**Updated Quote response shape:**
```typescript
interface QuoteResponse {
  provider: string;
  estimatedCryptoAmount: string;
  exchangeRate: string;
  providerFee: string;
  networkFee: string;
  fiatCurrency: string;          // NEW — which currency fees are in
  isAvailable: boolean;          // NEW — false if provider doesn't support this pair
  unavailableReason?: string;    // NEW — why the provider is unavailable
}
```

---

## PHASE 3 — FEATURE COMPLETENESS

---

### FIX 10: Add token selector to `OnrampAmountScreen`

**File:** `apps/consumer-app/src/screens/OnrampAmountScreen.tsx`  
**Line 54:** `cryptoToken: activeChain.nativeToken.symbol` — hardcoded to native token

**Problem:** Users can only buy the chain's native token (ETH, SOL, BNB, MATIC). They cannot buy USDC or USDT even though all three providers and the backend fully support stablecoin purchases on every EVM chain and Solana.

**What to implement:**

1. Add a `selectedToken` state initialized to `activeChain.nativeToken.symbol`
2. Add a token selector UI (either inline pill buttons or a modal) that shows the tokens available for the active chain
3. Use the existing `getTokensForChain(activeChain.key)` function from `apps/consumer-app/src/utils/transak.ts:156` to get the filtered token list
4. Pass `selectedToken` instead of `activeChain.nativeToken.symbol` in the navigation params
5. When the active chain changes, reset `selectedToken` to the new chain's native token
6. Show the selected token name/symbol next to the amount input (e.g., "Buy ETH" or "Buy USDC")

**Token list per chain** (from `transak.ts` `CRYPTO_TOKENS`):
- ethereum: ETH, USDT, USDC
- polygon: MATIC, USDT, USDC
- arbitrum: ETH, USDT, USDC
- base: ETH, USDT, USDC
- bsc: BNB, USDT, USDC
- solana: SOL, USDT, USDC
- aptos: none (no Transak support — show only APT from chain config)
- stellar: none (no provider support — show only XLM from chain config)

---

### FIX 11: Fix `DepositCryptoScreen` Aptos guard

**File:** `apps/consumer-app/src/screens/DepositCryptoScreen.tsx`

**Problem:** `OnrampQuotesScreen` has an Aptos guard for Transak (line 100-103) but `DepositCryptoScreen` does NOT. The `TRANSAK_NETWORK_MAP` in `transak.ts:149` maps `aptos` to `avalanche` ("Closest available; Transak doesn't support Aptos natively"). If a user reaches Transak through `DepositCryptoScreen` while on Aptos, the correct Aptos-format address IS used (from `addresses['mvm']`), but the Transak widget thinks it's an Avalanche order. This is a mismatch that could lose funds.

**What to implement:** Add the same guard that exists in `OnrampQuotesScreen:100-103` to `DepositCryptoScreen`'s `handleContinue`:

Before building the Transak URL, check:
```typescript
if (selectedCrypto.network === 'aptos') {
  toast.show('Transak does not support Aptos.', 'error');
  return;
}
if (selectedCrypto.network === 'stellar') {
  toast.show('Transak does not support Stellar.', 'error');
  return;
}
```

Also: remove the incorrect `TRANSAK_NETWORK_MAP` entry at `transak.ts:149`:
```typescript
// REMOVE THIS LINE — it silently maps Aptos to Avalanche which is wrong:
aptos: 'avalanche',     // Closest available; Transak doesn't support Aptos natively
```

With this entry removed, `getTokensForChain('aptos')` will return `undefined` from the map lookup, which triggers the fallback to show all tokens — that's also wrong. Instead, change the fallback in `getTokensForChain` (line 158):
```typescript
// BEFORE:
if (!transakNetwork) return [...CRYPTO_TOKENS]; // fallback: show all
// AFTER:
if (!transakNetwork) return []; // unsupported chain — no Transak tokens available
```

---

### FIX 12: Add provider support matrix validation

**New file:** `apps/consumer-app/src/utils/providerSupport.ts`

Create a centralized place that defines which fiat + crypto + network combinations each provider supports. This should be checked BEFORE launching any widget.

```typescript
export type OnrampProvider = 'transak' | 'onramp_money' | 'moonpay';

// Chains each provider supports (verify against provider dashboards)
export const PROVIDER_CHAIN_SUPPORT: Record<OnrampProvider, string[]> = {
  transak:      ['ethereum', 'polygon', 'arbitrum', 'base', 'bsc', 'solana'],
  onramp_money: ['ethereum', 'polygon', 'arbitrum', 'base', 'bsc', 'solana'],
  moonpay:      ['ethereum', 'polygon', 'arbitrum', 'base', 'bsc', 'solana'],
};

// Fiat currencies each provider supports (verify against provider dashboards)
export const PROVIDER_FIAT_SUPPORT: Record<OnrampProvider, string[]> = {
  transak:      ['USD', 'EUR', 'GBP', 'INR'],
  onramp_money: ['INR', 'USD', 'TRY', 'AED'],
  moonpay:      ['USD', 'EUR', 'GBP'],  // MoonPay INR support is limited — verify
};

export function isProviderSupported(
  provider: OnrampProvider,
  chainKey: string,
  fiatCurrency: string,
): { supported: boolean; reason?: string } {
  const chains = PROVIDER_CHAIN_SUPPORT[provider];
  if (!chains?.includes(chainKey)) {
    return { supported: false, reason: `${provider} does not support ${chainKey}` };
  }
  const fiats = PROVIDER_FIAT_SUPPORT[provider];
  if (!fiats?.includes(fiatCurrency.toUpperCase())) {
    return { supported: false, reason: `${provider} does not support ${fiatCurrency}` };
  }
  return { supported: true };
}
```

Use this in `OnrampQuotesScreen.handleProviderSelect` before launching any widget. Also use it to filter the quotes list — don't show a provider card if it doesn't support the current chain + fiat combination.

---

### FIX 13: Sync `packages/shared/src/chains.ts` with consumer app

**Problem:** The shared package is out of sync with the consumer app's chain definitions:
- **Missing chains:** `bsc`, `stellar`, `stellar-testnet`
- **No `xlm` ChainType** — the shared package only defines `"evm" | "svm" | "mvm"`
- **Polygon naming:** Shared package uses `POL`, consumer app uses `MATIC`
- **Extra chain:** Shared package has `optimism` which is not in the consumer app

**What to implement:** Update `packages/shared/src/chains.ts` to match the consumer app's `walletStore.ts` chain definitions. Add the `xlm` chain type, add BSC and Stellar chains, and decide on POL vs MATIC naming (POL is the current official name after EIP-2063/PIP-17 — the consumer app should be updated to match).

---

## PHASE 4 — OBSERVABILITY & TESTING

---

### FIX 14: Add structured logging for the on-ramp flow

Create `apps/consumer-app/src/utils/onrampLogger.ts` with the following log events:

- `quote_request` — log when quotes are fetched: `{ fiatCurrency, cryptoToken, chainKey, fiatAmount }`
- `quote_response` — log quote results: `{ providerCount, bestProvider, bestRate }`
- `widget_init` — log when a widget is launched: `{ provider, fiatCurrency, cryptoToken, chainKey, walletAddress (truncated), url (truncated) }`
- `widget_error` — log when a widget fails to load or times out: `{ provider, errorType, errorMessage, durationMs }`
- `provider_failure` — log when a provider API call fails: `{ provider, errorCode, errorMessage }`
- `address_resolved` — log the chain-type address resolution: `{ chainKey, chainType, addressPrefix (first 6 chars only) }`

Use `console.log` for dev + Sentry breadcrumbs for production. Import `captureError` from `../utils/sentry` (already exists in the codebase) for error-level events.

---

### FIX 15: Add tests

**Unit tests to add:**

1. `apps/consumer-app/src/utils/__tests__/currency.test.ts` — test `getCurrencySymbol` for USD, EUR, GBP, INR, unknown codes
2. `apps/consumer-app/src/utils/__tests__/chainAddressResolver.test.ts` — test `getChainType` and `getAddressForChain` for all chain keys
3. `apps/consumer-app/src/utils/__tests__/providerSupport.test.ts` — test `isProviderSupported` for supported pairs, unsupported chains, unsupported fiats

**Integration test scenarios:**

1. **USD + ETH on Ethereum:** fiatCurrency=USD passed through entire flow, quote request contains USD, widget URL contains USD
2. **INR + ETH on Ethereum:** same flow but with INR
3. **USD + SOL on Solana:** correct Solana address resolved (not EVM address), Transak URL has `network=solana`
4. **ETH on Aptos:** all three providers show "not supported" or are filtered out
5. **Fallback test:** ensure no `|| 'INR'` or `default('INR')` silently overrides the selected currency to INR

---

## VERIFICATION CHECKLIST

After all fixes are applied, verify each item:

- [ ] Select USD on OnrampAmountScreen → quotes screen shows `$` prefix, not `₹`
- [ ] Select INR on OnrampAmountScreen → quotes screen shows `₹` prefix
- [ ] Select EUR on OnrampAmountScreen → quotes screen shows `€` prefix
- [ ] Backend `/api/v1/onramp/quotes` returns 400 if `fiatCurrency` is missing
- [ ] Backend `/api/v1/onramp/url` returns 400 if `fiatCurrency` is missing
- [ ] Clicking Onramp.money with USD selected → widget opens with `fiatType=USD` in URL
- [ ] Clicking MoonPay with USD selected → widget opens with `baseCurrencyCode=usd` in URL
- [ ] Clicking Transak → KYC flow loads (not blocked by originWhitelist)
- [ ] Buying SOL on Solana chain → Solana Base58 address sent to provider (not EVM 0x address)
- [ ] Buying on Aptos → all providers blocked with clear message
- [ ] Buying on Stellar → all providers blocked with clear message
- [ ] MoonPay widget shows error + retry after 30s if it fails to load
- [ ] No file in the repo has `|| 'INR'` or `.default('INR')` in the on-ramp flow
- [ ] Quotes endpoint returns real provider rates (not fabricated hardcoded markups)
- [ ] Stripe quotes are NOT shown until Stripe is integrated
- [ ] "BEST RATE" badge reflects actual best provider, not always Onramp.money
- [ ] Token selector on OnrampAmountScreen allows selecting USDC/USDT on EVM chains
- [ ] `getTokensForChain('aptos')` returns `[]` (not all tokens)
- [ ] `TRANSAK_NETWORK_MAP` does not have `aptos: 'avalanche'` entry
- [ ] All existing tests pass
- [ ] New unit tests pass for currency helper, address resolver, provider support matrix

---

## COMMIT PLAN

```
1. fix(critical): resolve correct chain-type address in onramp flow

   Prevent fund loss by resolving the wallet address for the TARGET chain
   (not the active chain) before passing to any provider. Add
   chainAddressResolver utility following the pattern from DepositCryptoScreen.
   Block Aptos and Stellar from all providers.

2. fix(critical): pass fiatCurrency through entire quote-to-widget pipeline

   Add fiatCurrency to ONRAMP_QUOTES route params. Pass from
   OnrampAmountScreen. Use route param in OnrampQuotesScreen (not Zustand).
   Pass to getOnrampUrl(). Make fiatCurrency required in OnrampQuoteRequest.
   Remove all || 'INR' fallbacks from useOnramp hook.

3. fix(backend): remove hardcoded INR defaults from all onramp endpoints

   Remove .default('INR') from CreateOrderSchema. Require fiatCurrency in
   quotes endpoint. Remove fiatCurrency = 'INR' defaults from
   OnrampService.generateSignedUrl and MoonPayService.generateSignedUrl.

4. fix(transak): widen originWhitelist to allow KYC provider redirects

   Change originWhitelist from Transak-only domains to ['https://*'].
   Transak KYC redirects through sardine.ai, veriff.me, etc.

5. fix(ui): replace hardcoded ₹ with dynamic currency symbol

   Add getCurrencySymbol utility. Use fiatCurrency from route params for
   all currency symbol display in OnrampQuotesScreen.

6. feat(onramp): add widget load timeout with retry UX

   Add 30s timeout to OnrampWidgetScreen. Show error + retry + close
   when MoonPay or Onramp.money fails to load.

7. fix(quotes): replace fabricated quotes with real provider API calls

   Call each provider's real pricing API in parallel. Remove hardcoded
   fee markups. Remove Stripe from quotes until integrated. Make
   network fees currency-aware. Wire up existing transakQuote.ts.

8. feat(onramp): add token selector for USDC/USDT purchases

   Add token selection to OnrampAmountScreen using getTokensForChain().
   Allow buying USDC, USDT, and native tokens on all supported chains.

9. fix(transak): remove incorrect aptos-to-avalanche network mapping

   Remove aptos: 'avalanche' from TRANSAK_NETWORK_MAP. Change
   getTokensForChain fallback to return [] for unsupported chains.
   Add Aptos guard to DepositCryptoScreen.

10. feat(onramp): add provider support matrix and validation layer

    Create providerSupport.ts with chain + fiat support matrices.
    Filter quote cards by provider support. Validate before widget launch.

11. chore: add structured logging and unit tests for onramp flow

    Add onrampLogger for quote/widget/error events. Add unit tests for
    currency helper, address resolver, provider support matrix.
```

---

## FILES MODIFIED (COMPLETE LIST)

| File | Fixes Applied |
|------|--------------|
| `apps/consumer-app/src/navigation/AppNavigator.tsx` | #1 |
| `apps/consumer-app/src/screens/OnrampAmountScreen.tsx` | #2, #10 |
| `apps/consumer-app/src/screens/OnrampQuotesScreen.tsx` | #3, #8 |
| `apps/consumer-app/src/hooks/useOnramp.ts` | #4 |
| `apps/backend/src/controllers/onrampController.ts` | #5a, #5b, #9 |
| `apps/backend/src/lib/onramp.ts` | #5c |
| `apps/backend/src/lib/moonpay.ts` | #5d |
| `apps/consumer-app/src/screens/TransakWebViewScreen.tsx` | #6 |
| `apps/consumer-app/src/screens/OnrampWidgetScreen.tsx` | #7 |
| `apps/consumer-app/src/screens/DepositCryptoScreen.tsx` | #11 |
| `apps/consumer-app/src/utils/transak.ts` | #11 (remove aptos mapping, fix fallback) |
| `packages/shared/src/chains.ts` | #13 |

## NEW FILES CREATED

| File | Purpose |
|------|---------|
| `apps/consumer-app/src/utils/currency.ts` | Currency symbol helper |
| `apps/consumer-app/src/utils/chainAddressResolver.ts` | Per-chain-type address resolution |
| `apps/consumer-app/src/utils/providerSupport.ts` | Provider support matrix |
| `apps/consumer-app/src/utils/onrampLogger.ts` | Structured logging |
| `apps/consumer-app/src/utils/__tests__/currency.test.ts` | Unit tests |
| `apps/consumer-app/src/utils/__tests__/chainAddressResolver.test.ts` | Unit tests |
| `apps/consumer-app/src/utils/__tests__/providerSupport.test.ts` | Unit tests |
