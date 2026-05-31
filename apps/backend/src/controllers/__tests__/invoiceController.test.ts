import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import {
  getInvoices,
  createInvoice,
  getInvoiceStatus,
  getInvoiceDetails,
  cancelInvoice,
  payInvoice
} from '../invoiceController';
import {
  CreateInvoiceRequestSchema,
  CreateInvoiceResponseSchema,
  InvoiceStatusResponseSchema,
  InvoiceDetailResponseSchema,
  InvoiceListQuerySchema,
  InvoiceListResponseSchema,
  uuidParamSchema,
  PayInvoiceRequestSchema,
} from '../../types';
import { enqueueWebhook } from '../../jobs/webhookQueue';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    invoice: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    chainViewingKey: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../types', () => ({
  CreateInvoiceRequestSchema: { parse: jest.fn((val) => val) },
  CreateInvoiceResponseSchema: { parse: jest.fn((val) => val) },
  InvoiceStatusResponseSchema: { parse: jest.fn((val) => val) },
  InvoiceDetailResponseSchema: { parse: jest.fn((val) => val) },
  InvoiceListQuerySchema: { parse: jest.fn((val) => val) },
  InvoiceListResponseSchema: { parse: jest.fn((val) => val) },
  uuidParamSchema: { parse: jest.fn((val) => val) },
  PayInvoiceRequestSchema: { parse: jest.fn((val) => val) },
}));

jest.mock('../../jobs/webhookQueue', () => ({
  enqueueWebhook: jest.fn(),
}));

jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    getTransaction: jest.fn().mockResolvedValue({
      to: '0x1234567890123456789012345678901234567890',
      value: 1000000000000000000n, // 1 ether
    }),
    getTransactionReceipt: jest.fn().mockResolvedValue({
      status: 'success',
    }),
  })),
  http: jest.fn(),
  parseEther: jest.fn().mockReturnValue(1000000000000000000n),
}));

jest.mock('viem/chains', () => ({
  mainnet: {},
  polygon: {},
  arbitrum: {},
  sepolia: {},
}));

describe('invoiceController', () => {
  let req: Partial<Request> & { merchantId?: string };
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      merchantId: 'merchant-1',
      query: {},
      params: {},
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn((err) => {
      if (err) console.error('Next called with error:', err);
    });
  });

  describe('getInvoices', () => {
    it('returns a list of invoices', async () => {
      req.query = { page: 1 as any, limit: 10 as any, sortBy: 'createdAt', sortOrder: 'desc' };
      const invoices = [{ id: 'invoice-1' }];
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue(invoices);
      (prisma.invoice.count as jest.Mock).mockResolvedValue(1);

      await getInvoices(req as any, res as any, next);

      expect(prisma.invoice.findMany).toHaveBeenCalled();
      expect(prisma.invoice.count).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        invoices,
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });
    });

    it('handles query parameters and catches errors', async () => {
      req.query = { page: '1', limit: '10', status: 'pending', chainKey: 'ethereum' };
      (prisma.invoice.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await getInvoices(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('createInvoice', () => {
    it('creates an invoice and returns 201', async () => {
      req.body = {
        merchantId: 'merchant-1',
        chainKey: 'ethereum',
        tokenSymbol: 'ETH',
        amount: '1.0',
        expiresInMinutes: 60,
        privacyLevel: 'standard',
      };
      
      (prisma.chainViewingKey.findUnique as jest.Mock).mockResolvedValue({
        settlementAddress: '0x123',
      });
      
      const invoiceData = {
        id: 'invoice-1',
        merchantId: 'merchant-1',
        chainKey: 'ethereum',
        tokenSymbol: 'ETH',
        amount: '1.0',
        status: 'pending',
        privacyLevel: 'standard',
        paymentAddress: '0x123',
        expiresAt: new Date(),
      };
      (prisma.invoice.create as jest.Mock).mockResolvedValue(invoiceData);

      await createInvoice(req as any, res as any, next);

      expect(prisma.chainViewingKey.findUnique).toHaveBeenCalled();
      expect(prisma.invoice.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: 'invoice-1' }));
    });

    it('returns 403 if merchantId does not match', async () => {
      req.body = {
        merchantId: 'other-merchant',
      };

      await createInvoice(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 if viewing key not found', async () => {
      req.body = {
        merchantId: 'merchant-1',
        chainKey: 'ethereum',
        tokenSymbol: 'ETH',
        amount: '1.0',
        expiresInMinutes: 60,
        privacyLevel: 'standard',
      };
      
      (prisma.chainViewingKey.findUnique as jest.Mock).mockResolvedValue(null);

      await createInvoice(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe('getInvoiceStatus', () => {
    it('returns invoice status', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000000',
        status: 'pending',
        expiresAt: new Date(),
      });

      await getInvoiceStatus(req as any, res as any, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('returns 404 if not found', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

      await getInvoiceStatus(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('getInvoiceDetails', () => {
    it('returns invoice details', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000000',
        merchantId: 'merchant-1',
        status: 'pending',
        chainKey: 'ethereum',
        tokenSymbol: 'ETH',
        amount: '1.0',
        privacyLevel: 'standard',
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      await getInvoiceDetails(req as any, res as any, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('returns 404 if not found', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

      await getInvoiceDetails(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 if merchantId mismatch', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        merchantId: 'other-merchant',
      });

      await getInvoiceDetails(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('cancelInvoice', () => {
    it('cancels pending invoice', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000000',
        merchantId: 'merchant-1',
        status: 'pending',
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000000',
        merchantId: 'merchant-1',
        status: 'cancelled',
        chainKey: 'ethereum',
        tokenSymbol: 'ETH',
        amount: '1.0',
        privacyLevel: 'standard',
        expiresAt: new Date(),
      });

      await cancelInvoice(req as any, res as any, next);

      expect(prisma.invoice.update).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it('returns 404 if not found', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);
      await cancelInvoice(req as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 if merchantId mismatch', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ merchantId: 'other' });
      await cancelInvoice(req as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 if not pending', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ merchantId: 'merchant-1', status: 'paid' });
      await cancelInvoice(req as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe('payInvoice', () => {
    it('pays pending invoice with valid txHash', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      req.body = { txHash: '0x1234567890123456789012345678901234567890' };
      
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000000',
        merchantId: 'merchant-1',
        status: 'pending',
        chainKey: 'ethereum',
        paymentAddress: '0x1234567890123456789012345678901234567890',
        amount: '1.0',
        merchant: { id: 'merchant-1' }
      });
      
      (prisma.invoice.update as jest.Mock).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000000',
        status: 'paid',
        paidAt: new Date(),
        chainKey: 'ethereum',
        tokenSymbol: 'ETH',
        amount: '1.0',
        privacyLevel: 'standard',
      });

      await payInvoice(req as any, res as any, next);

      expect(prisma.invoice.update).toHaveBeenCalled();
      expect(enqueueWebhook).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it('returns 404 if not found', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      req.body = { txHash: '0x123' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);
      await payInvoice(req as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 if merchantId mismatch', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      req.body = { txHash: '0x123' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ merchantId: 'other' });
      await payInvoice(req as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 if not pending', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      req.body = { txHash: '0x123' };
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ merchantId: 'merchant-1', status: 'cancelled' });
      await payInvoice(req as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });
});
