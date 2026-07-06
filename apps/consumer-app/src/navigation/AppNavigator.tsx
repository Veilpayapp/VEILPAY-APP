/**
 * Veilpay App Navigation
 * Handles all screen navigation for the consumer app
 */

import React, { useCallback, useEffect, useRef } from "react";
import { NavigationContainer, DarkTheme, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";

// Screens
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { WalletConnectScreen } from "../screens/WalletConnectScreen";
import { CreateWalletScreen } from "../screens/CreateWalletScreen";
import { VerifyWalletScreen } from "../screens/VerifyWalletScreen";
import { ImportWalletScreen } from "../screens/ImportWalletScreen";
import { HomeDashboardScreen } from "../screens/HomeDashboardScreen";
import { SendPaymentScreen } from "../screens/SendPaymentScreen";
import { PrivacyLevelScreen } from "../screens/PrivacyLevelScreen";
import { PaymentConfirmationScreen } from "../screens/PaymentConfirmationScreen";
import { PaymentSuccessScreen } from "../screens/PaymentSuccessScreen";
import { ReceiveQRScreen } from "../screens/ReceiveQRScreen";
import { BackupWalletScreen } from "../screens/BackupWalletScreen";
import { ExportPrivateKeyScreen } from "../screens/ExportPrivateKeyScreen";
import { TransactionHistoryScreen } from "../screens/TransactionHistoryScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SetPasswordScreen } from "../screens/SetPasswordScreen";
import { BiometricSetupScreen } from "../screens/BiometricSetupScreen";
import { QRScannerScreen } from "../screens/QRScannerScreen";
import { TransactionDetailsScreen } from "../screens/TransactionDetailsScreen";
import { TokenSelectorScreen } from "../screens/TokenSelectorScreen";
import { TokenDetailScreen } from "../screens/TokenDetailScreen";
import { DepositCryptoScreen } from "../screens/DepositCryptoScreen";
import { WithdrawFiatScreen } from "../screens/WithdrawFiatScreen";
import { TransakWebViewScreen } from "../screens/TransakWebViewScreen";
import { OnrampWidgetScreen } from "../screens/OnrampWidgetScreen";
import { OnrampAmountScreen } from "../screens/OnrampAmountScreen";
import { OnrampQuotesScreen } from "../screens/OnrampQuotesScreen";
import { AddCustomNetworkScreen } from "../screens/AddCustomNetworkScreen";
import type { TransactionRecord } from "../types/transactions";
import type { PaymentToken } from "../types/tokens";
import type { ChainType } from "../stores/walletStore";
import type { TransakFlow } from "../stores/transactionStore";

// Constants
import { SCREENS } from "../constants/screens";
import { setupDeepLinking, type DeepLinkParams } from "../utils/deepLinking";
import { trackScreenView } from "../utils/analytics";
import { getScreenTransition } from "./transitions";
import { useTheme, useStyles } from "../styles/design-tokens";
import { useWalletStore } from "../stores/walletStore";
import { useTransactionStore } from "../stores/transactionStore";

// Note: This function reads store state but is only called from event handlers
// (navigateFromDeepLink), not during render, so it's safe from React concurrency issues.
function resolveTransactionFromDeepLink(identifier?: string): TransactionRecord | null {
  if (!identifier) {
    return null;
  }

  const normalizedIdentifier = identifier.toLowerCase();
  const { transactions } = useTransactionStore.getState();

  for (const transaction of transactions) {
    const normalizedHash = transaction.hash?.toLowerCase();
    const normalizedId = transaction.id?.toLowerCase();

    if (normalizedHash === normalizedIdentifier || normalizedId === normalizedIdentifier) {
      return transaction;
    }
  }

  return null;
}

// Stack navigator type
export type RootStackParamList = {
  [SCREENS.ONBOARDING]: undefined;
  [SCREENS.WALLET_CONNECT]:
  | {
    uri?: string;
    address?: string;
    chainType?: ChainType;
    source?: string;
    error?: string;
  }
  | undefined;
  [SCREENS.CREATE_WALLET]: undefined;
  [SCREENS.VERIFY_WALLET]: {
    seedWords: string[];
    derivedAddress: string;
  };
  [SCREENS.IMPORT_WALLET]: undefined;
  [SCREENS.HOME]: undefined;
  [SCREENS.SEND_PAYMENT]: {
    address?: string;
    amount?: string;
  };
  [SCREENS.PRIVACY_LEVEL]: {
    recipient: string;
    amount: string;
    memo?: string;
    token: string;
  };
  [SCREENS.PAYMENT_CONFIRMATION]: {
    recipient: string;
    amount: string;
    memo?: string;
    token: string;
    privacyLevel: "standard" | "stealth" | "max";
  };
  [SCREENS.PAYMENT_SUCCESS]: {
    transaction: TransactionRecord;
  };
  [SCREENS.RECEIVE_QR]: undefined;
  [SCREENS.TRANSACTION_HISTORY]: undefined;
  [SCREENS.TRANSACTION_DETAILS]: { transaction: TransactionRecord };
  [SCREENS.TOKEN_DETAIL]: { tokenSymbol: string; chainKey: string; };
  [SCREENS.SETTINGS]: undefined;
  [SCREENS.ADD_CUSTOM_NETWORK]: undefined;
  [SCREENS.DEPOSIT_CRYPTO]: undefined;
  [SCREENS.WITHDRAW_FIAT]: undefined;
  [SCREENS.BACKUP_WALLET]: undefined;
  [SCREENS.EXPORT_PRIVATE_KEY]: undefined;
  [SCREENS.TOKEN_SELECTOR]: {
    onSelect: (token: PaymentToken) => void;
    selectedSymbol?: string;
    chainKey?: string;
  };
  [SCREENS.QR_SCANNER]: undefined;
  [SCREENS.TRANSAK_WEBVIEW]: {
    /** The fully-built Transak URL (produced by buildTransakDepositUrl / buildTransakWithdrawUrl) */
    url: string;
    /** Header title shown in the in-app browser bar */
    title?: string;
    /** Explicit Transak intent, used instead of inferring from title text */
    flow: TransakFlow;
  };
  [SCREENS.ONRAMP_WIDGET]: {
    url: string;
    title?: string;
    orderId: string;
  };
  [SCREENS.ONRAMP_AMOUNT]: {
    flow: 'buy' | 'sell';
  };
  [SCREENS.ONRAMP_QUOTES]: {
    flow: 'buy' | 'sell';
    fiatAmount: string;
    fiatCurrency: string;
    cryptoToken: string;
    chainKey: string;
  };
  [SCREENS.SET_PASSWORD]: undefined;
  [SCREENS.BIOMETRIC_SETUP]: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Export typed navigation hooks for use in screens
export type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
export type RoutePropForScreen<K extends keyof RootStackParamList> = RouteProp<
  RootStackParamList,
  K
>;

// Convenience type for screen props
export type ScreenProps<K extends keyof RootStackParamList> = {
  navigation: NativeStackNavigationProp<RootStackParamList, K>;
  route: RouteProp<RootStackParamList, K>;
};

interface AppNavigatorProps {
  initialRouteName?: keyof RootStackParamList;
}

export function AppNavigator({ initialRouteName = SCREENS.ONBOARDING }: AppNavigatorProps) {
  const { colors } = useTheme();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const pendingDeepLinkRef = useRef<DeepLinkParams | null>(null);
  const routeNameRef = useRef<string | undefined>(undefined);

  const navigateFromDeepLink = useCallback(
    (params: DeepLinkParams) => {
      if (!navigationRef.isReady()) {
        pendingDeepLinkRef.current = params;
        return;
      }

      switch (params.action) {
        case "send":
          navigationRef.navigate(SCREENS.SEND_PAYMENT, {
            address: params.address,
            amount: params.amount,
          });
          return;
        case "receive":
          navigationRef.navigate(SCREENS.RECEIVE_QR);
          return;
        case "walletconnect":
        case "approve":
        case "reject":
          navigationRef.navigate(SCREENS.WALLET_CONNECT, {
            uri: params.uri,
            address: params.address,
            chainType: params.chainType,
          });
          return;
        case "transactions":
          {
            const transactionIdentifier = params.transactionHash || params.transactionId;
            const matchedTransaction = resolveTransactionFromDeepLink(transactionIdentifier);

            if (matchedTransaction) {
              navigationRef.navigate(SCREENS.TRANSACTION_DETAILS, {
                transaction: matchedTransaction,
              });
              return;
            }

            navigationRef.navigate(SCREENS.TRANSACTION_HISTORY);
          }
          return;
        default:
          return;
      }
    },
    [navigationRef]
  );

  useEffect(() => setupDeepLinking(navigateFromDeepLink), [navigateFromDeepLink]);

  const handleNavigationReady = useCallback(() => {
    const initialRoute = navigationRef.getCurrentRoute()?.name;
    routeNameRef.current = initialRoute;
    if (initialRoute) {
      trackScreenView(initialRoute);
    }

    if (!pendingDeepLinkRef.current) {
      return;
    }

    navigateFromDeepLink(pendingDeepLinkRef.current);
    pendingDeepLinkRef.current = null;
  }, [navigateFromDeepLink, navigationRef]);

  const handleNavigationStateChange = useCallback(() => {
    const currentRouteName = navigationRef.getCurrentRoute()?.name;
    if (!currentRouteName) {
      return;
    }

    if (routeNameRef.current === currentRouteName) {
      return;
    }

    routeNameRef.current = currentRouteName;
    trackScreenView(currentRouteName);
  }, [navigationRef]);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={handleNavigationReady}
      onStateChange={handleNavigationStateChange}
      theme={{
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: colors.accent,
          background: colors.bgPrimary,
          card: colors.surfaceCard,
          text: colors.textPrimary,
          border: colors.outlineSubtle,
          notification: colors.accent,
        },
      }}
    >
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgPrimary },
          animation: "slide_from_right",
        }}
      >
        {/* Priority 1: Core Flow */}
        <Stack.Screen
          name={SCREENS.ONBOARDING}
          component={OnboardingScreen}
          options={getScreenTransition(SCREENS.ONBOARDING)}
        />
        <Stack.Screen
          name={SCREENS.WALLET_CONNECT}
          component={WalletConnectScreen}
          options={getScreenTransition(SCREENS.WALLET_CONNECT)}
        />

        {/* Priority 2: Wallet Management */}
        <Stack.Screen
          name={SCREENS.CREATE_WALLET}
          component={CreateWalletScreen}
          options={getScreenTransition(SCREENS.CREATE_WALLET)}
        />
        <Stack.Screen
          name={SCREENS.VERIFY_WALLET}
          component={VerifyWalletScreen}
          options={getScreenTransition(SCREENS.VERIFY_WALLET)}
        />
        <Stack.Screen
          name={SCREENS.IMPORT_WALLET}
          component={ImportWalletScreen}
          options={getScreenTransition(SCREENS.IMPORT_WALLET)}
        />
        <Stack.Screen
          name={SCREENS.HOME}
          component={HomeDashboardScreen}
          options={getScreenTransition(SCREENS.HOME)}
        />

        {/* Priority 3: Payment Flow */}
        <Stack.Screen
          name={SCREENS.SEND_PAYMENT}
          component={SendPaymentScreen}
          options={getScreenTransition(SCREENS.SEND_PAYMENT)}
        />
        <Stack.Screen
          name={SCREENS.PRIVACY_LEVEL}
          component={PrivacyLevelScreen}
          options={getScreenTransition(SCREENS.PRIVACY_LEVEL)}
        />
        <Stack.Screen
          name={SCREENS.PAYMENT_CONFIRMATION}
          component={PaymentConfirmationScreen}
          options={getScreenTransition(SCREENS.PAYMENT_CONFIRMATION)}
        />
        <Stack.Screen
          name={SCREENS.PAYMENT_SUCCESS}
          component={PaymentSuccessScreen}
          options={getScreenTransition(SCREENS.PAYMENT_SUCCESS)}
        />
        <Stack.Screen
          name={SCREENS.RECEIVE_QR}
          component={ReceiveQRScreen}
          options={getScreenTransition(SCREENS.RECEIVE_QR)}
        />
        <Stack.Screen
          name={SCREENS.BACKUP_WALLET}
          component={BackupWalletScreen}
          options={getScreenTransition(SCREENS.BACKUP_WALLET)}
        />
        <Stack.Screen
          name={SCREENS.EXPORT_PRIVATE_KEY}
          component={ExportPrivateKeyScreen}
          options={getScreenTransition(SCREENS.EXPORT_PRIVATE_KEY)}
        />

        <Stack.Screen
          name={SCREENS.TOKEN_SELECTOR}
          component={TokenSelectorScreen}
          options={getScreenTransition(SCREENS.TOKEN_SELECTOR)}
        />
        <Stack.Screen
          name={SCREENS.QR_SCANNER}
          component={QRScannerScreen}
          options={getScreenTransition(SCREENS.QR_SCANNER)}
        />

        {/* Priority 5: History & Settings */}
        <Stack.Screen
          name={SCREENS.TRANSACTION_HISTORY}
          component={TransactionHistoryScreen}
          options={getScreenTransition(SCREENS.TRANSACTION_HISTORY)}
        />
        <Stack.Screen
          name={SCREENS.TRANSACTION_DETAILS}
          component={TransactionDetailsScreen}
          options={getScreenTransition(SCREENS.TRANSACTION_DETAILS)}
        />
        <Stack.Screen
          name={SCREENS.TOKEN_DETAIL}
          component={TokenDetailScreen}
          options={getScreenTransition(SCREENS.TOKEN_DETAIL)}
        />
    <Stack.Screen
      name={SCREENS.SETTINGS}
      component={SettingsScreen}
      options={getScreenTransition(SCREENS.SETTINGS)}
    />
    <Stack.Screen
      name={SCREENS.ADD_CUSTOM_NETWORK}
      component={AddCustomNetworkScreen}
      options={getScreenTransition(SCREENS.ADD_CUSTOM_NETWORK)}
    />

        {/* Priority 6: Fiat On/Off Ramps */}
        <Stack.Screen
          name={SCREENS.DEPOSIT_CRYPTO}
          component={DepositCryptoScreen}
          options={getScreenTransition(SCREENS.DEPOSIT_CRYPTO)}
        />
        <Stack.Screen
          name={SCREENS.WITHDRAW_FIAT}
          component={WithdrawFiatScreen}
          options={getScreenTransition(SCREENS.WITHDRAW_FIAT)}
        />
        <Stack.Screen
          name={SCREENS.TRANSAK_WEBVIEW}
          component={TransakWebViewScreen}
          options={{ ...getScreenTransition(SCREENS.TRANSAK_WEBVIEW), animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name={SCREENS.ONRAMP_WIDGET}
          component={OnrampWidgetScreen}
          options={{ ...getScreenTransition(SCREENS.ONRAMP_WIDGET), animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name={SCREENS.ONRAMP_AMOUNT}
          component={OnrampAmountScreen}
          options={getScreenTransition(SCREENS.ONRAMP_AMOUNT)}
        />
        <Stack.Screen
          name={SCREENS.ONRAMP_QUOTES}
          component={OnrampQuotesScreen}
          options={getScreenTransition(SCREENS.ONRAMP_QUOTES)}
        />
        <Stack.Screen
          name={SCREENS.SET_PASSWORD}
          component={SetPasswordScreen}
          options={getScreenTransition(SCREENS.SET_PASSWORD)}
        />
        <Stack.Screen
          name={SCREENS.BIOMETRIC_SETUP}
          component={BiometricSetupScreen}
          options={getScreenTransition(SCREENS.BIOMETRIC_SETUP)}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
