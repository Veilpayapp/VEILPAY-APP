import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { uuidParamSchema } from "../types";

/**
 * Public merchant directory (SEC-001).
 *
 * This endpoint is intentionally UNAUTHENTICATED. The `viewingKey` it returns
 * is PUBLIC key material — the recipient's viewing/encryption public key that
 * senders need to derive stealth addresses (secp256k1 ECDH) and encrypt memos.
 * Publishing it is the whole point of a payment directory; it is analogous to
 * publishing an address or a public key and confers no spend or scan authority.
 *
 * The private counterparts (viewing/spending private keys, Stellar `S…` seeds)
 * are NEVER stored here: `merchantController.publishKey` validates on write that
 * only well-formed public keys can be persisted (`utils/publicKey`).
 */
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
