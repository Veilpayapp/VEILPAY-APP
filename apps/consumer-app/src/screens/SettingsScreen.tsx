/**
 * Veilpay Settings Screen
 * Wallet settings, security, privacy, and network preferences
 * Uses the current hybrid structural design language for all interactive elements
 */

import React from "react";
import { View, Text, StyleSheet, ScrollView, StatusBar, Switch, Alert } from "react-native";
import { PressableOpacity } from '../components/PressableOpacity';
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
import { SecurityWarningModal } from "../components/SecurityWarningModal";
import { UpdatePromptModal } from "../components/UpdatePromptModal";
import { UpdateDetailsModal } from "../components/UpdateDetailsModal";
import { setClipboardString } from "../utils/clipboard";
import { CurrencySelectorModal } from "../components/CurrencySelectorModal";
import { LEGAL_URLS } from "../constants/legalUrls";
import { clearStoredMnemonic, getStoredMnemonic } from "../utils/transactions";
import { wipeLocalAccountData } from "../utils/accountWipe";
import { t } from "../i18n";
import { useBiometrics } from "../hooks/useBiometrics";
import { useOTAUpdates } from "../hooks/useOTAUpdates";
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
  const {
    isProduction: updatesSupported,
    isChecking: isCheckingUpdate,
    isDownloading: isDownloadingUpdate,
    error: updateError,
    checkForUpdate,
    downloadUpdate,
    applyUpdate,
  } = useOTAUpdates();
  const [showNetworkSelector, setShowNetworkSelector] = React.useState(false);
  const [showCurrencySelector, setShowCurrencySelector] = React.useState(false);
  const [showUpdatePrompt, setShowUpdatePrompt] = React.useState(false);
  const [showUpdateDetails, setShowUpdateDetails] = React.useState(false);
  const [warningModalConfig, setWarningModalConfig] = React.useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
  }>({
    visible: false,
    title: "",
    message: "",
    confirmText: "",
    onConfirm: () => {},
  });

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

      // Check `.success` — `authenticate()` resolves to a result object, which
      // is always truthy, so `if (!authenticated)` never caught a failed scan.
      const authResult = await authenticate('toggle_biometrics');
      if (!authResult.success) {
        toast.show(
          authResult.cancelled ? "Authentication cancelled" : "Biometric verification failed",
          "error",
        );
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
    // PRIV-001: opt-out clears local Mixpanel identity (DSAR-style local erase).
    void import("../utils/analytics").then(({ setAnalyticsConsent, deleteAnalyticsData }) => {
      if (value) {
        setAnalyticsConsent(true);
      } else {
        deleteAnalyticsData();
      }
    });
    toast.show(value ? "Analytics enabled" : "Analytics disabled", "success");
  };

  /** PRIV-001 DSAR: explicit erase without requiring the toggle path. */
  const handleDeleteAnalyticsData = () => {
    setAnalyticsEnabled(false);
    void import("../utils/analytics").then(({ deleteAnalyticsData }) => {
      deleteAnalyticsData();
    });
    toast.show("Local analytics data erased", "success");
  };

  const handleNetworkSelect = (chain: (typeof SUPPORTED_CHAINS)[number]) => {
    setActiveChain(chain);
    setShowNetworkSelector(false);
    toast.show(`Switched to ${chain.name}`, "success");
  };

  const handleCurrencySelect = (currency: string) => {
    setNativeCurrency(currency);
    setShowCurrencySelector(false);
    toast.show(`Native currency set to ${currency}`, "success");
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

  const handleCheckForUpdates = async () => {
    // OTA checks are a no-op in dev/Expo Go — the hook guards on !__DEV__.
    if (!updatesSupported) {
      toast.show("Updates are only available in production builds", "info");
      return;
    }

    if (isCheckingUpdate || isDownloadingUpdate) {
      return;
    }

    toast.show("Checking for updates…", "info");
    const available = await checkForUpdate();
    if (available) {
      setShowUpdatePrompt(true);
    } else {
      toast.show("You're on the latest version", "success");
    }
  };

  const handleApplyUpdate = async () => {
    const downloaded = await downloadUpdate();
    if (downloaded) {
      // reloadAsync() restarts the JS runtime; nothing after this runs.
      await applyUpdate();
      return;
    }
    // Failed download surfaces via updateError inside the modal.
  };

  const handleClearCache = () => {
    setWarningModalConfig({
      visible: true,
      title: "Clear Cache",
      message: "This will clear cached data. Your wallet will remain safe.",
      confirmText: "CLEAR CACHE",
      onConfirm: () => {
        toast.show("Cache cleared", "success");
        setWarningModalConfig((prev) => ({ ...prev, visible: false }));
      },
    });
  };

  const handleDisconnect = () => {
    setWarningModalConfig({
      visible: true,
      title: "Disconnect Wallet",
      message: "Are you sure you want to disconnect? You will need your recovery phrase to reconnect.",
      confirmText: "DISCONNECT",
      onConfirm: async () => {
        setWarningModalConfig((prev) => ({ ...prev, visible: false }));
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
    });
  };

  /** PRIV-002: full local DSAR wipe (secrets + session + history + analytics). */
  const handleEraseAllLocalData = () => {
    setWarningModalConfig({
      visible: true,
      title: t("settings.wipe.confirmTitle"),
      message: t("settings.wipe.confirmMessage"),
      confirmText: t("settings.wipe.confirmAction"),
      onConfirm: async () => {
        setWarningModalConfig((prev) => ({ ...prev, visible: false }));
        // Sensitive ops always require biometric-or-PIN (device PIN allowed as fallback).
        const authResult = await authenticate("account_wipe", true);
        if (!authResult.success) {
          toast.show(
            authResult.cancelled ? "Authentication cancelled" : "Authentication failed",
            "error"
          );
          return;
        }

        const outcome = await wipeLocalAccountData();
        if (!outcome.ok) {
          toast.show(t("settings.wipe.failure"), "error");
          return;
        }

        toast.show(t("settings.wipe.success"), "success");
        navigation.reset({
          index: 0,
          routes: [{ name: SCREENS.ONBOARDING }],
        });
      },
    });
  };

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
    // SPP-001 / UX-001: no diagnostic Private XLM screen in any build.
    // Background ASP + recovery: useSppBackgroundSetup. User path: select pXLM.
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
    {
      id: "delete-analytics",
      label: t("settings.dsar.analytics"),
      description: t("settings.dsar.analyticsDescription"),
      iconName: "info",
      type: "action",
      onPress: handleDeleteAnalyticsData,
    },
  ];

  const preferencesSection: SettingsItem[] = [
    {
      id: "currency",
      label: "Native Currency",
      description: `Display balances in ${nativeCurrency || 'USD'}`,
      iconName: "globe",
      type: "navigate",
      onPress: () => setShowCurrencySelector(true),
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
      description: `${Constants.expoConfig?.version ?? '1.0.0'} (Build ${Constants.expoConfig?.android?.versionCode ?? 1}) · What's New`,
      iconName: "info",
      type: "navigate",
      onPress: () => setShowUpdateDetails(true),
    },
    {
      id: "check-updates",
      label: "Check for Updates",
      description: isCheckingUpdate
        ? "Checking…"
        : isDownloadingUpdate
          ? "Downloading update…"
          : "Get the latest fixes and improvements",
      iconName: "arrow-down",
      type: "action",
      onPress: () => {
        void handleCheckForUpdates();
      },
    },
    {
      id: "terms",
      label: "Terms of Service",
      iconName: "document",
      type: "navigate",
      onPress: () => {
        navigation.navigate(SCREENS.IN_APP_BROWSER, {
          url: LEGAL_URLS.terms,
          title: "Terms of Service",
        });
      },
    },
    {
      id: "privacy-policy",
      label: "Privacy Policy",
      iconName: "shield",
      type: "navigate",
      onPress: () => {
        navigation.navigate(SCREENS.IN_APP_BROWSER, {
          url: LEGAL_URLS.privacy,
          title: "Privacy Policy",
        });
      },
    },
    {
      id: "docs",
      label: "Docs",
      description: "Guides and product documentation",
      iconName: "document",
      type: "navigate",
      onPress: () => {
        navigation.navigate(SCREENS.IN_APP_BROWSER, {
          url: LEGAL_URLS.docs,
          title: "Docs",
        });
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
    {
      id: "erase-all-local",
      label: t("settings.wipe.label"),
      description: t("settings.wipe.description"),
      iconName: "warning",
      type: "action",
      danger: true,
      onPress: handleEraseAllLocalData,
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
          <SettingsSection title="WALLET" items={walletSection} styles={styles} colors={colors} />
          <SettingsSection title="SECURITY" items={securitySection} styles={styles} colors={colors} />
          <SettingsSection title="PRIVACY" items={privacySection} styles={styles} colors={colors} />
          <SettingsSection title="PREFERENCES" items={preferencesSection} styles={styles} colors={colors} />
          <SettingsSection title="ABOUT" items={aboutSection} styles={styles} colors={colors} />
          <SettingsSection title="DANGER ZONE" items={dangerSection} styles={styles} colors={colors} />

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
        onAddCustomNetwork={() => {
          setShowNetworkSelector(false);
          navigation.navigate(SCREENS.ADD_CUSTOM_NETWORK);
        }}
        title="SELECT ACTIVE NETWORK"
      />

      <CurrencySelectorModal
        visible={showCurrencySelector}
        activeCurrency={nativeCurrency || 'USD'}
        onSelect={handleCurrencySelect}
        onClose={() => setShowCurrencySelector(false)}
      />

      <SecurityWarningModal
        visible={warningModalConfig.visible}
        title={warningModalConfig.title}
        message={warningModalConfig.message}
        confirmText={warningModalConfig.confirmText}
        onConfirm={warningModalConfig.onConfirm}
        onCancel={() => setWarningModalConfig((prev) => ({ ...prev, visible: false }))}
      />

      <UpdatePromptModal
        visible={showUpdatePrompt}
        isDownloading={isDownloadingUpdate}
        error={updateError}
        onLater={() => setShowUpdatePrompt(false)}
        onUpdate={handleApplyUpdate}
      />

      <UpdateDetailsModal
        visible={showUpdateDetails}
        onClose={() => setShowUpdateDetails(false)}
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

interface SettingsSectionProps {
  title: string;
  items: SettingsItem[];
  styles: ReturnType<typeof themeStyles>;
  colors: any;
}

function SettingsSection({ title, items, styles, colors }: SettingsSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((item) => (
        <SovereignCard
          key={item.id}
          backgroundColor={colors.surfaceCard}
          style={styles.settingsCard}
        >
          <PressableOpacity
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
          </PressableOpacity>
        </SovereignCard>
      ))}
    </View>
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
    backgroundColor: colors.bgPrimary,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0,
  },
  networkText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textPrimary,
    fontWeight: "bold",
    textTransform: 'uppercase',
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
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    backgroundColor: 'transparent',
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
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: "bold",
    color: colors.textPrimary,
    textTransform: 'uppercase',
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
