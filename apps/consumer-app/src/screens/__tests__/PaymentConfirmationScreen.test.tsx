/**
 * PaymentConfirmationScreen — confirm-flow render/behavior tests.
 *
 * The screen is the payment authorization surface. These tests drive it
 * through the heavy mocked layers (payment hook, market data, gas estimator,
 * balance reader, SPP client) and assert the states a user actually sees:
 * the standard confirm button, token vs native fee summaries, the private
 * send readiness gate (no Stellar owner / blocked pool / ready), SPP op
 * headers, in-flight status copy, insufficient-funds gating, and the
 * result-modal outcomes (confirmed with explorer link, failed with retry).
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

import { SUPPORTED_CHAINS } from '../../stores/walletStore';
import { useWalletStore } from '../../stores/walletStore';

// ── Mutable mock state (factories read these lazily) ─────────────────────────

const mockRouteParams: Record<string, unknown> = {
  recipient: '0x' + '2'.repeat(40),
  amount: '0.5',
  token: 'ETH',
  privacyLevel: 'standard',
};

const mockNav = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  reset: jest.fn(),
  replace: jest.fn(),
};

const mockTx = {
  txStatus: 'idle' as string,
  txResult: null as { hash?: string; error?: string } | null,
  gasEstimate: null as Record<string, unknown> | null,
  gasExpensive: false,
  isWalletVerificationPending: false,
  isSendDisabled: false,
  handleConfirmSend: jest.fn(),
};

const mockQuote: { price: number; lastUpdated: number; isStale: boolean } = {
  price: 3000,
  lastUpdated: 12345,
  isStale: false,
};

interface MockPrepResult {
  readyForProve: boolean;
  poolOps?: boolean;
  chainEnabled?: boolean;
}
const mockSpp = {
  prepareSppOp: jest.fn<Promise<MockPrepResult>, [string, string]>(
    async () => ({ readyForProve: true })
  ),
  gatingSppBlocker: jest.fn<string | null, [unknown]>(() => 'unstaged circuit assets'),
};

// BalanceResult shape (utils/balanceFetcher.ts): balance/balanceFormatted
// strings + source ('rpc' | 'fallback') + optional error/subentryCount.
const mockBalance = {
  balance: '10',
  balanceFormatted: '10.000',
  symbol: 'ETH',
  decimals: 18,
  lastUpdated: Date.now(),
  source: 'rpc',
};

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../../hooks/usePaymentTransaction', () => ({
  usePaymentTransaction: () => mockTx,
}));

jest.mock('../../hooks/useMarketData', () => ({
  useMarketData: () => ({
    quotes: {},
    isLoading: false,
    error: null,
    refresh: jest.fn(async () => undefined),
    lastUpdated: null,
    getQuote: () => mockQuote,
  }),
}));

jest.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isConnected: true }),
}));

jest.mock('../../components/ZkpProver', () => {
  const React = require('react');
  return { ZkpProver: React.forwardRef(() => null) };
});

jest.mock('../../utils/secureSigner', () => ({
  deriveAddressFromStoredMnemonic: jest.fn(async () => null),
}));

jest.mock('../../utils/gasEstimator', () => ({
  estimateTransactionGas: jest.fn(async () => ({
    gasLimit: 21000n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    gasPrice: 0n,
    estimatedCostWei: 0n,
    estimatedCostEth: '0.002',
    estimatedCostUsd: '6.00',
    isStale: false,
    fetchedAt: Date.now(),
  })),
  isGasExpensive: () => false,
}));

jest.mock('../../utils/balanceFetcher', () => ({
  fetchNativeBalance: jest.fn(async () => mockBalance),
}));

jest.mock('../../utils/priceFeed', () => ({
  FALLBACK_PRICES: { ETH: 3000, XLM: 0.12 },
  getFiatExchangeRate: jest.fn(async () => 1),
  formatFiatValue: (v: number) => `$${v.toFixed(2)}`,
  formatLastUpdated: () => 'just now',
}));

jest.mock('../../utils/stellarSpp/sppClient', () => ({
  prepareSppOp: (...a: Parameters<typeof mockSpp.prepareSppOp>) =>
    mockSpp.prepareSppOp(...a),
  gatingSppBlocker: (...a: Parameters<typeof mockSpp.gatingSppBlocker>) =>
    mockSpp.gatingSppBlocker(...a),
}));

jest.mock('../../utils/stellarSpp/sppSyncMessages', () => ({
  formatSppSyncUserMessage: (msg: string) => `[${msg}]`,
}));

jest.mock('../../utils/stellarSpp', () => ({
  getLocalPrivateBalance: jest.fn(async () => ({ notes: [], amount: '0', nativeAmount: '0' })),
}));

jest.mock('../../utils/stellarSpp/sppFees', () => ({
  sppPlannedTxCount: jest.fn(() => 1),
}));

jest.mock('../../utils/stellarSpp/sppProgressSubscriber', () => ({
  recordSppProgressDiagnostic: jest.fn(),
  resetSppProgress: jest.fn(),
  subscribeSppProgress: jest.fn(() => () => undefined),
}));

jest.mock('../../utils/analytics', () => ({
  trackEvent: jest.fn(),
}));

import Component from '../PaymentConfirmationScreen';

const ETH_CHAIN = SUPPORTED_CHAINS.find((c) => c.key === 'ethereum')!;

async function renderScreen() {
  const utils = render(
    <Component navigation={mockNav as never} route={{ params: mockRouteParams } as never} />
  );
  // Flush the async effects (mnemonic check, balance read, privacy prep).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

function resetDefaults() {
  Object.assign(mockRouteParams, {
    recipient: '0x' + '2'.repeat(40),
    amount: '0.5',
    memo: undefined,
    token: 'ETH',
    tokenAddress: undefined,
    tokenDecimals: undefined,
    privacyLevel: 'standard',
    sppOp: undefined,
  });
  Object.assign(mockTx, {
    txStatus: 'idle',
    txResult: null,
    gasEstimate: null,
    gasExpensive: false,
    isWalletVerificationPending: false,
    isSendDisabled: false,
  });
  mockTx.handleConfirmSend.mockClear();
  mockNav.reset.mockClear();
  mockNav.replace.mockClear();
  mockQuote.price = 3000;
  mockBalance.balance = '10';
  mockBalance.balanceFormatted = '10.000';
  mockBalance.source = 'rpc';
  mockSpp.prepareSppOp.mockReset().mockResolvedValue({ readyForProve: true });
  mockSpp.gatingSppBlocker.mockReset().mockReturnValue('unstaged circuit assets');

  useWalletStore.setState({
    address: '0x' + '1'.repeat(40),
    addresses: {},
    activeChain: ETH_CHAIN,
    isConnected: true,
  });
}

describe('PaymentConfirmationScreen', () => {
  beforeEach(() => {
    resetDefaults();
  });

  it('renders the standard confirm state with a working CONFIRM & SEND', async () => {
    const { getByText, getByLabelText } = await renderScreen();
    expect(getByText('CONFIRM PAYMENT')).toBeTruthy();
    const send = getByLabelText('Confirm and send payment');
    expect(send).toBeTruthy();

    fireEvent.press(send);
    expect(mockTx.handleConfirmSend).toHaveBeenCalledTimes(1);
  });

  it('renders token-send details when a token address is supplied', async () => {
    Object.assign(mockRouteParams, {
      token: 'USDC',
      tokenAddress: '0x' + '3'.repeat(40),
      tokenDecimals: 6,
    });
    const { getByText } = await renderScreen();
    expect(getByText('YOU SEND')).toBeTruthy();
  });

  it('private send without a Stellar owner: gate explains and button locks', async () => {
    mockRouteParams.privacyLevel = 'private';
    const { getByText, getByLabelText } = await renderScreen();
    expect(getByText('Private sends unavailable')).toBeTruthy();
    expect(getByText(/Stellar address not ready/)).toBeTruthy();
    expect(getByLabelText('Private sends unavailable on this build')).toBeTruthy();
  });

  it('private send with the pool disabled on this build: terminal unavailable', async () => {
    mockRouteParams.privacyLevel = 'private';
    useWalletStore.setState({
      addresses: { xlm: 'G' + 'A'.repeat(55) },
    });
    mockSpp.prepareSppOp.mockResolvedValue({
      readyForProve: false,
      poolOps: false,
      chainEnabled: true,
    });
    const { getByText } = await renderScreen();
    expect(getByText(/pool-ops build/)).toBeTruthy();
  });

  it('private send with the chain not configured: terminal unavailable', async () => {
    mockRouteParams.privacyLevel = 'private';
    useWalletStore.setState({ addresses: { xlm: 'G' + 'A'.repeat(55) } });
    mockSpp.prepareSppOp.mockResolvedValue({
      readyForProve: false,
      poolOps: true,
      chainEnabled: false,
    });
    const { getByText } = await renderScreen();
    expect(getByText(/not configured for this network/)).toBeTruthy();
  });

  it('private send still syncing: shows the finishing gate with the real blocker', async () => {
    mockRouteParams.privacyLevel = 'private';
    useWalletStore.setState({ addresses: { xlm: 'G' + 'A'.repeat(55) } });
    mockSpp.prepareSppOp.mockResolvedValue({
      readyForProve: false,
      poolOps: true,
      chainEnabled: true,
    });
    const { getByText, getByLabelText } = await renderScreen();
    expect(getByText('Finishing private account sync')).toBeTruthy();
    expect(getByText(/\[unstaged circuit assets\]/)).toBeTruthy();
    expect(getByLabelText('Preparing private account, please wait')).toBeTruthy();
  });

  it('private send ready: unlocks CONFIRM & SEND', async () => {
    mockRouteParams.privacyLevel = 'private';
    useWalletStore.setState({ addresses: { xlm: 'G' + 'A'.repeat(55) } });
    mockSpp.prepareSppOp.mockResolvedValue({ readyForProve: true });
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText('Confirm and send payment')).toBeTruthy();
  });

  it('private shield/unshield ops change the operation header', async () => {
    useWalletStore.setState({ addresses: { xlm: 'G' + 'A'.repeat(55) } });
    mockSpp.prepareSppOp.mockResolvedValue({ readyForProve: true });

    mockRouteParams.privacyLevel = 'private';
    mockRouteParams.sppOp = 'shield';
    const shield = await renderScreen();
    expect(shield.getByText('YOU ARE SHIELDING')).toBeTruthy();

    mockRouteParams.sppOp = 'unshield';
    const unshield = await renderScreen();
    expect(unshield.getByText('YOU ARE UNSHIELDING')).toBeTruthy();
  });

  it('insufficient native balance locks the send behind INSUFFICIENT FUNDS', async () => {
    mockBalance.balance = '0.00001';
    mockBalance.balanceFormatted = '0.00001';
    mockTx.gasEstimate = {
      gasLimit: 21000n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      gasPrice: 0n,
      estimatedCostWei: 0n,
      estimatedCostEth: '0.002',
      estimatedCostUsd: '6.00',
      isStale: false,
      fetchedAt: Date.now(),
    };
    const { getAllByText, getByLabelText } = await renderScreen();
    // Button title + warning banner both say INSUFFICIENT FUNDS.
    expect(getAllByText('INSUFFICIENT FUNDS').length).toBeGreaterThanOrEqual(2);
    expect(getAllByText(/You need about/).length).toBeGreaterThanOrEqual(1);
    expect(getByLabelText('Insufficient funds')).toBeTruthy();
  });

  it.each([
    ['proving', 'GENERATING ZK PROOF...'],
    ['spp_syncing', 'SYNCING PRIVATE POOL...'],
    ['sending', 'SIGNING TRANSACTION...'],
    ['pending', 'AWAITING CONFIRMATION...'],
  ])('in-flight status %s shows %s', async (status, text) => {
    mockTx.txStatus = status;
    const { getByText } = await renderScreen();
    expect(getByText(text)).toBeTruthy();
  });

  it('wallet verification pending relabels the button', async () => {
    mockTx.isWalletVerificationPending = true;
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText('Verifying wallet')).toBeTruthy();
  });

  it('confirmed: result modal with explorer link; RETURN TO HOME resets to Home', async () => {
    mockTx.txStatus = 'confirmed';
    mockTx.txResult = { hash: '0xdeadbeef' };
    const { getByText } = await renderScreen();
    expect(getByText('PAYMENT SENT')).toBeTruthy();
    expect(getByText('VIEW ON EXPLORER')).toBeTruthy();

    fireEvent.press(getByText('RETURN TO HOME'));
    expect(mockNav.reset).toHaveBeenCalledWith(
      expect.objectContaining({ routes: [expect.objectContaining({ name: 'Home' })] })
    );
  });

  it('failed: result modal with the error message and TRY AGAIN retries', async () => {
    mockTx.txStatus = 'failed';
    mockTx.txResult = { error: 'relayer rejected the proof' };
    const { getByText } = await renderScreen();
    expect(getByText('TRANSACTION FAILED')).toBeTruthy();
    expect(getByText('relayer rejected the proof')).toBeTruthy();

    fireEvent.press(getByText('TRY AGAIN'));
    expect(mockTx.handleConfirmSend).toHaveBeenCalledTimes(1);
  });
});
