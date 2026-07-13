// SEC-013: relayer-side per-withdraw amount cap (RELAYER_MAX_WITHDRAW_AMOUNT).
//
// The relayer rejects a schema-valid, allowlisted withdraw whose `amount`
// exceeds the configured ceiling with HTTP 400 { code: 'AMOUNT_EXCEEDS_CAP' }
// and makes ZERO pool calls (no simulation, no broadcast, no gas). A request
// at or under the cap flows through to the (mocked) pool as before.
//
// Architecture mirrors relayerController.validation.property.test.ts:
//   1. Env — including RELAYER_MAX_WITHDRAW_AMOUNT — is set BEFORE the
//      controller is required, so its module-load-time constants observe it.
//   2. `ethers` is partially mocked (real Interface preserved for the
//      module-load VEILPOOL_INTERFACE build; Contract/Wallet/JsonRpcProvider
//      stubbed) so we can observe pool calls and drive the success path.
//   3. `relayerQuota` is mocked so the success path does not touch Redis:
//      circuit closed, quotas ok, nullifier-mark + notes are no-ops, and the
//      operator balance floor is 0.

// ---------------------------------------------------------------------------
// 1. ethers mock — `mock`-prefixed bindings are the only out-of-scope refs
//    babel-jest / ts-jest allow inside a hoisted `jest.mock` factory.
// ---------------------------------------------------------------------------

type WithdrawMock = jest.Mock & { staticCall: jest.Mock };

const mockContractWithdraw = jest.fn(async () => ({
  hash: '0x' + 'cc'.repeat(32),
})) as WithdrawMock;
mockContractWithdraw.staticCall = jest.fn(async () => undefined);

jest.mock('ethers', () => {
  const real = jest.requireActual('ethers');
  return {
    ...real,
    ethers: {
      ...real.ethers,
      JsonRpcProvider: jest.fn(() => ({
        getBalance: jest.fn(async () => 10n ** 18n),
      })),
      Wallet: jest.fn((_pk: string, provider: unknown) => ({
        address: '0x' + 'ab'.repeat(20),
        provider,
      })),
      Contract: jest.fn(() => ({ withdraw: mockContractWithdraw })),
    },
  };
});

// ---------------------------------------------------------------------------
// 2. relayerQuota mock — keep the success path off Redis and past every gate.
// ---------------------------------------------------------------------------

jest.mock('../../utils/relayerQuota', () => ({
  checkRelayerQuotas: jest.fn(async () => ({ ok: true })),
  isRelayerCircuitOpen: jest.fn(() => false),
  markNullifierSpent: jest.fn(async () => undefined),
  noteRelayerFailure: jest.fn(() => undefined),
  noteRelayerSuccess: jest.fn(() => undefined),
  RELAYER_MIN_BALANCE_WEI: 0n,
}));

import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// 3. Env MUST be set before the controller loads (its RELAYER_* constants,
//    including RELAYER_MAX_WITHDRAW_AMOUNT, are evaluated once at module load).
// ---------------------------------------------------------------------------

const ALLOWLISTED_POOL = '0x' + 'aa'.repeat(20); // lowercase by construction
const CAP = 1000n;
process.env.RELAYER_VEILPOOL_ALLOWLIST = ALLOWLISTED_POOL;
process.env.RELAYER_PRIVATE_KEY = '0x' + '11'.repeat(32);
process.env.RELAYER_RPC_URL = 'http://localhost:8545';
process.env.RELAYER_MAX_WITHDRAW_AMOUNT = CAP.toString();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const controller = require('../relayerController') as typeof import('../relayerController');
const { handleWithdraw, RELAYER_MAX_WITHDRAW_AMOUNT } = controller;

const app = express();
app.use(express.json());
app.post(
  '/api/v1/relayer/withdraw',
  (req: Request, res: Response, next: NextFunction) => {
    handleWithdraw(req, res, next).catch(next);
  }
);

// ---------------------------------------------------------------------------
// 4. A fully valid, allowlisted body; `amount` is overridden per test.
// ---------------------------------------------------------------------------

function bodyWithAmount(amount: string): Record<string, unknown> {
  return {
    nullifierHash: '0x' + '11'.repeat(32),
    proof: '0x' + '22'.repeat(64),
    publicSignals: [
      '0x' + 'aa'.repeat(32),
      '0x' + 'bb'.repeat(32),
      '0x' + 'cc'.repeat(20),
      '0x' + 'dd'.repeat(32),
    ],
    merkleRoot: '0x' + '33'.repeat(32),
    recipient: '0x' + '44'.repeat(20),
    token: '0x' + '55'.repeat(20),
    amount,
    chainKey: 'evm-sepolia',
    contractAddress: ALLOWLISTED_POOL,
  };
}

describe('SEC-013: relayer per-withdraw amount cap', () => {
  beforeEach(() => {
    mockContractWithdraw.mockClear();
    mockContractWithdraw.staticCall.mockClear();
  });

  it('parses RELAYER_MAX_WITHDRAW_AMOUNT from env as a bigint', () => {
    expect(RELAYER_MAX_WITHDRAW_AMOUNT).toBe(CAP);
  });

  it('rejects an amount above the cap with 400 AMOUNT_EXCEEDS_CAP and zero pool calls', async () => {
    const res = await request(app)
      .post('/api/v1/relayer/withdraw')
      .send(bodyWithAmount((CAP + 1n).toString()));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AMOUNT_EXCEEDS_CAP');
    expect(mockContractWithdraw.staticCall).not.toHaveBeenCalled();
    expect(mockContractWithdraw).not.toHaveBeenCalled();
  });

  it('permits an amount exactly at the cap (reaches the pool)', async () => {
    const res = await request(app)
      .post('/api/v1/relayer/withdraw')
      .send(bodyWithAmount(CAP.toString()));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, txHash: '0x' + 'cc'.repeat(32) });
    expect(mockContractWithdraw.staticCall).toHaveBeenCalledTimes(1);
    expect(mockContractWithdraw).toHaveBeenCalledTimes(1);
  });

  it('permits an amount below the cap (reaches the pool)', async () => {
    const res = await request(app)
      .post('/api/v1/relayer/withdraw')
      .send(bodyWithAmount((CAP - 1n).toString()));

    expect(res.status).toBe(200);
    expect(mockContractWithdraw.staticCall).toHaveBeenCalledTimes(1);
  });
});
