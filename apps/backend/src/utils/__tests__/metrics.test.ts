import { recordRpcLatency, incrementWebhookDeliveryAttempt } from '../metrics';

describe('metrics', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('recordRpcLatency logs latency', () => {
    recordRpcLatency('eth', 120);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('120ms for eth'));
  });

  it('incrementWebhookDeliveryAttempt logs attempt status', () => {
    incrementWebhookDeliveryAttempt('success');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('webhook_delivery_attempt: success'));
  });
});
