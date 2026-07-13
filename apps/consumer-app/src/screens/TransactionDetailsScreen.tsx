/**
 * Veilpay Transaction Details Screen
 * Displays detailed information about a specific transaction
 * Uses the current hybrid structural design language for all interactive elements
 */

import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, StatusBar, Linking } from "react-native";
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { useWalletStore, SUPPORTED_CHAINS } from "../stores/walletStore";
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from "../components/Toast";
import { Icon } from "../components/Icon";
import { ScreenBackButton } from "../components/ScreenBackButton";
import { setClipboardString } from "../utils/clipboard";
import { trackEvent } from "../utils/analytics";
import { ANALYTICS_EVENTS } from "../utils/analyticsEvents";
import { getTransactionExplorerUrl } from "../utils/transactionHistory";
import type { TransactionRecord } from "../types/transactions";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";

type TransactionDetailsNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "TransactionDetails"
>;
type TransactionDetailsRouteProp = RouteProp<RootStackParamList, "TransactionDetails">;

interface TransactionDetailsScreenProps {
  navigation: TransactionDetailsNavigationProp;
  route: TransactionDetailsRouteProp;
}

// Format address for display
const formatAddress = (addr: string) => {
  if (!addr) return "0x…";
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
};

export function TransactionDetailsScreen({ navigation, route }: TransactionDetailsScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { transaction } = route.params;
  const { activeChain } = useWalletStore();
  const toast = useToast();

  const isSent = transaction.type === "sent";
  const amountColor = isSent ? colors.error : colors.success;
  const amountPrefix = isSent ? "-" : "+";
  const isPrivate = transaction.privacyLevel === "max" || transaction.privacyLevel === "private";
  const transactionTitle = transaction.displayTitle || (isSent ? "SENT" : "RECEIVED");
  const explorerLabel = transaction.explorerLabel || "EXPLORER";

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_VIEWED, {
      transaction_type: transaction.type,
      transaction_status: transaction.status,
      token_symbol: transaction.tokenSymbol,
      privacy_level: transaction.privacyLevel || "standard",
      network: transaction.network || activeChain?.key || "unknown",
    });
  }, [
    activeChain?.key,
    transaction.network,
    transaction.privacyLevel,
    transaction.status,
    transaction.tokenSymbol,
    transaction.type,
  ]);

  // Format timestamp to readable date
  const formattedDate = useMemo(() => {
    const date = new Date(transaction.timestamp);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [transaction.timestamp]);

  // Format timestamp to time
  const formattedTime = useMemo(() => {
    const date = new Date(transaction.timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [transaction.timestamp]);

  // Get explorer URL for the transaction
  const getExplorerUrl = () => {
    const chainKey = transaction.network || activeChain?.key;
    if (!chainKey || !transaction.hash) return null;
    const url = getTransactionExplorerUrl(transaction.hash, chainKey);
    return url || null;
  };

  // Open block explorer
  const handleViewOnExplorer = () => {
    const url = getExplorerUrl();
    if (url) {
      trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_VIEW_EXPLORER_PRESSED, {
        network: transaction.network || activeChain?.key || "unknown",
      });
      Linking.openURL(url).catch(() => {
        trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_VIEW_EXPLORER_FAILED, {
          reason: "open_url_failed",
          network: transaction.network || activeChain?.key || "unknown",
        });
        toast.show("Could not open explorer", "error");
      });
    }
  };

  // Copy address to clipboard
  const handleCopyAddress = async (address: string) => {
    try {
      const copied = await setClipboardString(address);
      if (!copied) {
        trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_COPY_FAILED, {
          target: "address",
          reason: "clipboard_unavailable",
        });
        toast.show("Clipboard unavailable in this runtime", "error");
        return;
      }

      trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_COPY_SUCCESS, {
        target: "address",
      });

      toast.show("Address copied to clipboard", "success");
    } catch {
      trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_COPY_FAILED, {
        target: "address",
        reason: "copy_error",
      });
      toast.show("Failed to copy address", "error");
    }
  };

  // Copy transaction hash
  const handleCopyHash = async () => {
    try {
      const copied = await setClipboardString(transaction.hash);
      if (!copied) {
        trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_COPY_FAILED, {
          target: "hash",
          reason: "clipboard_unavailable",
        });
        toast.show("Clipboard unavailable in this runtime", "error");
        return;
      }

      trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_COPY_SUCCESS, {
        target: "hash",
      });

      toast.show("Transaction hash copied", "success");
    } catch {
      trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_COPY_FAILED, {
        target: "hash",
        reason: "copy_error",
      });
      toast.show("Failed to copy hash", "error");
    }
  };

  // Get status icon and color
  const getStatusInfo = () => {
    switch (transaction.status) {
      case "completed":
      return { iconName: "success" as const, color: colors.success, bg: colors.successBg, label: "Completed" };
    case "pending":
      return { iconName: "hourglass" as const, color: colors.accent, bg: colors.warningBg, label: "Pending" };
    case "failed":
      return { iconName: "error" as const, color: colors.error, bg: colors.errorBg, label: "Failed" };
    default:
      return { iconName: "info" as const, color: colors.textMuted, bg: colors.bgContainerHigh, label: "Unknown" };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Hero Header */}
      <View style={styles.header}>
        <ScreenBackButton
          onPress={() => {
            trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_BACK_PRESSED, {
              network: transaction.network || activeChain?.key || "unknown",
            });
            navigation.goBack();
          }}
        />
        <View style={styles.headerRight}>
          <View style={[styles.statusTag, { borderColor: statusInfo.color }]}>
            <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
            <Text style={[styles.statusTagText, { color: statusInfo.color }]}>{statusInfo.label.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Massive Dynamic Hero Section */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.heroSection}>
          <View style={styles.heroWatermarkContainer}>
            <Icon name={transaction.isPrivatePoolTx ? "private-lock" : isSent ? "send" : "receive"} size={240} color={colors.accent} style={styles.heroWatermark} />
          </View>
          <Text style={styles.heroTitle}>{transactionTitle}</Text>
          <Text style={styles.heroPrefix}>{amountPrefix}</Text>
          <Text style={[styles.heroAmount, { color: amountColor }]} adjustsFontSizeToFit numberOfLines={1}>
            {transaction.amount}
          </Text>
          <Text style={styles.heroToken}>{transaction.tokenSymbol}</Text>
        </Animated.View>

        {/* Data Receipt Ledger */}
        <View style={styles.ledgerContainer}>
          <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>FROM</Text>
            <View style={styles.ledgerValueGroup}>
              <Text style={styles.ledgerValue}>{formatAddress(transaction.from)}</Text>
              <PressableOpacity style={styles.ledgerCopyBtn} onPress={() => handleCopyAddress(transaction.from)}>
                <Icon name="copy" size={14} color={colors.accent} />
              </PressableOpacity>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(250)} style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>TO</Text>
            <View style={styles.ledgerValueGroup}>
              <Text style={styles.ledgerValue}>{formatAddress(transaction.to)}</Text>
              <PressableOpacity style={styles.ledgerCopyBtn} onPress={() => handleCopyAddress(transaction.to)}>
                <Icon name="copy" size={14} color={colors.accent} />
              </PressableOpacity>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>TIMESTAMP</Text>
            <View style={styles.ledgerValueGroupCol}>
              <Text style={styles.ledgerValue}>{formattedDate}</Text>
              <Text style={styles.ledgerSubValue}>{formattedTime}</Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(350)} style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>NETWORK</Text>
            <Text style={styles.ledgerValue}>{activeChain?.name?.toUpperCase() || "ETHEREUM"}</Text>
          </Animated.View>

          {transaction.fee && (
            <Animated.View entering={FadeInDown.duration(400).delay(400)} style={styles.ledgerRow}>
              <Text style={styles.ledgerLabel}>NETWORK FEE</Text>
              <Text style={styles.ledgerValue}>{transaction.fee}</Text>
            </Animated.View>
          )}

          <Animated.View entering={FadeInDown.duration(400).delay(450)} style={[styles.ledgerRow, styles.ledgerRowLast]}>
            <Text style={styles.ledgerLabel}>TX HASH</Text>
            <View style={styles.ledgerHashGroup}>
              <Text style={styles.ledgerHashValue} numberOfLines={1} ellipsizeMode="middle">{transaction.hash}</Text>
              <View style={styles.ledgerHashActions}>
                <PressableOpacity style={styles.ledgerToggleBtn} onPress={handleCopyHash}>
                  <Icon name="copy" size={12} color={colors.bgPrimary} />
                  <Text style={styles.ledgerToggleText}>COPY</Text>
                </PressableOpacity>
                <PressableOpacity style={styles.ledgerToggleBtnOutline} onPress={handleViewOnExplorer}>
                  <Icon name="link" size={12} color={colors.accent} />
                  <Text style={styles.ledgerToggleTextOutline}>{explorerLabel.toUpperCase()}</Text>
                </PressableOpacity>
              </View>
            </View>
          </Animated.View>
        </View>

        {/* Privacy Notice */}
        {isPrivate && (
          <Animated.View entering={FadeInDown.duration(400).delay(550)} style={styles.privacyNoticeContainer}>
            <View style={styles.privacyHazardTape} />
            <View style={styles.privacyContent}>
              <Icon name="private-lock" size={24} color={colors.success} />
              <View style={styles.privacyTextGroup}>
                <Text style={styles.privacyTitle}>
                  {transaction.privacyLevel === "private" ? "PRIVATE XLM ACTIVE" : "MAX PRIVACY ACTIVE"}
                </Text>
                <Text style={styles.privacyText}>
                  {transaction.privacyLevel === "private"
                    ? transaction.displaySubtitle || "SPP pool proof transaction. Explorer shows Soroban proof data, not a public payment row."
                    : "Stealth addresses used. Recipient identity protected."}
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        <View style={styles.bottomSpacing} />
      </ScrollView>
      {/* Toast */}
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onDismiss={toast.hide} />
    </SafeAreaView>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
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
    zIndex: 10,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusTag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0,
    borderWidth: 1,
    backgroundColor: colors.surfaceScreen,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 0,
    marginRight: 6,
  },
  statusTagText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  heroSection: {
    position: 'relative',
    marginTop: 20,
    marginBottom: 40,
    paddingVertical: 20,
  },
  heroTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.accent,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  heroWatermarkContainer: {
    position: 'absolute',
    right: -40,
    top: -40,
    opacity: 0.04,
    transform: [{ rotate: '-15deg' }],
  },
  heroWatermark: {},
  heroPrefix: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 24,
    color: colors.textMuted,
    marginBottom: -10,
  },
  heroAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 64,
  },
  heroToken: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.accent,
    fontWeight: "bold",
    letterSpacing: 2,
    marginTop: 4,
  },
  ledgerContainer: {
    borderWidth: 1,
    borderColor: colors.accent + '30',
    borderRadius: 0,
    backgroundColor: colors.surfaceCard,
    boxShadow: '0px 4px 8px rgba(0,0,0,0.03)',
  },
  ledgerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent + '15',
  },
  ledgerRowLast: {
    flexDirection: "column",
    borderBottomWidth: 0,
  },
  ledgerLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginTop: 2,
  },
  ledgerValueGroup: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    justifyContent: "flex-end",
  },
  ledgerValueGroupCol: {
    alignItems: "flex-end",
  },
  ledgerValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: "right",
  },
  ledgerSubValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  ledgerCopyBtn: {
    padding: 8,
    marginLeft: 8,
    backgroundColor: colors.accent + '10',
    borderRadius: 0,
  },
  ledgerHashGroup: {
    marginTop: 16,
    width: '100%',
  },
  ledgerHashValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceScreen,
    padding: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.accent + '15',
    overflow: 'hidden',
  },
  ledgerHashActions: {
    flexDirection: "row",
    marginTop: 12,
    gap: 12,
  },
  ledgerToggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: 0,
    gap: 8,
  },
  ledgerToggleText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.bgPrimary,
    fontWeight: "900",
    letterSpacing: 1,
  },
  ledgerToggleBtnOutline: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: 12,
    borderRadius: 0,
    gap: 8,
  },
  ledgerToggleTextOutline: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accent,
    fontWeight: "900",
    letterSpacing: 1,
  },
  privacyNoticeContainer: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  privacyHazardTape: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: 4,
    backgroundColor: colors.success,
  },
  privacyContent: {
    flexDirection: 'row',
    padding: 20,
    alignItems: 'center',
    backgroundColor: colors.success + '15',
  },
  privacyTextGroup: {
    marginLeft: 16,
    flex: 1,
  },
  privacyTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.success,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 4,
  },
  privacyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textPrimary,
    lineHeight: 16,
    opacity: 0.9,
  },
  bottomSpacing: {
    height: 60,
  },
});

