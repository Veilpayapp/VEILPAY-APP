// Silence the ops-alert path (Sentry + console.warn) triggered by breaker trips.
jest.mock('@sentry/node', () => ({ captureMessage: jest.fn() }));

import {
  consumeRpcBudget,
  isRpcCircuitOpen,
  noteRpcFailure,
  noteRpcSuccess,
  recordUpstreamStatus,
  getRpcDailyBudget,
  __test,
} from '../rpcBudget';

describe('rpcBudget (SEC-001)', () => {
  beforeEach(() => {
    __test.reset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('daily budget', () => {
    it('allows calls up to the budget then fails closed', async () => {
      __test.setDailyBudget(3);
      expect((await consumeRpcBudget()).ok).toBe(true);
      expect((await consumeRpcBudget()).ok).toBe(true);
      expect((await consumeRpcBudget()).ok).toBe(true);

      const over = await consumeRpcBudget();
      expect(over.ok).toBe(false);
      expect(over.count).toBe(4);
      expect(over.budget).toBe(3);
    });

    it('reset restores the configured default budget', () => {
      __test.setDailyBudget(1);
      __test.reset();
      expect(getRpcDailyBudget()).toBe(__test.DEFAULT_DAILY_BUDGET);
    });
  });

  describe('circuit breaker', () => {
    it('opens only after the failure threshold; a success resets the run', () => {
      expect(isRpcCircuitOpen()).toBe(false);

      for (let i = 0; i < __test.CIRCUIT_TRIP_AT - 1; i++) noteRpcFailure('provider_5xx');
      expect(isRpcCircuitOpen()).toBe(false);

      noteRpcSuccess(); // resets the consecutive-failure run

      for (let i = 0; i < __test.CIRCUIT_TRIP_AT - 1; i++) noteRpcFailure('provider_5xx');
      expect(isRpcCircuitOpen()).toBe(false);

      noteRpcFailure('provider_5xx'); // crosses the threshold
      expect(isRpcCircuitOpen()).toBe(true);
    });
  });

  describe('recordUpstreamStatus', () => {
    it('counts provider 429s as failures and trips the circuit', () => {
      for (let i = 0; i < __test.CIRCUIT_TRIP_AT; i++) recordUpstreamStatus(429, 'ethereum');
      expect(isRpcCircuitOpen()).toBe(true);
    });

    it('counts provider 5xx as failures and trips the circuit', () => {
      for (let i = 0; i < __test.CIRCUIT_TRIP_AT; i++) recordUpstreamStatus(503, 'ethereum');
      expect(isRpcCircuitOpen()).toBe(true);
    });

    it('treats 2xx as success and never trips', () => {
      for (let i = 0; i < __test.CIRCUIT_TRIP_AT * 2; i++) recordUpstreamStatus(200, 'ethereum');
      expect(isRpcCircuitOpen()).toBe(false);
    });

    it('an interleaved success prevents tripping', () => {
      for (let i = 0; i < __test.CIRCUIT_TRIP_AT - 1; i++) recordUpstreamStatus(500, 'ethereum');
      recordUpstreamStatus(200, 'ethereum'); // resets the run
      recordUpstreamStatus(500, 'ethereum');
      expect(isRpcCircuitOpen()).toBe(false);
    });
  });
});
