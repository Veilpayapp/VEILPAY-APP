import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SCREENS } from "../../constants/screens";

process.env.EXPO_PUBLIC_TRANSAK_API_KEY = "test-api-key";
process.env.EXPO_PUBLIC_TRANSAK_REFERRER_DOMAIN = "veilpay.app";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockAuthenticate = jest.fn();
const mockShowToast = jest.fn();

const walletState = {
  address: "0x1234567890abcdef1234567890abcdef12345678",
  activeChain: {
    key: "ethereum",
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
    },
  },
  biometricsEnabled: false,
};

const mockMarketQuotes: Record<string, { symbol: string; price: number; change24h: number | null; lastUpdated: number; source: string; isStale: boolean }> = {
  ETH: { symbol: "ETH", price: 3200, change24h: 1.24, lastUpdated: Date.now(), source: "binance", isStale: false },
  MATIC: { symbol: "MATIC", price: 0.9, change24h: -0.72, lastUpdated: Date.now(), source: "binance", isStale: false },
  USDT: { symbol: "USDT", price: 1, change24h: 0, lastUpdated: Date.now(), source: "binance", isStale: false },
  USDC: { symbol: "USDC", price: 1, change24h: 0, lastUpdated: Date.now(), source: "binance", isStale: false },
};

jest.mock("../../stores/walletStore", () => ({
  useWalletStore: () => walletState,
}));

jest.mock("../../hooks/useBiometrics", () => ({
  useBiometrics: () => ({
    isAvailable: true,
    biometricType: null,
    isAuthenticated: false,
    error: null,
    authenticate: mockAuthenticate,
  }),
}));

jest.mock("../../hooks/useMarketData", () => ({
  useMarketData: () => ({
    quotes: mockMarketQuotes,
    isLoading: false,
    error: null,
    refresh: jest.fn(),
    lastUpdated: Date.now(),
    getQuote: (symbol: string) => mockMarketQuotes[symbol.toUpperCase()] ?? {
      symbol: symbol.toUpperCase(),
      price: 1,
      change24h: null,
      lastUpdated: Date.now(),
      source: "fallback",
      isStale: true,
    },
  }),
}));

jest.mock("../../hooks/useTransakQuote", () => ({
  useTransakQuote: (request: any) => {
    if (!request) {
      return {
        quote: null,
        isLoading: false,
        error: null,
        lastUpdated: null,
        refresh: jest.fn(),
      };
    }

    const price = mockMarketQuotes[request.cryptoCurrency.toUpperCase()]?.price ?? 1;
    const totalFee = request.fiatAmount ? request.fiatAmount * 0.025 + 2.5 : 2.5;
    const cryptoAmount = request.fiatAmount ? Math.max((request.fiatAmount - totalFee) / price, 0) : 0;

    return {
      quote: {
        request,
        requestKey: "quote-request-key",
        quoteId: "quote-123",
        conversionPrice: price,
        marketConversionPrice: price,
        slippage: 0.5,
        fiatCurrency: request.fiatCurrency,
        cryptoCurrency: request.cryptoCurrency,
        paymentMethod: request.paymentMethod ?? null,
        fiatAmount: request.fiatAmount ?? null,
        cryptoAmount,
        isBuyOrSell: "BUY",
        network: request.network,
        feeDecimal: 0.025,
        totalFee,
        feeBreakdown: [
          { id: "network_fee", name: "Network Fee", value: 2.5 },
          { id: "transak_fee", name: "Transak Fee", value: Math.max(totalFee - 2.5, 0) },
        ],
        nonce: null,
        cryptoLiquidityProvider: "Transak",
        notes: [],
        source: "live",
        isStale: false,
        lastUpdated: Date.now(),
      },
      isLoading: false,
      error: null,
      lastUpdated: Date.now(),
      refresh: jest.fn(),
    };
  },
}));

jest.mock("../../components/Toast", () => ({
  __esModule: true,
  default: () => null,
  useToast: () => ({
    visible: false,
    message: "",
    type: "info",
    show: mockShowToast,
    hide: jest.fn(),
  }),
}));

