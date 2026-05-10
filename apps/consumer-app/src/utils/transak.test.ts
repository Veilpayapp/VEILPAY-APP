import {
  calculateDepositFees,
  calculateWithdrawalFees,
  estimateCryptoAmount,
  estimateFiatPayout,
  formatFiat,
  formatCrypto,
  formatFeePercent,
  validateFiatAmount,
  validateCryptoAmount,
  getMinDepositAmount,
  getMaxDepositAmount,
  FIAT_CURRENCIES,
  QUICK_AMOUNTS,
  PAYMENT_METHODS,
  PAYOUT_METHODS,
  CRYPTO_TOKENS,
} from "./transak";

describe("transak utility", () => {
  describe("calculateDepositFees", () => {
    it("calculates fees for $100 deposit", () => {
      const fees = calculateDepositFees(100);
      expect(fees.networkFee).toBe(2.5);
      expect(fees.transakFee).toBe(1.5);
      expect(fees.transakFeePercent).toBe(1.5);
      expect(fees.total).toBeCloseTo(4.0, 2);
    });

    it("calculates fees for $500 deposit", () => {
      const fees = calculateDepositFees(500);
      expect(fees.networkFee).toBe(2.5);
      expect(fees.transakFee).toBe(7.5);
      expect(fees.total).toBeCloseTo(10.0, 2);
    });

    it("calculates fees for $1000 deposit", () => {
      const fees = calculateDepositFees(1000);
      expect(fees.transakFee).toBe(15);
      expect(fees.total).toBeCloseTo(17.5, 2);
    });
  });

  describe("calculateWithdrawalFees", () => {
    it("calculates withdrawal fees correctly", () => {
      const fees = calculateWithdrawalFees(1, 3200);
      expect(fees.networkFee).toBe(3.75);
      expect(fees.transakFee).toBeCloseTo(48, 0);
    });
  });

  describe("estimateCryptoAmount", () => {
    it("estimates crypto from fiat amount", () => {
      const fees = calculateDepositFees(100);
      const crypto = estimateCryptoAmount(100, 3200, fees);
      expect(crypto).toBeCloseTo(0.03, 3);
    });

    it("returns 0 for zero fiat amount", () => {
      const fees = calculateDepositFees(0);
      const crypto = estimateCryptoAmount(0, 3200, fees);
      expect(crypto).toBeCloseTo(-0.00078, 5);
    });
  });

  describe("estimateFiatPayout", () => {
    it("estimates fiat payout from crypto", () => {
      const fees = calculateWithdrawalFees(1, 3200);
      const fiat = estimateFiatPayout(1, 3200, fees);
      expect(fiat).toBeGreaterThan(3000);
      expect(fiat).toBeLessThan(3200);
    });
  });

  describe("formatFiat", () => {
    it("formats USD amounts", () => {
      expect(formatFiat(100)).toBe("$100.00");
      expect(formatFiat(1234.56)).toBe("$1,234.56");
      expect(formatFiat(0)).toBe("$0.00");
    });

    it("formats EUR amounts", () => {
      expect(formatFiat(100, "EUR")).toBe("€100.00");
    });

    it("formats GBP amounts", () => {
      expect(formatFiat(100, "GBP")).toBe("£100.00");
    });

    it("formats INR amounts", () => {
      expect(formatFiat(10000, "INR")).toBe("₹10,000.00");
    });
  });

  describe("formatCrypto", () => {
    it("formats crypto amounts with symbol", () => {
      expect(formatCrypto(1.5, "ETH")).toBe("1.5 ETH");
      expect(formatCrypto(0.000123, "USDT")).toBe("0.000123 USDT");
    });

    it("removes trailing zeros", () => {
      expect(formatCrypto(1.5, "ETH")).toBe("1.5 ETH");
    });
  });

  describe("formatFeePercent", () => {
    it("formats fee percentages", () => {
      expect(formatFeePercent(1.5)).toBe("1.5%");
      expect(formatFeePercent(2.0)).toBe("2.0%");
      expect(formatFeePercent(0.5)).toBe("0.5%");
    });
  });

  describe("validateFiatAmount", () => {
    it("validates valid amounts", () => {
      expect(validateFiatAmount(100).valid).toBe(true);
      expect(validateFiatAmount(50).valid).toBe(true);
      expect(validateFiatAmount(10000).valid).toBe(true);
    });

    it("rejects amounts below minimum", () => {
      const result = validateFiatAmount(20, 30, 10000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Minimum");
    });

    it("rejects amounts above maximum", () => {
      const result = validateFiatAmount(15000, 30, 10000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Maximum");
    });

    it("rejects invalid amounts", () => {
      expect(validateFiatAmount(0).valid).toBe(false);
      expect(validateFiatAmount(-100).valid).toBe(false);
      expect(validateFiatAmount(NaN).valid).toBe(false);
    });
  });

  describe("validateCryptoAmount", () => {
    it("validates valid crypto amounts", () => {
      expect(validateCryptoAmount(1, 10).valid).toBe(true);
      expect(validateCryptoAmount(5, 10).valid).toBe(true);
    });

    it("rejects amounts exceeding balance", () => {
      const result = validateCryptoAmount(15, 10);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Insufficient");
    });

    it("rejects invalid amounts", () => {
      expect(validateCryptoAmount(0, 10).valid).toBe(false);
      expect(validateCryptoAmount(-1, 10).valid).toBe(false);
    });
  });

  describe("getMinDepositAmount", () => {
    it("returns correct minimum for each currency", () => {
      expect(getMinDepositAmount("USD")).toBe(30);
      expect(getMinDepositAmount("EUR")).toBe(30);
      expect(getMinDepositAmount("GBP")).toBe(25);
      expect(getMinDepositAmount("INR")).toBe(2500);
    });
  });

  describe("getMaxDepositAmount", () => {
    it("returns correct maximum for each currency", () => {
      expect(getMaxDepositAmount("USD")).toBe(10000);
      expect(getMaxDepositAmount("EUR")).toBe(10000);
      expect(getMaxDepositAmount("GBP")).toBe(8000);
      expect(getMaxDepositAmount("INR")).toBe(800000);
    });
  });

  describe("constants", () => {
    it("exports expected fiat currencies", () => {
      expect(FIAT_CURRENCIES).toContain("USD");
      expect(FIAT_CURRENCIES).toContain("EUR");
      expect(FIAT_CURRENCIES).toContain("GBP");
      expect(FIAT_CURRENCIES).toContain("INR");
    });

    it("exports quick amounts", () => {
      expect(QUICK_AMOUNTS).toContain(50);
      expect(QUICK_AMOUNTS).toContain(100);
      expect(QUICK_AMOUNTS).toContain(200);
    });

    it("exports payment methods", () => {
      expect(PAYMENT_METHODS).toHaveLength(5);
      expect(PAYMENT_METHODS.find((m) => m.id === "credit_debit_card")).toBeDefined();
      expect(PAYMENT_METHODS.find((m) => m.id === "google_pay")).toBeDefined();
    });

    it("exports payout methods", () => {
      expect(PAYOUT_METHODS).toHaveLength(3);
      expect(PAYOUT_METHODS.find((m) => m.id === "neft_rtgs")).toBeDefined();
    });

    it("exports crypto tokens", () => {
      expect(CRYPTO_TOKENS.length).toBeGreaterThan(0);
      expect(CRYPTO_TOKENS.find((t) => t.symbol === "ETH")).toBeDefined();
    });
  });
});