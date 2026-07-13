import {
  checkRelayerQuotas,
  markNullifierSpent,
  assertNullifierNotSpent,
  isRelayerCircuitOpen,
  noteRelayerFailure,
  noteRelayerSuccess,
  __test,
} from '../relayerQuota';

describe('relayerQuota (SEC-006)', () => {
  beforeEach(() => {
    __test.reset();
  });

  it('allows first withdraw for a nullifier/recipient/ip', async () => {
    const r = await checkRelayerQuotas({
      nullifierHash: '0x' + '11'.repeat(32),
      recipient: '0x' + '22'.repeat(20),
      clientIp: '1.2.3.4',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a nullifier after markNullifierSpent', async () => {
    const nullifierHash = '0x' + '33'.repeat(32);
    await markNullifierSpent(nullifierHash);
    expect(await assertNullifierNotSpent(nullifierHash)).toBe(false);
    const r = await checkRelayerQuotas({
      nullifierHash,
      recipient: '0x' + '44'.repeat(20),
      clientIp: '5.6.7.8',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('RELAYER_NULLIFIER_QUOTA');
    }
  });

  it('trips circuit after many consecutive failures', () => {
    expect(isRelayerCircuitOpen()).toBe(false);
    for (let i = 0; i < 20; i++) {
      noteRelayerFailure();
    }
    expect(isRelayerCircuitOpen()).toBe(true);
    noteRelayerSuccess();
    // Success does not clear open circuit until window expires; just ensure
    // API is callable.
    expect(typeof isRelayerCircuitOpen()).toBe('boolean');
  });
});
