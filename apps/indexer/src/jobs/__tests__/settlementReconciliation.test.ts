import {
  isEvmAddress,
  isAddressShapedTxHash,
  normalizeDecimalString,
  amountsEqual,
  resolveTokenMetadataForPayment,
  detectBaseUnitAmount,
  scanSettlements,
  runSettlementReconciliation,
  MIN_BASE_UNIT_DIGITS,
  type ScannedPayment,
  type ScannedInvoice,
} from '../settlementReconciliation';
import { prisma } from '../../lib/prisma';

const USDC_MAINNET = '0xA0b86991c6218b36c1D19D4a2e9EB0cE3606eB48'.toLowerCase();
const TX_HASH = '0x' + 'ab'.repeat(32); // 64-hex EVM tx hash
const TO_ADDRESS = '0x' + 'cd'.repeat(20); // 42-hex EVM address
const PAID_AT = new Date('2026-09-01T12:00:00Z');

function diseasePayment(overrides: Partial<ScannedPayment> = {}): ScannedPayment {
  return {
    id: 'pay-1',
    invoiceId: 'inv-1',
    merchantId: 'm-1',
    chainKey: 'ethereum',
    txHash: TX_HASH,
    toAddress: TO_ADDRESS,
    // 1000 USDC in base units (6 decimals)
    amount: '1000000000',
    tokenSymbol: USDC_MAINNET, // the disease: address in the symbol column
    status: 'confirmed',
    timestamp: PAID_AT,
    ...overrides,
  };
}

function diseaseInvoice(overrides: Partial<ScannedInvoice> = {}): ScannedInvoice {
  return {
    id: 'inv-1',
    merchantId: 'm-1',
    chainKey: 'ethereum',
    tokenSymbol: 'USDC',
    tokenAddress: null,
    amount: '1000',
    status: 'pending',
    paymentTxHash: TO_ADDRESS, // the disease: to-address in the txHash column
    ...overrides,
  };
}

