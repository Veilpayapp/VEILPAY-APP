/**
 * Andrej Karpathy first-principles style unit tests for timing.ts
 * Thoroughly covers request timeouts, sleep utility, and abort controller signals.
 */

import { withTimeout, sleep } from '../timing';

describe('timing utility tests', () => {
  beforeAll(() => {
    jest.useRealTimers();
  });

  describe('withTimeout', () => {
    it('resolves immediately if the inner promise resolves before timeout', async () => {
      const promise = Promise.resolve('success-value');
      const timedPromise = withTimeout(promise, 100);

      await expect(timedPromise).resolves.toBe('success-value');
    });

    it('rejects with timeout message if the inner promise takes too long', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve('done'), 200));
      const timedPromise = withTimeout(slowPromise, 50);

      await expect(timedPromise).rejects.toThrow('Request timeout after 50ms');
    });

    it('rejects with custom timeout message if provided', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve('done'), 200));
      const timedPromise = withTimeout(slowPromise, 50, 'Custom timeout exceeded');

      await expect(timedPromise).rejects.toThrow('Custom timeout exceeded');
    });
  });

  describe('sleep', () => {
    it('resolves after the specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(40); // Allow slight timing variations in JS engine
    });

    it('can be cancelled with an already aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const sleepPromise = sleep(100, controller.signal);

      await expect(sleepPromise).rejects.toThrow('Aborted');
    });

    it('can be aborted dynamically during the sleep period', async () => {
      const controller = new AbortController();
      
      const sleepPromise = sleep(200, controller.signal);
      
      // Abort after 50ms
      setTimeout(() => {
        controller.abort();
      }, 50);

      await expect(sleepPromise).rejects.toThrow('Aborted');
    });

    it('resolves successfully with a signal that is not aborted', async () => {
      const controller = new AbortController();
      const sleepPromise = sleep(50, controller.signal);
      await expect(sleepPromise).resolves.toBeUndefined();
    });
  });
});

