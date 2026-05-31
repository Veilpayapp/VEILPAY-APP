import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { enqueueWebhook } from '../../jobs/webhookQueue';
import { confirmPayment, getPayments, getPaymentDetails } from '../paymentController';
import { PaymentListQuerySchema, PaymentListResponseSchema, uuidParamSchema } from '../../types';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    payment: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    invoice: {
      update: jest.fn(),
    },
  },
}));

jest.mock('../../jobs/webhookQueue', () => ({
  enqueueWebhook: jest.fn(),
}));

jest.mock('../../types', () => ({
  PaymentListQuerySchema: { parse: jest.fn((val) => val) },
  PaymentListResponseSchema: { parse: jest.fn((val) => val) },
  uuidParamSchema: { parse: jest.fn((val) => val) },
}));

describe('paymentController', () => {
  let req: Partial<Request> & { merchantId?: string };
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      merchantId: '00000000-0000-0000-0000-000000000001',
      params: {},
      query: {},
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe('confirmPayment', () => {
    it('creates a payment, updates invoice, and enqueues webhook', async () => {
      req.body = {
        invoiceId: '00000000-0000-0000-0000-000000000000',
        merchantId: '00000000-0000-0000-0000-000000000001',
        chainKey: 'ethereum',
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        fromAddress: '0xfrom',
        toAddress: '0xto',
        amount: '1.0',
        tokenSymbol: 'ETH',
        privacyLevel: 'standard',
      };

      const mockPayment = { id: 'payment-1' };
      const mockInvoice = { id: '00000000-0000-0000-0000-000000000000' };

      (prisma.payment.create as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.invoice.update as jest.Mock).mockResolvedValue(mockInvoice);

      await confirmPayment(req as any, res as any, next);

      expect(prisma.payment.create).toHaveBeenCalled();
      expect(prisma.invoice.update).toHaveBeenCalled();
      expect(enqueueWebhook).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        paymentId: 'payment-1',
        invoiceId: '00000000-0000-0000-0000-000000000000',
        status: 'confirmed',
      });
    });

    it('calls next on error', async () => {
      req.body = {
        // missing required fields to cause validation error
      };

      await confirmPayment(req as any, res as any, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getPayments', () => {
    it('returns a paginated list of payments', async () => {
      req.query = { page: 1 as any, limit: 10 as any, sortBy: 'timestamp', sortOrder: 'desc' };
      const payments = [{ id: 'payment-1' }];
      
      (prisma.payment.findMany as jest.Mock).mockResolvedValue(payments);
      (prisma.payment.count as jest.Mock).mockResolvedValue(1);

      await getPayments(req as any, res as any, next);

      expect(prisma.payment.findMany).toHaveBeenCalled();
      expect(prisma.payment.count).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it('calls next on error', async () => {
      req.query = { page: 1 as any, limit: 10 as any, sortBy: 'timestamp', sortOrder: 'desc' };
      (prisma.payment.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await getPayments(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getPaymentDetails', () => {
    it('returns payment details', async () => {
      req.params = { id: 'payment-1' };
      const mockPayment = {
        id: 'payment-1',
        merchantId: '00000000-0000-0000-0000-000000000001',
        chainKey: 'ethereum',
        txHash: '0x123',
        fromAddress: '0xfrom',
        toAddress: '0xto',
        amount: '1.0',
        tokenSymbol: 'ETH',
        privacyLevel: 'standard',
        status: 'confirmed',
        timestamp: new Date(),
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);

      await getPaymentDetails(req as any, res as any, next);

      expect(prisma.payment.findUnique).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        id: 'payment-1',
      }));
    });

    it('returns 404 if payment not found', async () => {
      req.params = { id: 'payment-1' };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

      await getPaymentDetails(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Payment not found' });
    });

    it('returns 403 if merchantId does not match', async () => {
      req.params = { id: 'payment-1' };
      const mockPayment = {
        id: 'payment-1',
        merchantId: 'other-merchant',
      };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);

      await getPaymentDetails(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    });

    it('calls next on error', async () => {
      req.params = { id: 'payment-1' };
      (prisma.payment.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await getPaymentDetails(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