jest.mock("../../components/Icon", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Icon: () => <View testID="mock-icon" /> };
});

jest.mock("../../components/ScreenBackButton", () => {
  const React = require("react");
  const { TouchableOpacity, Text } = require("react-native");
  return {
    ScreenBackButton: ({ onPress }: { onPress: () => void }) => (
      <TouchableOpacity onPress={onPress}>
        <Text>BACK</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock("../../utils/haptics", () => ({
  triggerLightImpactHaptic: jest.fn(),
}));

const { DepositCryptoScreen } = require("../DepositCryptoScreen");

describe("DepositCryptoScreen", () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockShowToast.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    walletState.biometricsEnabled = false;
    mockAuthenticate.mockResolvedValue(true);
  });

  function renderScreen() {
    const navigation = { goBack: mockGoBack, navigate: mockNavigate };
    const route = { key: "DepositCrypto", name: "DepositCrypto", params: undefined };

    return render(<DepositCryptoScreen navigation={navigation as any} route={route as any} />);
  }

  it("renders the live buy flow", async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByText("BUY CRYPTO")).toBeTruthy();
      expect(screen.getByText("YOU PAY")).toBeTruthy();
      expect(screen.getByText("LIVE TOKEN PRICE")).toBeTruthy();
      expect(screen.getByText("YOU RECEIVE")).toBeTruthy();
      expect(screen.getByText("PAYMENT METHOD")).toBeTruthy();
      expect(screen.getByText("FEES")).toBeTruthy();
    });
  });

  it("shows quick amount chips", async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByText("$50")).toBeTruthy();
      expect(screen.getByText("$100")).toBeTruthy();
      expect(screen.getByText("$200")).toBeTruthy();
    });
  });

  it("shows currency and payment options", async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getAllByText("USD").length).toBeGreaterThan(0);
      expect(screen.getAllByText("EUR").length).toBeGreaterThan(0);
      expect(screen.getAllByText("GBP").length).toBeGreaterThan(0);
      expect(screen.getAllByText("INR").length).toBeGreaterThan(0);
      expect(screen.getByText("Credit/Debit Card")).toBeTruthy();
      expect(screen.getByText("Google Pay")).toBeTruthy();
      expect(screen.getByText("UPI (India)")).toBeTruthy();
      expect(screen.getByText("PayTM (India)")).toBeTruthy();
      expect(screen.getByText("Bank Transfer")).toBeTruthy();
    });
  });

  it("shows token prices and 24h change", async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getAllByText("ETH").length).toBeGreaterThan(0);
      expect(screen.getAllByText("USDT").length).toBeGreaterThan(0);
      expect(screen.getAllByText("USDC").length).toBeGreaterThan(0);
      expect(screen.getAllByText("MATIC").length).toBeGreaterThan(0);
      expect(screen.getByText("LIVE BINANCE FEED")).toBeTruthy();
      expect(screen.getByText("+1.24%")).toBeTruthy();
    });
  });

  it("navigates to the in-app Transak webview", async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByText("CONTINUE TO TRANSAK")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("CONTINUE TO TRANSAK"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        SCREENS.TRANSAK_WEBVIEW,
        expect.objectContaining({
          flow: "buy",
          title: "BUY CRYPTO",
          url: expect.stringContaining("productsAvailed=BUY"),
        })
      );
    });
  });

  it("requires biometrics before continuing when enabled", async () => {
    walletState.biometricsEnabled = true;
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByText("CONTINUE TO TRANSAK")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("CONTINUE TO TRANSAK"));

    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(
        SCREENS.TRANSAK_WEBVIEW,
        expect.objectContaining({ flow: "buy", title: "BUY CRYPTO" })
      );
    });
  });

  it("shows fee breakdown", async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByText("Network Fee")).toBeTruthy();
      expect(screen.getByText("Transak Fee")).toBeTruthy();
      expect(screen.getByText("TOTAL FEES")).toBeTruthy();
    });
  });

  it("handles back navigation", async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByText("BACK")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("BACK"));

    expect(mockGoBack).toHaveBeenCalled();
  });
});