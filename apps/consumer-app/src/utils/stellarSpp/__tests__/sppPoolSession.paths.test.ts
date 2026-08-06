import { SPP_TESTNET } from '../../../constants/spp';
import { contractConfigFor, toNativeFsPath } from '../sppPoolSession';

describe('toNativeFsPath', () => {
  it('strips file:// for Android document URIs', () => {
    expect(toNativeFsPath('file:///data/user/0/com.veilpay.consumer/files/')).toBe(
      '/data/user/0/com.veilpay.consumer/files'
    );
  });

  it('leaves absolute paths alone (trim trailing slash)', () => {
    expect(
      toNativeFsPath('/storage/emulated/0/Android/data/com.veilpay.consumer/files/')
    ).toBe('/storage/emulated/0/Android/data/com.veilpay.consumer/files');
  });

  it('decodes percent-encoding', () => {
    expect(toNativeFsPath('file:///data/user/0/app/files/my%20dir')).toBe(
      '/data/user/0/app/files/my dir'
    );
  });

  it('passes the authoritative deployment and recovery ledger to native pool ops', () => {
    const config = contractConfigFor(SPP_TESTNET) as {
      deployer: string;
      admin: string;
      asp_membership: string;
      pools: Array<{ poolContractId: string; deploymentLedger: number }>;
    };
    expect(config.deployer).toBe(SPP_TESTNET.deployer);
    expect(config.admin).toBe(SPP_TESTNET.admin);
    expect(config.asp_membership).toBe(SPP_TESTNET.aspMembershipId);
    expect(config.pools[0]).toMatchObject({
      poolContractId: SPP_TESTNET.poolId,
      deploymentLedger: SPP_TESTNET.deploymentLedger,
    });
  });
});
