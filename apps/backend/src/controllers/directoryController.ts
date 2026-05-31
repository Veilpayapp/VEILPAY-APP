import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { uuidParamSchema } from "../types";

export const getPublicMerchant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = uuidParamSchema.parse(req.params);

    const merchant = await prisma.merchant.findUnique({
      where: { id },
      include: { viewingKeys: true },
    });

    if (!merchant) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }

    if (merchant.status !== "active") {
      res.status(403).json({ error: "Merchant is not active" });
      return;
    }

    res.json({
      id: merchant.id,
      businessName: merchant.businessName,
      status: merchant.status,
      viewingKeys: merchant.viewingKeys.map((k) => ({
        chainKey: k.chainKey,
        viewingKey: k.viewingKey,
      })),
    });
  } catch (error) {
    next(error);
  }
};
