import { getChainByKey, getChainByChainId, getChainsByType, SUPPORTED_CHAINS } from "../chains";

describe("chains.ts", () => {
  it("should have supported chains defined", () => {
    expect(SUPPORTED_CHAINS).toBeDefined();
    expect(SUPPORTED_CHAINS.length).toBeGreaterThan(0);
  });

  describe("getChainByKey", () => {
    it("should return the correct chain by key", () => {
      const ethereum = getChainByKey("ethereum");
      expect(ethereum).toBeDefined();
      expect(ethereum?.name).toBe("Ethereum");
    });

    it("should return undefined for non-existent key", () => {
      expect(getChainByKey("non-existent")).toBeUndefined();
    });
  });

  describe("getChainByChainId", () => {
    it("should return the correct chain by chainId", () => {
      const polygon = getChainByChainId(137);
      expect(polygon).toBeDefined();
      expect(polygon?.key).toBe("polygon");
    });

    it("should return undefined for non-existent chainId", () => {
      expect(getChainByChainId(999999)).toBeUndefined();
    });
  });

  describe("getChainsByType", () => {
    it("should return chains matching the type", () => {
      const evmChains = getChainsByType("evm");
      expect(evmChains.length).toBeGreaterThan(0);
      expect(evmChains.every((c) => c.type === "evm")).toBe(true);

      const svmChains = getChainsByType("svm");
      expect(svmChains.length).toBeGreaterThan(0);
      expect(svmChains.every((c) => c.type === "svm")).toBe(true);
    });
  });
});
