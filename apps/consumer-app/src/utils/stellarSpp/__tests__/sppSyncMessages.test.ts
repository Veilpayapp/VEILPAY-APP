import {
  formatSppSyncUserMessage,
  isSppRpcSyncGapMessage,
} from '../sppSyncMessages';
import {
  getSppAllowPartialSync,
  getSppBootnodeUrl,
  SPP_TESTNET,
} from '../../../constants/spp';

describe('sppSyncMessages', () => {
  it('detects RPC sync gap strings', () => {
    expect(
      isSppRpcSyncGapMessage(
        'sync: indexer: RPC sync gap - the oldest ledger is: 3484556'
      )
    ).toBe(true);
    expect(isSppRpcSyncGapMessage('Private XLM ready')).toBe(false);
  });

  it('humanizes gap without bootnode hint', () => {
    const msg = formatSppSyncUserMessage(
      'sync: indexer: RPC sync gap - the oldest ledger is: 3484556'
    );
    expect(msg).toMatch(/history|retention|unavailable/i);
    expect(msg).not.toMatch(/indexer:/i);
  });

  it('humanizes partial sync for dogfood', () => {
    expect(
      formatSppSyncUserMessage(
        'partial sync from ledger 3484556 (earlier private notes need a bootnode archive)'
      )
    ).toMatch(/3484556|recent history|Older notes/i);
  });

  it('maps DNS lookup failures to a user-friendly message', () => {
    expect(
      formatSppSyncUserMessage(
        'sync: indexer catch-up: network error: ... dns error: failed to lookup address information'
      )
    ).toMatch(/Network temporarily unavailable/i);
  });

  it('maps connect failures to a user-friendly message', () => {
    expect(
      formatSppSyncUserMessage('client error (Connect): failed to connect to host')
    ).toMatch(/Could not reach the private payment network/i);
  });

  it('maps request timeouts to a user-friendly message', () => {
    expect(formatSppSyncUserMessage('error sending request: operation timed out')).toMatch(
      /Connection timed out/i
    );
  });

  it('maps native pool catch-up timeouts to a user-friendly message', () => {
    expect(
      formatSppSyncUserMessage(
        'sync: pool sync timed out (phase=catch_up, limit=90s, elapsed=90s)'
      )
    ).toMatch(/Connection timed out/i);
  });

  it('maps ledger retention gap to a user-friendly message', () => {
    expect(
      formatSppSyncUserMessage(
        'startLedger must be within 120960 ledgers of latest ledger'
      )
    ).toMatch(/Private history gap detected/i);
  });

  it('does not mangle the raw message when nothing maps', () => {
    const raw = 'some unknown native error text';
    expect(formatSppSyncUserMessage(raw)).toBe(raw);
  });
});

describe('SPP bootnode config helpers', () => {
  const prevBoot = process.env.EXPO_PUBLIC_SPP_BOOTNODE_URL;
  const prevPartial = process.env.EXPO_PUBLIC_SPP_ALLOW_PARTIAL_SYNC;

  afterEach(() => {
    if (prevBoot === undefined) delete process.env.EXPO_PUBLIC_SPP_BOOTNODE_URL;
    else process.env.EXPO_PUBLIC_SPP_BOOTNODE_URL = prevBoot;
    if (prevPartial === undefined) delete process.env.EXPO_PUBLIC_SPP_ALLOW_PARTIAL_SYNC;
    else process.env.EXPO_PUBLIC_SPP_ALLOW_PARTIAL_SYNC = prevPartial;
  });

  it('prefers env bootnode over config', () => {
    process.env.EXPO_PUBLIC_SPP_BOOTNODE_URL = 'https://archive.example/rpc';
    expect(getSppBootnodeUrl(SPP_TESTNET)).toBe('https://archive.example/rpc');
  });

  it('testnet allows partial sync by default', () => {
    delete process.env.EXPO_PUBLIC_SPP_ALLOW_PARTIAL_SYNC;
    expect(getSppAllowPartialSync(SPP_TESTNET)).toBe(true);
  });

  it('env can disable partial sync', () => {
    process.env.EXPO_PUBLIC_SPP_ALLOW_PARTIAL_SYNC = 'false';
    expect(getSppAllowPartialSync(SPP_TESTNET)).toBe(false);
  });
});
