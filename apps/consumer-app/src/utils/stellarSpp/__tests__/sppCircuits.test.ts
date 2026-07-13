describe('stellarSpp/sppCircuits', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../sppNativeBridge');
    jest.dontMock('../sppPoolSession');
    jest.dontMock('expo-file-system/legacy');
  });

  it('seeds bundled assets before reporting circuit readiness', async () => {
    const ensureCircuitAssets = jest.fn(async () => ({
      ok: true,
      op: 'ensure_circuit_assets',
      message: 'seeded bundled assets',
    }));
    const getInfoAsync = jest.fn(async () => ({ exists: true }));

    jest.doMock('../sppNativeBridge', () => ({
      sppNativeEnsureCircuitAssets: ensureCircuitAssets,
    }));
    jest.doMock('expo-file-system/legacy', () => ({ getInfoAsync }));

    const { getCircuitsReadinessForDir, REQUIRED_SPP_CIRCUIT_FILES } =
      require('../sppCircuits') as typeof import('../sppCircuits');

    const result = await getCircuitsReadinessForDir('/data/user/0/app/files/spp/circuits');

    expect(ensureCircuitAssets).toHaveBeenCalledTimes(1);
    expect(getInfoAsync).toHaveBeenCalledTimes(REQUIRED_SPP_CIRCUIT_FILES.length);
    expect(getInfoAsync).toHaveBeenNthCalledWith(
      1,
      'file:///data/user/0/app/files/spp/circuits/policy_tx_2_2_proving_key.bin'
    );
    expect(result).toEqual({
      dir: '/data/user/0/app/files/spp/circuits',
      ready: true,
      missing: [],
      message: 'Circuit assets present',
    });
  });

  it('reports missing assets with native seeding failure context', async () => {
    const ensureCircuitAssets = jest.fn(async () => ({
      ok: false,
      code: 'SPP_CIRCUITS_SEED_FAILED',
      op: 'ensure_circuit_assets',
      message: 'failed to copy bundled circuit assets',
    }));
    const getInfoAsync = jest.fn(async (uri: string) => ({
      exists: !uri.endsWith('/policy_tx_2_2.r1cs'),
    }));

    jest.doMock('../sppNativeBridge', () => ({
      sppNativeEnsureCircuitAssets: ensureCircuitAssets,
    }));
    jest.doMock('expo-file-system/legacy', () => ({ getInfoAsync }));

    const { getCircuitsReadinessForDir } =
      require('../sppCircuits') as typeof import('../sppCircuits');

    const result = await getCircuitsReadinessForDir('file:///already/a/file-uri');

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(['policy_tx_2_2.r1cs']);
    expect(result.message).toBe('failed to copy bundled circuit assets');
    expect(getInfoAsync).toHaveBeenCalledWith('file:///already/a/file-uri/policy_tx_2_2.r1cs');
  });

  it('ignores JS-stub seeding not-ready and uses the default staging guidance', async () => {
    const ensureCircuitAssets = jest.fn(async () => ({
      ok: false,
      code: 'SPP_OPS_NOT_READY',
      op: 'ensure_circuit_assets',
      message: 'js stub has no bundled assets',
    }));
    const getInfoAsync = jest.fn(async () => ({ exists: false }));

    jest.doMock('../sppNativeBridge', () => ({
      sppNativeEnsureCircuitAssets: ensureCircuitAssets,
    }));
    jest.doMock('expo-file-system/legacy', () => ({ getInfoAsync }));

    const { getCircuitsReadinessForDir, REQUIRED_SPP_CIRCUIT_FILES } =
      require('../sppCircuits') as typeof import('../sppCircuits');

    const result = await getCircuitsReadinessForDir('/tmp/spp/circuits/');

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([...REQUIRED_SPP_CIRCUIT_FILES]);
    expect(result.message).toContain('Rebuild the Android APK with bundled circuit assets');
    expect(result.message).toContain('/tmp/spp/circuits/');
  });

  it('uses pool session circuit dir for default readiness lookup', async () => {
    jest.doMock('../sppNativeBridge', () => ({
      sppNativeEnsureCircuitAssets: jest.fn(async () => ({
        ok: false,
        code: 'SPP_OPS_NOT_READY',
        op: 'ensure_circuit_assets',
      })),
    }));
    jest.doMock('../sppPoolSession', () => ({
      getSppCircuitsDir: () => '/native/app/data/spp/circuits',
    }));
    jest.doMock('expo-file-system/legacy', () => ({
      getInfoAsync: jest.fn(async () => ({ exists: true })),
    }));

    const { getCircuitsReadiness } =
      require('../sppCircuits') as typeof import('../sppCircuits');

    await expect(getCircuitsReadiness()).resolves.toMatchObject({
      dir: '/native/app/data/spp/circuits',
      ready: true,
      missing: [],
    });
  });
});