jest.mock('@sentry/node', () => ({ captureMessage: jest.fn() }));

import * as Sentry from '@sentry/node';
import { sendOpsAlert, __test } from '../alerting';

describe('alerting (SEC-001)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    __test.reset();
    (Sentry.captureMessage as jest.Mock).mockClear();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-14T00:00:00Z'));
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('emits to Sentry and the log on first alert', () => {
    sendOpsAlert('rpc.test', 'something happened');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('throttles repeated alerts for the same key within the window', () => {
    sendOpsAlert('rpc.test', 'msg', { throttleMs: 60_000 });
    sendOpsAlert('rpc.test', 'msg', { throttleMs: 60_000 });
    sendOpsAlert('rpc.test', 'msg', { throttleMs: 60_000 });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('re-emits after the window and reports the suppressed count', () => {
    sendOpsAlert('rpc.test', 'msg', { throttleMs: 1_000 });
    sendOpsAlert('rpc.test', 'msg', { throttleMs: 1_000 }); // suppressed
    jest.advanceTimersByTime(1_001);
    sendOpsAlert('rpc.test', 'msg', { throttleMs: 1_000 });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    const secondMessage = (Sentry.captureMessage as jest.Mock).mock.calls[1][0] as string;
    expect(secondMessage).toContain('1 suppressed');
  });

  it('does not throttle across distinct keys', () => {
    sendOpsAlert('rpc.a', 'msg');
    sendOpsAlert('rpc.b', 'msg');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
  });

  it('never throws when Sentry.captureMessage fails', () => {
    (Sentry.captureMessage as jest.Mock).mockImplementationOnce(() => {
      throw new Error('sentry down');
    });
    expect(() => sendOpsAlert('rpc.test', 'msg')).not.toThrow();
  });
});