function seedDb(payments: ScannedPayment[], invoices: ScannedInvoice[]): void {
  (prisma.payment.findMany as jest.Mock).mockResolvedValue(payments);
  (prisma.invoice.findMany as jest.Mock).mockResolvedValue(invoices);
  (prisma.payment.update as jest.Mock).mockResolvedValue({});
  (prisma.invoice.update as jest.Mock).mockResolvedValue({});
  (prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
}

describe('shape helpers', () => {
  it('isEvmAddress matches 42-hex and rejects symbols and tx hashes', () => {
    expect(isEvmAddress(TO_ADDRESS)).toBe(true);
    expect(isEvmAddress(USDC_MAINNET)).toBe(true);
    expect(isEvmAddress('USDC')).toBe(false);
    expect(isEvmAddress(TX_HASH)).toBe(false);
    expect(isEvmAddress(null)).toBe(false);
    expect(isEvmAddress(undefined)).toBe(false);
  });

  it('isAddressShapedTxHash flags only clear address shapes (conservative)', () => {
    // EVM: address (42-hex) yes, tx hash (64-hex) no
    expect(isAddressShapedTxHash(TO_ADDRESS)).toBe(true);
    expect(isAddressShapedTxHash(TX_HASH)).toBe(false);
    // Solana: base58 address (~44 chars) yes, signature (~88 chars) no
    expect(isAddressShapedTxHash('9WzDXwBbmkg8ZTbNMqJx8W2KEXjTUPsM' + 'A'.repeat(10))).toBe(true);
    const solanaSignature = '9WzDXwBbmkg8ZTbNMqJx8W2KEXjTUPsMA' + 'b'.repeat(55);
    expect(isAddressShapedTxHash(solanaSignature)).toBe(false);
    // stealth payment txHashes (stealth-<uuid>) are not address-shaped
    expect(isAddressShapedTxHash('stealth-1b4f2e5c-aaaa-bbbb-cccc-ddddeeeeffff')).toBe(false);
    // Stellar 64-hex hashes are not flagged
    expect(isAddressShapedTxHash('a'.repeat(64))).toBe(false);
    expect(isAddressShapedTxHash(null)).toBe(false);
  });

  it('normalizeDecimalString / amountsEqual give formatting tolerance', () => {
    expect(normalizeDecimalString('1000')).toBe('1000');
    expect(normalizeDecimalString('1000.0')).toBe('1000');
    expect(normalizeDecimalString('01000.00')).toBe('1000');
    expect(normalizeDecimalString('1.500')).toBe('1.5');
    expect(normalizeDecimalString('0')).toBe('0');
    expect(amountsEqual('1000', '1000.0')).toBe(true);
    expect(amountsEqual('1000', '999')).toBe(false);
    expect(amountsEqual('1.5', '1.500000')).toBe(true);
    expect(amountsEqual(null, '1')).toBe(false);
  });
});

describe('resolveTokenMetadataForPayment', () => {
  it('uses the payment tokenSymbol-as-address as the registry key', () => {
    const resolved = resolveTokenMetadataForPayment('ethereum', USDC_MAINNET, null);
    expect(resolved.symbol).toBe('USDC');
    expect(resolved.decimals).toBe(6);
    expect(resolved.source).toBe('payment-symbol-registry');
  });

  it('falls back to the invoice tokenAddress, then the chain native asset', () => {
    expect(resolveTokenMetadataForPayment('ethereum', 'USDC', USDC_MAINNET).source).toBe(
      'invoice-token-registry'
    );
    const native = resolveTokenMetadataForPayment('ethereum', 'ETH', null);
    expect(native.decimals).toBe(18);
    expect(native.source).toBe('chain-native');
  });
});

describe('detectBaseUnitAmount', () => {
  it('detects the disease: long integer whose conversion matches the invoice', () => {
    const check = detectBaseUnitAmount('1000000000', '1000', 6);
    expect(check.isLongInteger).toBe(true);
    expect(check.converted).toBe('1000');
    expect(check.matchesInvoice).toBe(true);
    expect(check.isBaseUnitsDisease).toBe(true);
  });

  it('tolerates invoice formatting differences', () => {
    expect(detectBaseUnitAmount('1000000000', '1000.0', 6).isBaseUnitsDisease).toBe(true);
  });

  it('rejects an already-human amount that merely looks long', () => {
    // human 13-digit amount whose conversion does NOT match the invoice
    const check = detectBaseUnitAmount('1000000000000', '1000000000000', 6);
    expect(check.isLongInteger).toBe(true);
    expect(check.matchesInvoice).toBe(false);
    expect(check.isBaseUnitsDisease).toBe(false);
  });

  it('rejects short integers and non-integers', () => {
    expect(detectBaseUnitAmount('1000', '1000', 6).isLongInteger).toBe(false);
    expect(detectBaseUnitAmount('1000.5', '1000.5', 6).isLongInteger).toBe(false);
  });

  it(`requires at least ${MIN_BASE_UNIT_DIGITS} digits`, () => {
    // 6 digits — below the threshold even though the conversion would match
    expect(detectBaseUnitAmount('100000', '0.1', 6).isBaseUnitsDisease).toBe(false);
    // sanity: the same row WITH enough digits is the disease
    expect(detectBaseUnitAmount('1000000', '1', 6).isBaseUnitsDisease).toBe(true);
  });
});

describe('scanSettlements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedDb([], []);
  });

  it('flags all four disease classes for a corrupt payment+invoice pair', async () => {
    seedDb([diseasePayment()], [diseaseInvoice()]);

    const result = await scanSettlements();

    expect(result.scannedPayments).toBe(1);
    expect(result.scannedInvoices).toBe(1);
    const kinds = result.findings.map((f) => f.kind).sort();
    expect(kinds).toEqual([
      'invoice-payment-tx-hash-is-address',
      'invoice-stuck-pending',
      'payment-amount-base-units',
      'payment-token-symbol-is-address',
    ]);

    const amountFinding = result.findings.find((f) => f.kind === 'payment-amount-base-units');
    expect(amountFinding?.paymentPatch).toEqual({ amount: '1000' });
    const symbolFinding = result.findings.find((f) => f.kind === 'payment-token-symbol-is-address');
    expect(symbolFinding?.paymentPatch).toEqual({ tokenSymbol: 'USDC' });
    const txHashFinding = result.findings.find((f) => f.kind === 'invoice-payment-tx-hash-is-address');
    expect(txHashFinding?.invoicePatch).toEqual({ paymentTxHash: TX_HASH });
    const pendingFinding = result.findings.find((f) => f.kind === 'invoice-stuck-pending');
    expect(pendingFinding?.invoicePatch).toEqual({ status: 'paid', paidAt: PAID_AT });
  });

  it('reports orphan payments whose invoice is missing', async () => {
    seedDb([diseasePayment({ invoiceId: 'inv-missing' })], []);

    const result = await scanSettlements();
    expect(result.orphanPayments).toEqual([{ paymentId: 'pay-1', invoiceId: 'inv-missing' }]);
  });

  it('flags a stuck-pending invoice even when the payment amount is already human', async () => {
    seedDb(
      [diseasePayment({ amount: '1000', tokenSymbol: 'USDC' })],
      [diseaseInvoice({ paymentTxHash: TX_HASH })]
    );

    const result = await scanSettlements();
    expect(result.findings.map((f) => f.kind)).toEqual(['invoice-stuck-pending']);
  });

  it('does not flag a settled, healthy pair', async () => {
    seedDb(
      [diseasePayment({ amount: '1000', tokenSymbol: 'USDC' })],
      [diseaseInvoice({ status: 'paid', paymentTxHash: TX_HASH })]
    );

    const result = await scanSettlements();
    expect(result.findings).toEqual([]);
    expect(result.orphanPayments).toEqual([]);
  });

  it('does not flip a pending invoice on an unconfirmed payment', async () => {
    seedDb(
      [diseasePayment({ amount: '1000', tokenSymbol: 'USDC', status: 'pending' })],
      [diseaseInvoice()]
    );

    const result = await scanSettlements();
    expect(result.findings.map((f) => f.kind)).toEqual([
      'invoice-payment-tx-hash-is-address',
    ]);
  });

  it('skips the amount disease when the conversion does not match the invoice', async () => {
    seedDb([diseasePayment()], [diseaseInvoice({ amount: '999' })]);

    const result = await scanSettlements();
    expect(result.findings.map((f) => f.kind)).not.toContain('payment-amount-base-units');
    // the stuck-pending match also required the conversion — only the
    // symbol + txHash diseases remain
    expect(result.findings.map((f) => f.kind).sort()).toEqual([
      'invoice-payment-tx-hash-is-address',
      'payment-token-symbol-is-address',
    ]);
  });

  it('does not query invoices when no payment has an invoiceId', async () => {
    seedDb([diseasePayment({ invoiceId: null })], []);

    await scanSettlements();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe('runSettlementReconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedDb([diseasePayment()], [diseaseInvoice()]);
  });

  it('is DRY-RUN by default: reports findings but writes NOTHING', async () => {
    const report = await runSettlementReconciliation();

    expect(report.dryRun).toBe(true);
    expect(report.applied).toBeNull();
    expect(report.findings.length).toBe(4);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it('DRY-RUN makes no writes even with an explicit apply=false', async () => {
    const report = await runSettlementReconciliation({ apply: false });
    expect(report.dryRun).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('--apply repairs the payment (amount + symbol) and NEVER rewrites txHash', async () => {
    const report = await runSettlementReconciliation({ apply: true });

    expect(report.dryRun).toBe(false);
    expect(report.applied).toEqual({ paymentsUpdated: 1, invoicesUpdated: 1 });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.update).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { amount: '1000', tokenSymbol: 'USDC' },
    });
    // the @@unique([chainKey, txHash]) column is never touched
    const updateCall = (prisma.payment.update as jest.Mock).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).not.toHaveProperty('txHash');
    expect(updateCall.data).not.toHaveProperty('chainKey');
  });

  it('--apply CAS-flips the pending invoice to paid with the real txHash', async () => {
    await runSettlementReconciliation({ apply: true });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'pending' },
      data: { status: 'paid', paidAt: PAID_AT, paymentTxHash: TX_HASH },
    });
  });

  it('--apply uses a plain update when the invoice is NOT the stuck-pending case', async () => {
    // invoice already paid but still carries the address-shaped txHash
    seedDb([diseasePayment({ amount: '1000', tokenSymbol: 'USDC' })], [
      diseaseInvoice({ status: 'paid', paymentTxHash: TO_ADDRESS }),
    ]);

    const report = await runSettlementReconciliation({ apply: true });

    expect(report.applied).toEqual({ paymentsUpdated: 0, invoicesUpdated: 1 });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { paymentTxHash: TX_HASH },
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it('--apply counts 0 flipped invoices when the CAS updateMany matches nothing', async () => {
    (prisma.invoice.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    const report = await runSettlementReconciliation({ apply: true });
    expect(report.applied).toEqual({ paymentsUpdated: 1, invoicesUpdated: 0 });
  });

  it('--apply writes nothing when there are no findings', async () => {
    seedDb([], []);

    const report = await runSettlementReconciliation({ apply: true });

    expect(report.applied).toEqual({ paymentsUpdated: 0, invoicesUpdated: 0 });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });
});
