import { SUPPORTED_CHAINS } from "@veilpay/shared";

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-4xl font-bold mb-8">VeilPay</h1>
      <p className="text-lg mb-4">Multi-Chain Privacy Payment Protocol</p>

      <h2 className="text-2xl font-semibold mt-8 mb-4">Supported Chains</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SUPPORTED_CHAINS.map((chain) => (
          <div
            key={chain.key}
            className="border rounded-lg p-4 hover:shadow-lg transition-shadow"
          >
            <h3 className="text-xl font-medium">{chain.name}</h3>
            <p className="text-sm text-gray-500">Type: {chain.type.toUpperCase()}</p>
            {chain.chainId && (
              <p className="text-sm text-gray-500">Chain ID: {chain.chainId}</p>
            )}
            <p className="text-sm text-gray-500">
              Native: {chain.nativeCurrency.symbol}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
