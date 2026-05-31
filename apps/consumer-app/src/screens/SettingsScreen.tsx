/**
 * Veilpay Settings Screen
 * Wallet settings, security, privacy, and network preferences
 * Uses the current hybrid structural design language for all interactive elements
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Switch,
  Alert,
} from "react-native";
import Constants from "expo-constants";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme, useStyles, typography } from "../styles/design-tokens";
import { SUPPORTED_CHAINS, useWalletStore } from "../stores/walletStore";
import { SCREENS } from "../constants/screens";
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from "../components/Toast";
import { Logo } from "../components/Logo";
import { BottomNavBar } from "../components/BottomNavBar";
import { Icon, IconName } from "../components/Icon";
import { ScreenBackButton } from "../components/ScreenBackButton";
import { NetworkSelectorModal } from "../components/NetworkSelectorModal";
import { setClipboardString } from "../utils/clipboard";
import { openExternalUrl } from "../utils/externalLink";
import { clearStoredMnemonic, getStoredMnemonic } from "../utils/transactions";
import { useBiometrics } from "../hooks/useBiometrics";
import { useSettingsStore } from "../stores/settingsStore";
import { useShallow } from "zustand/react/shallow";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, "Settings">;

interface SettingsScreenProps {
  navigation: SettingsScreenNavigationProp;
  route: RouteProp<RootStackParamList, "Settings">;
}

// Settings section type
interface SettingsItem {
  id: string;
  label: string;
  description?: string;
  iconName: IconName;
  type: "navigate" | "toggle" | "action";
  value?: boolean;
  onPress?: () => void;
  danger?: boolean;
}

export function SettingsScreen({ navigation, route }: SettingsScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const {
    address,
    activeChain,
    setActiveChain,
    disconnect,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
      disconnect: state.disconnect,
    }))
  );

  const {
    biometricsEnabled,
    notificationsEnabled,
    analyticsEnabled,
    defaultPrivacyLevel,
    theme,
    nativeCurrency,
    setBiometricsEnabled,
    setNotificationsEnabled,
    setAnalyticsEnabled,
    setPrivacyLevel,
    setTheme,
    setNativeCurrency,
  } = useSettingsStore(
    useShallow((state) => ({
      biometricsEnabled: state.biometricsEnabled,
      notificationsEnabled: state.notificationsEnabled,
      analyticsEnabled: state.analyticsEnabled,
      defaultPrivacyLevel: state.defaultPrivacyLevel,
      theme: state.theme,
      nativeCurrency: state.nativeCurrency,
      setBiometricsEnabled: state.setBiometricsEnabled,
      setNotificationsEnabled: state.setNotificationsEnabled,
      setAnalyticsEnabled: state.setAnalyticsEnabled,
      setPrivacyLevel: state.setPrivacyLevel,
      setTheme: state.setTheme,
      setNativeCurrency: state.setNativeCurrency,
    }))
  );
  const toast = useToast();
  const { isAvailable, authenticate } = useBiometrics();
  const [showNetworkSelector, setShowNetworkSelector] = React.useState(false);

  const privacyModeEnabled = defaultPrivacyLevel === "max";

  const shortAddress = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "Not connected";

  const handleCopyWalletAddress = async () => {
    if (!address) {
      toast.show("No wallet address available", "error");
      return;
    }

    const copied = await setClipboardString(address);
    if (!copied) {
      toast.show("Clipboard unavailable in this runtime", "error");
      return;
    }

    toast.show("Address copied to clipboard", "success");
  };

  // Handle toggle changes
  const clipboardClearTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClipboardClear = React.useCallback(() => {
    if (clipboardClearTimerRef.current) {
      clearTimeout(clipboardClearTimerRef.current);
    }

    clipboardClearTimerRef.current = setTimeout(() => {
      void setClipboardString('');
      clipboardClearTimerRef.current = null;
    }, 30000);
  }, []);

  React.useEffect(() => {
    return () => {
      if (clipboardClearTimerRef.current) {
        clearTimeout(clipboardClearTimerRef.current);
      }
    };
  }, []);

  const handleBiometricsToggle = async (value: boolean) => {
  if (value) {
      if (!isAvailable) {
        toast.show("Biometrics not available on this device", "error");
        return;
      }

      const authenticated = await authenticate();
      if (!authenticated) {
        toast.show("Biometric verification failed", "error");
        return;
      }
    }

    setBiometricsEnabled(value);
    toast.show(value ? "Biometrics enabled" : "Biometrics disabled", "success");
  };

  const handleNotificationsToggle = (value: boolean) => {
    setNotificationsEnabled(value);
    toast.show(value ? "Notifications enabled" : "Notifications disabled", "success");
  };

  const handlePrivacyModeToggle = (value: boolean) => {
    setPrivacyLevel(value ? "max" : "standard");
    toast.show(value ? "Enhanced privacy enabled" : "Enhanced privacy disabled", "success");
  };

  const handleAnalyticsToggle = (value: boolean) => {
    setAnalyticsEnabled(value);
    toast.show(value ? "Analytics enabled" : "Analytics disabled", "success");
  };

  const handleNetworkSelect = (chain: (typeof SUPPORTED_CHAINS)[number]) => {
    setActiveChain(chain);
    setShowNetworkSelector(false);
    toast.show(`Switched to ${chain.name}`, "success");
  };

  const handleCurrencyToggle = () => {
    const currencies = ['USD', 'EUR', 'GBP', 'INR'];
    const currentIndex = currencies.indexOf(nativeCurrency || 'USD');
    const nextIndex = (currentIndex + 1) % currencies.length;
    const nextCurrency = currencies[nextIndex];
    setNativeCurrency(nextCurrency);
    toast.show(`Native currency set to ${nextCurrency}`, "success");
  };
  
  const handleNavPress = (screen: keyof RootStackParamList) => {
    if (screen === SCREENS.SETTINGS) {
      // Already on settings
    } else {
      navigation.navigate(screen as never);
    }
  };

  // Handle wallet actions
  const handleBackupWallet = () => {
    navigation.navigate(SCREENS.BACKUP_WALLET);
  };
  
  const handleExportPrivateKey = () => {
    navigation.navigate(SCREENS.EXPORT_PRIVATE_KEY);
  };

  const handleClearCache = () => {
    Alert.alert("Clear Cache", "This will clear cached data. Your wallet will remain safe.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => toast.show("Cache cleared", "success"),
      },
    ]);
  };

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect Wallet",
      "Are you sure you want to disconnect? You will need your recovery phrase to reconnect.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await clearStoredMnemonic();
              disconnect();

              toast.show("Wallet disconnected", "success");
              navigation.reset({
                index: 0,
                routes: [{ name: SCREENS.ONBOARDING }],
              });
            } catch {
              toast.show("Failed to disconnect wallet securely. Please try again.", "error");
            }
          },
        },
      ]
    );
  };

  // Render settings section
  const renderSection = (title: string, items: SettingsItem[], index: number = 0) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((item) => (
        <SovereignCard
          key={item.id}
          backgroundColor={colors.surfaceCard}
          style={styles.settingsCard}
        >
          <TouchableOpacity
            onPress={item.onPress}
            style={styles.settingsItem}
            disabled={item.type === "toggle"}
            accessible={item.type !== "toggle"}
            accessibilityRole={item.type !== "toggle" ? "button" : undefined}
            accessibilityLabel={
              item.type !== "toggle"
                ? `${item.label}${item.description ? `. ${item.description}` : ""}`
                : undefined
            }
            accessibilityHint={
              item.type === "navigate"
                ? "Opens this setting"
                : item.type === "action"
                  ? "Activates this action"
                  : undefined
            }
            accessibilityState={item.type !== "toggle" ? { disabled: false } : undefined}
          >
            <View style={styles.settingsLeft}>
              <View style={[styles.iconBox, item.danger && styles.iconBoxDanger]}>
                <Icon name={item.iconName} size={20}           color={item.danger ? colors.error : colors.accent} />
              </View>
              <View style={styles.settingsText}>
                <Text style={[styles.settingsLabel, item.danger && styles.settingsLabelDanger]}>
                  {item.label}
                </Text>
                {item.description && (
                  <Text style={styles.settingsDescription}>{item.description}</Text>
                )}
              </View>
            </View>
            {item.type === "toggle" ? (
              <Switch
                value={item.value}
                onValueChange={item.onPress}
        trackColor={{ false: colors.bgContainerHigh, true: colors.accent }}
        thumbColor={item.value ? colors.textPrimary : colors.textFaint}
                accessibilityLabel={`${item.label}${item.description ? `. ${item.description}` : ""}`}
                accessibilityHint="Double tap to toggle"
              />
            ) : item.type === "navigate" ? (
              <Icon name="chevron-right" size={20} color={colors.textTertiary} />
            ) : null}
          </TouchableOpacity>
        </SovereignCard>
      ))}
    </View>
  );

  // Settings sections data
  const walletSection: SettingsItem[] = [
    {
      id: "address",
      label: "Wallet Address",
      description: shortAddress,
      iconName: "user",
      type: "action",
      onPress: () => {
        void handleCopyWalletAddress();
      },
    },
    {
      id: "network",
      label: "Active Network",
      description: activeChain?.name || "Ethereum",
      iconName: "globe",
      type: "navigate",
      onPress: () => setShowNetworkSelector(true),
    },
  ];

  const securitySection: SettingsItem[] = [
    {
      id: "biometrics",
      label: "Biometric Login",
      description: "Use Face ID or fingerprint",
      iconName: "private-lock",
      type: "toggle",
      value: biometricsEnabled,
      onPress: () => {
        void handleBiometricsToggle(!biometricsEnabled);
      },
    },
    {
      id: "backup",
      label: "Backup Wallet",
      description: "View recovery phrase",
      iconName: "export",
      type: "action",
      onPress: handleBackupWallet,
    },
    {
      id: "export",
      label: "Export Private Key",
      description: "Show private key",
      iconName: "key",
      type: "action",
      onPress: handleExportPrivateKey,
    },
  ];

  const privacySection: SettingsItem[] = [
    {
      id: "privacy-mode",
      label: "Enhanced Privacy",
      description: "Use private transactions by default",
      iconName: "private",
      type: "toggle",
      value: privacyModeEnabled,
      onPress: () => handlePrivacyModeToggle(!privacyModeEnabled),
    },
    {
      id: "notifications",
      label: "Push Notifications",
      description: "Transaction alerts",
      iconName: "bell",
      type: "toggle",
      value: notificationsEnabled,
      onPress: () => handleNotificationsToggle(!notificationsEnabled),
    },
    {
      id: "analytics",
      label: "Analytics",
      description: "Share anonymous usage data to improve Veilpay",
      iconName: "info",
      type: "toggle",
      value: analyticsEnabled,
      onPress: () => handleAnalyticsToggle(!analyticsEnabled),
    },
  ];

  const preferencesSection: SettingsItem[] = [
    {
      id: "currency",
      label: "Native Currency",
      description: `Display balances in ${nativeCurrency || 'USD'}`,
      iconName: "globe",
      type: "action",
      onPress: handleCurrencyToggle,
    },
    {
      id: "theme",
      label: "Light Mode",
      description: "Switch to Premium Ivory theme",
      iconName: "visibility",
      type: "toggle",
      value: theme === "light",
      onPress: () => {
        setTheme(theme === "light" ? "dark" : "light");
      },
    },
  ];

  const aboutSection: SettingsItem[] = [
    {
      id: "version",
      label: "Version",
      description: `${Constants.expoConfig?.version ?? '1.0.0'} (Build ${Constants.expoConfig?.android?.versionCode ?? 1})`,
      iconName: "info",
      type: "action",
      onPress: () => {},
    },
    {
      id: "terms",
      label: "Terms of Service",
      iconName: "document",
      type: "navigate",
      onPress: () => {
        void (async () => {
          const opened = await openExternalUrl('https://veilpay.app/terms');
          if (!opened) {
            toast.show('Terms page is unavailable right now', 'error');
          }
        })();
      },
    },
    {
      id: "privacy-policy",
      label: "Privacy Policy",
      iconName: "shield",
      type: "navigate",
      onPress: () => {
        void (async () => {
          const opened = await openExternalUrl('https://veilpay.app/privacy');
          if (!opened) {
            toast.show('Privacy policy page is unavailable right now', 'error');
          }
        })();
      },
    },
  ];

  const dangerSection: SettingsItem[] = [
    {
      id: "clear-cache",
      label: "Clear Cache",
      description: "Free up storage space",
      iconName: "trash",
      type: "action",
      onPress: handleClearCache,
    },
    {
      id: "disconnect",
      label: "Disconnect Wallet",
      description: "Sign out of this wallet",
      iconName: "warning",
      type: "action",
      danger: true,
      onPress: handleDisconnect,
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>SETTINGS</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Wallet Info Card */}
          <View style={{ paddingHorizontal: 24, marginTop: 20, marginBottom: 24 }}>
            <SovereignCard backgroundColor={colors.surfaceCard} style={styles.walletCard}>
              <View style={styles.walletInfo}>
                <Logo variant="manual" size="small" />
                <View style={styles.walletDetails}>
                  <Text style={styles.walletLabel}>CONNECTED WALLET</Text>
                  <Text style={styles.walletAddress}>{shortAddress}</Text>
                  <View style={styles.networkBadge}>
                    <Text style={styles.networkText}>{activeChain?.name || "Ethereum"}</Text>
                  </View>
                </View>
              </View>
            </SovereignCard>
          </View>

          {/* Settings Sections */}
          // eslint-disable-next-line no-render-in-render
          {renderSection("WALLET", walletSection, 0)}
          // eslint-disable-next-line no-render-in-render
          {renderSection("SECURITY", securitySection, 1)}
          // eslint-disable-next-line no-render-in-render
          {renderSection("PRIVACY", privacySection, 2)}
          // eslint-disable-next-line no-render-in-render
          {renderSection("PREFERENCES", preferencesSection, 3)}
          // eslint-disable-next-line no-render-in-render
          {renderSection("ABOUT", aboutSection, 4)}
          // eslint-disable-next-line no-render-in-render
          {renderSection("DANGER ZONE", dangerSection, 5)}

          <View style={{ height: 120 }} />
        </ScrollView>
      </Animated.View>

      <BottomNavBar currentScreen={SCREENS.SETTINGS} onNavigate={handleNavPress} />

      <NetworkSelectorModal
        visible={showNetworkSelector}
        activeChain={activeChain}
        chains={SUPPORTED_CHAINS}
        onSelect={handleNetworkSelect}
        onClose={() => setShowNetworkSelector(false)}
        title="SELECT ACTIVE NETWORK"
      />

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />
    </SafeAreaView>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    height: 64,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 16,
    minHeight: 44,
    justifyContent: "center",
  },
  backButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: "600",
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: "bold",
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
  },
  animatedContent: {
    flex: 1,
  },
  walletCard: {
    // Width is handled by container padding
  },
  walletInfo: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    gap: 16,
  },
  walletDetails: {
    flex: 1,
  },
  walletLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  walletAddress: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "600",
    marginBottom: 8,
  },
  networkBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  networkText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.bgPrimary,
    fontWeight: "bold",
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
      color: colors.textTertiary,
      letterSpacing: 1,
      marginBottom: 12,
  },
  settingsCard: {
    marginBottom: 8,
  },
  settingsItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  settingsLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.surfaceCard,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBoxDanger: {
    backgroundColor: colors.errorBg,
  },
  iconText: {
    fontSize: 18,
  },
  settingsText: {
    flex: 1,
  },
  settingsLabel: {
    fontFamily: typography.fontFamily.body,
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  settingsLabelDanger: {
    color: colors.error,
  },
  settingsDescription: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  chevron: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.accent,
  },
});
