// Feature: veilpay-privacy-stack, Property 19: Network gating disables stealth and max levels off Sepolia
//
// Validates: Requirements 13.4
//
// Property 19 (see design.md §Correctness Properties):
//   For any `(chainId, configured)` pair, the `PrivacyLevelScreen`'s
//   `'stealth'` and `'max'` rows MUST be rendered with
//   `accessibilityState.disabled === true` whenever
//   `chainId !== SEPOLIA_CHAIN_ID (11155111)` OR
//   `isPrivacyStackConfigured() === false`. The `'standard'` row is
//   universally selectable regardless of network.
//
//   Equivalently: `supported = (chainId === 11155111) && configured`,
//   and for `level ∈ {'stealth', 'max'}`, `disabled === !supported`.
//
// Why a property test
// -------------------
// Network gating is the single user-visible safety gate that prevents
// the app from offering shielded-pool / stealth flows on a chain where
// no `VeilPool`, `StealthAnnouncer`, or `Groth16Verifier` is deployed.
// A regression that flipped the predicate (or shorted out one branch)
// would silently let the user pick `'max'` on Polygon and submit a
// proof against a non-existent verifier. We therefore enumerate the
// gate decision against random `chainId` values — including the exact
// Sepolia id, neighbouring ids, and far-away mainnet ids — combined
// with both `configured = true / false`, to catch both branches of the
// gate (`chainId !== 11155111` and `!isPrivacyStackConfigured()`).
//
// Test strategy
// -------------
//   • The screen consumes `useActiveChain()` (from `walletStore`) and,
//     transitively via `useNetworkPrivacySupport`, `isPrivacyStackConfigured()`
//     (from `constants/contracts`). We mock those two module exports
//     and let the real `useNetworkPrivacySupport` hook run, so the
//     predicate under test is the production gate, not a re-statement.
//   • We render the screen fresh each fast-check iteration (so the
//     hook's `useMemo<[chainId]>` cache cannot mask a configured-flag
//     change between iterations) and call `cleanup()` between
//     iterations to bound memory growth across the 50-run sweep.

import React from 'react';
import { render, cleanup } from '@testing-library/react-native';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mocks — set up BEFORE importing the screen so that ESM hoisting wires the
// mocked modules into the screen's import graph (and into the
// `useNetworkPrivacySupport` hook it transitively pulls in).
// ---------------------------------------------------------------------------

const mockUseActiveChain = jest.fn<{ id: number } | undefined, []>();
const mockIsPrivacyStackConfigured = jest.fn<boolean, []>();

jest.mock('../../stores/walletStore', () => ({
  __esModule: true,
  // The screen imports `useWalletStore` directly (currently unused inside the
  // component body, but the import must still resolve). We expose a stub.
  useWalletStore: jest.fn(() => ({})),
  useActiveChain: () => mockUseActiveChain(),
}));

jest.mock('../../constants/contracts', () => ({
  __esModule: true,
  VEIL_POOL_ADDRESS: '0x0000000000000000000000000000000000000000',
  STEALTH_ANNOUNCER_ADDRESS: '0x0000000000000000000000000000000000000000',
  GROTH16_VERIFIER_ADDRESS: '0x0000000000000000000000000000000000000000',
  SEPOLIA_CHAIN_ID: 11155111,
  isPrivacyStackConfigured: () => mockIsPrivacyStackConfigured(),
}));

const mockSetPrivacyLevel = jest.fn();
jest.mock('../../stores/settingsStore', () => ({
  __esModule: true,
  useSettingsStore: () => ({
    defaultPrivacyLevel: 'standard',
    setPrivacyLevel: mockSetPrivacyLevel,
  }),
  // `design-tokens.ts` imports these selector hooks. Stub them so theme
  // resolution falls back to the default (`'dark'`) without exploding.
  useThemeState: () => 'dark',
  usePrivacyLevel: () => 'standard',
}));

// Toast is invoked from `handleSelect` for disabled rows. We don't exercise
// presses in this property test, but `useToast()` still has to return a
// stable shape for the screen to mount.
jest.mock('../../components/Toast', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => null,
    useToast: () => ({
      visible: false,
      message: '',
      type: 'info',
      show: jest.fn(),
      hide: jest.fn(),
    }),
  };
});

jest.mock('../../components/SovereignCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SovereignCard: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

jest.mock('../../components/SovereignButton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SovereignButton: () => React.createElement(View),
  };
});

jest.mock('../../components/Icon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Icon: () => React.createElement(View),
  };
});

jest.mock('../../components/ScreenBackButton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ScreenBackButton: () => React.createElement(View),
  };
});

jest.mock('../../utils/analytics', () => ({
  __esModule: true,
  trackEvent: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Late import — must come AFTER the jest.mock() calls.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrivacyLevelScreen } = require('../PrivacyLevelScreen');

// ---------------------------------------------------------------------------
// Test harness — synthetic navigation + route props sufficient to mount.
// ---------------------------------------------------------------------------
function makeProps() {
  return {
    navigation: {
      goBack: jest.fn(),
      navigate: jest.fn(),
      reset: jest.fn(),
    } as any,
    route: {
      key: 'PrivacyLevel',
      name: 'PrivacyLevel',
      params: {
        recipient: '0x' + '1'.repeat(40),
        amount: '0.1',
        memo: '',
        token: 'ETH',
      },
    } as any,
  };
}

const SEPOLIA_CHAIN_ID = 11155111;

describe('PrivacyLevelScreen — Property 19: network gating', () => {
  afterEach(() => {
    cleanup();
    mockUseActiveChain.mockReset();
    mockIsPrivacyStackConfigured.mockReset();
    mockSetPrivacyLevel.mockReset();
  });

  it('disables stealth and max iff chainId !== 11155111 || !isPrivacyStackConfigured()', () => {
    fc.assert(
      fc.property(
        // Smart generator: covers the exact Sepolia id, ±1 boundaries, and a
        // wide id space including mainnet (1), Polygon (137), Arbitrum (42161),
        // Base (8453), and arbitrary high ids. fc.oneof biases shrinking
        // toward the boundary cases that historically drive off-by-one bugs.
        fc.oneof(
          fc.constant(SEPOLIA_CHAIN_ID),
          fc.constant(SEPOLIA_CHAIN_ID - 1),
          fc.constant(SEPOLIA_CHAIN_ID + 1),
          fc.constant(1),
          fc.constant(137),
          fc.constant(42161),
          fc.constant(8453),
          fc.integer({ min: 1, max: 200_000_000 }),
        ),
        fc.boolean(),
        (chainId, configured) => {
          // Drive both gate inputs for this iteration.
          mockUseActiveChain.mockReturnValue({ id: chainId });
          mockIsPrivacyStackConfigured.mockReturnValue(configured);

          const { getByTestId } = render(<PrivacyLevelScreen {...makeProps()} />);

          const supported = chainId === SEPOLIA_CHAIN_ID && configured;

          const stealthRow = getByTestId('privacy-level-row-stealth');
          const maxRow = getByTestId('privacy-level-row-max');
          const standardRow = getByTestId('privacy-level-row-standard');

          // Property 19, branch (a) — stealth disabled iff !supported.
          expect(!!stealthRow.props.accessibilityState?.disabled).toBe(!supported);
          // Property 19, branch (b) — max disabled iff !supported.
          expect(!!maxRow.props.accessibilityState?.disabled).toBe(!supported);
          // Invariant — standard is universally selectable; the gate must
          // never collateral-damage the always-available row.
          expect(!!standardRow.props.accessibilityState?.disabled).toBe(false);

        },
      ),
      { numRuns: 50 },
    );
  });
});
