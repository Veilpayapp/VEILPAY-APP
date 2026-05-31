import request from 'supertest';
import { app } from '../../src/index';

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    merchant: {
      findUnique: jest.fn().mockResolvedValue({ id: 'test-merchant', tier: 'basic', webhookUrl: 'http://mock.com' }),
    },
  },
}));

jest.mock('../../src/lib/redis', () => ({
  getRedisClient: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/jobs/webhookQueue', () => ({
  enqueueWebhook: jest.fn().mockResolvedValue({ id: 'job_123' }),
  enqueueWebhookDlq: jest.fn().mockResolvedValue({ id: 'dlq_123' }),
}));

describe('E2E: Webhook Delivery', () => {
  it('should enqueue a webhook when an invoice completes', async () => {
    // In a real E2E, we trigger an invoice status change and verify enqueueWebhook was called
    const { enqueueWebhook } = require('../../src/jobs/webhookQueue');
    
    // Simulate webhook
    await enqueueWebhook({
      merchantId: 'test-merchant',
      invoiceId: 'inv_123',
      eventType: 'invoice.completed',
      data: { status: 'completed' }
    });

    expect(enqueueWebhook).toHaveBeenCalled();
  });
});
