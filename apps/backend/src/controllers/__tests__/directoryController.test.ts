import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { getPublicMerchant } from '../directoryController';
import { uuidParamSchema } from '../../types';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    merchant: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../types', () => ({
  uuidParamSchema: { parse: jest.fn((val) => val) },
}));

describe('directoryController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe('getPublicMerchant', () => {
    it('returns a public merchant if active', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      const mockMerchant = {
        id: '00000000-0000-0000-0000-000000000000',
        businessName: 'Test Business',
        status: 'active',
        viewingKeys: [
          { chainKey: 'ethereum', viewingKey: '0xabc' },
        ],
      };
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue(mockMerchant);

      await getPublicMerchant(req as any, res as any, next);

      expect(prisma.merchant.findUnique).toHaveBeenCalledWith({
        where: { id: req.params.id },
        include: { viewingKeys: true },
      });
      expect(res.json).toHaveBeenCalledWith({
        id: mockMerchant.id,
        businessName: mockMerchant.businessName,
        status: mockMerchant.status,
        viewingKeys: [
          { chainKey: 'ethereum', viewingKey: '0xabc' },
        ],
      });
    });

    it('returns 404 if merchant not found', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue(null);

      await getPublicMerchant(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Merchant not found' });
    });

    it('returns 403 if merchant is not active', async () => {
      req.params = { id: '00000000-0000-0000-0000-000000000000' };
      const mockMerchant = {
        id: '00000000-0000-0000-0000-000000000000',
        businessName: 'Test Business',
        status: 'suspended',
        viewingKeys: [],
      };
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue(mockMerchant);

      await getPublicMerchant(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Merchant is not active' });
    });

    it('calls next on error', async () => {
      req.params = { id: 'invalid-id' };
      const error = new Error('Database error');
      (prisma.merchant.findUnique as jest.Mock).mockRejectedValue(error);

      await getPublicMerchant(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
