import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { confirmInvoicePayment } from '../../services/paymentProcessor';
import { verifyPaymentTxOnChain } from '../../services/paymentTxVerifier';
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
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../services/paymentProcessor', () => ({
  confirmInvoicePayment: jest.fn(),
}));

jest.mock('../../services/paymentTxVerifier', () => ({
  verifyPaymentTxOnChain: jest.fn(),
}));

jest.mock('../../types', () => ({
  PaymentListQuerySchema: { parse: jest.fn((val) => val) },
  PaymentListResponseSchema: { parse: jest.fn((val) => val) },
  uuidParamSchema: { parse: jest.fn((val) => val) },
}));

const MERCHANT_ID = '00000000-0000-0000-0000-000000000001';
const INVOICE_ID = '00000000-0000-0000-0000-000000000000';
const PAY_TO = '0xPaymentAddress000000000000000000000001';

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    merchantId: MERCHANT_ID,
    chainKey: 'ethereum',
    tokenSymbol: 'ETH',
    amount: '1.0',
    privacyLevel: 'standard',
    status: 'pending',
    paymentAddress: PAY_TO,
    ...overrides,
  };
}

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: INVOICE_ID,
    chainKey: 'ethereum',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    fromAddress: '0xfrom',
    toAddress: PAY_TO,
    amount: '1.0',
    tokenSymbol: 'ETH',
    privacyLevel: 'standard',
    ...overrides,
  };
}

function mockVerifyOk(overrides: Record<string, unknown> = {}) {
  (verifyPaymentTxOnChain as jest.Mock).mockResolvedValue({
    ok: true,
    tx: {
      txHash: makeBody().txHash,
      fromAddress: '0xfrom',
      toAddress: PAY_TO,
      amount: '1.0',
      tokenSymbol: 'ETH',
      blockNumber: 100,
      ...overrides,
    },
  });
}

describe('paymentController', () => {
  let req: Partial<Request> & { merchantId?: string };
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyOk();
    req = {
      merchantId: MERCHANT_ID,
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

  describe('confirmPayment (SEC-001: auth-gated, transactional, idempotent)', () => {
    it('rejects unauthenticated callers (no merchantId) with 401', async () => {
      req.merchantId = undefined;
      req.body = makeBody();

      await confirmPayment(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(confirmInvoicePayment).not.toHaveBeenCalled();
      expect(verifyPaymentTxOnChain).not.toHaveBeenCalled();
    });

    it('returns 404 when the invoice does not exist', async () => {
      req.body = makeBody();
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

      await confirmPayment(req as any, res as any, next);

      expect(prisma.invoice.findUnique).toHaveBeenCalledWith({ where: { id: INVOICE_ID } });
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invoice not found' });
      expect(confirmInvoicePayment).not.toHaveBeenCalled();
      expect(verifyPaymentTxOnChain).not.toHaveBeenCalled();
    });

    it('returns 404 (not 403) when the invoice belongs to another merchant', async () => {
      // 404 instead of 403 prevents leaking which invoices exist for other merchants.
      req.body = makeBody();
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(
        makeInvoice({ merchantId: '00000000-0000-0000-0000-000000000099' })
      );

      await confirmPayment(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invoice not found' });
      expect(confirmInvoicePayment).not.toHaveBeenCalled();
    });

    it('returns 409 when the invoice is not pending', async () => {
      req.body = makeBody();
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(
        makeInvoice({ status: 'paid' })
      );

      await confirmPayment(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invoice is paid, not pending' });
      expect(confirmInvoicePayment).not.toHaveBeenCalled();
    });

    it('returns 400 when chainKey does not match the invoice', async () => {
      req.body = makeBody({ chainKey: 'solana' });
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(
        makeInvoice({ chainKey: 'ethereum' })
      );

      await confirmPayment(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'chainKey does not match invoice' });
      expect(confirmInvoicePayment).not.toHaveBeenCalled();
    });

    it('returns 400 when on-chain verify rejects a fake txHash (SEC-001 residual)', async () => {
      req.body = makeBody();
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice());
      (verifyPaymentTxOnChain as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        error: 'Transaction failed or not found on-chain',
      });

      await confirmPayment(req as any, res as any, next);

      expect(verifyPaymentTxOnChain).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Transaction failed or not found on-chain',
      });
      expect(confirmInvoicePayment).not.toHaveBeenCalled();
    });

    it('creates a payment on the happy path and returns 201', async () => {
      req.body = makeBody();
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice());
      (confirmInvoicePayment as jest.Mock).mockResolvedValue({
        kind: 'created',
        paymentId: 'payment-1',
        paidAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      await confirmPayment(req as any, res as any, next);

      expect(verifyPaymentTxOnChain).toHaveBeenCalledTimes(1);
      expect(confirmInvoicePayment).toHaveBeenCalledTimes(1);
      // The merchantId passed to the helper MUST come from auth, not the body.
      expect((confirmInvoicePayment as jest.Mock).mock.calls[0][0].merchantId).toBe(MERCHANT_ID);
      // Payment row uses verified chain facts, not raw body alone.
      expect((confirmInvoicePayment as jest.Mock).mock.calls[0][1]).toEqual(
        expect.objectContaining({
          txHash: makeBody().txHash,
          toAddress: PAY_TO,
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        paymentId: 'payment-1',
        invoiceId: INVOICE_ID,
        status: 'confirmed',
        paidAt: '2026-03-01T00:00:00.000Z',
      });
    });

    it('returns 200 with idempotent: true on a duplicate txHash', async () => {
      req.body = makeBody();
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice());
      (confirmInvoicePayment as jest.Mock).mockResolvedValue({
        kind: 'idempotent',
        paymentId: 'payment-1',
        paidAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      await confirmPayment(req as any, res as any, next);

      expect(confirmInvoicePayment).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        paymentId: 'payment-1',
        invoiceId: INVOICE_ID,
        status: 'confirmed',
        idempotent: true,
        paidAt: '2026-03-01T00:00:00.000Z',
      });
    });

    it('calls next on schema validation error', async () => {
      req.body = {}; // missing required fields

      await confirmPayment(req as any, res as any, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(confirmInvoicePayment).not.toHaveBeenCalled();
    });

    it('does not accept merchantId from the body (SEC-001: caller cannot target another merchant)', async () => {
      // The schema strips merchantId; even if sent, the controller uses req.merchantId.
      req.body = makeBody({ merchantId: '00000000-0000-0000-0000-000000000099' });
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice());
      (confirmInvoicePayment as jest.Mock).mockResolvedValue({
        kind: 'created',
        paymentId: 'payment-1',
        paidAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      await confirmPayment(req as any, res as any, next);

      expect((confirmInvoicePayment as jest.Mock).mock.calls[0][0].merchantId).toBe(MERCHANT_ID);
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
        merchantId: MERCHANT_ID,
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
