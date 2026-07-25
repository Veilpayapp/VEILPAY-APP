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
