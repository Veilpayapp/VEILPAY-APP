/**
 * Veilpay Transaction Details Screen
 * Displays detailed information about a specific transaction
 * Uses the current hybrid structural design language for all interactive elements
 */

import React, { useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme, useStyles, typography } from "../styles/design-tokens";
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

export function TransactionDetailsScreen({ navigation, route }: TransactionDetailsScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { transaction } = route.params;
  const { activeChain } = useWalletStore();
  const toast = useToast();

  const isSent = transaction.type === "sent";
  const amountColor = isSent ? colors.error : colors.success;
  const amountPrefix = isSent ? "-" : "+";

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

  // Format address for display
  const formatAddress = (addr: string) => {
    if (!addr) return "0x…";
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton
          onPress={() => {
            trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_BACK_PRESSED, {
              network: transaction.network || activeChain?.key || "unknown",
            });
            navigation.goBack();
          }}
        />
        <Text style={styles.headerTitle}>TRANSACTION DETAILS</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Amount Card */}
        <SovereignCard backgroundColor={colors.surfaceCard} padding={0}>
          <View style={styles.amountCard}>
{/* Type Icon */}
            <View
              style={[styles.typeIconLarge, { backgroundColor: isSent ? colors.errorBg : colors.successBg }]}
            >
              <Icon name={isSent ? "send" : "receive"} size={24} color={colors.textPrimary} />
              </View>

              {/* Amount */}
              <Text style={[styles.amountText, { color: amountColor }]}>
                {amountPrefix}
                {transaction.amount} {transaction.tokenSymbol}
              </Text>

              {/* Token Name */}
              <Text style={styles.tokenName}>{transaction.token}</Text>

              {/* Status Badge */}
              <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                <Icon name={statusInfo.iconName} size={14} color={statusInfo.color} style={styles.statusIcon} />
                <Text style={[styles.statusLabel, { color: statusInfo.color }]}>
                  {statusInfo.label}
                </Text>
              </View>

              {/* Privacy Badge */}
              {transaction.privacyLevel === "max" && (
                <View style={styles.privacyBadge}>
              <Icon name="private" size={16} color={colors.accent} />
              <Text style={styles.privacyText}>MAX Privacy</Text>
                </View>
              )}
            </View>
          </SovereignCard>

          {/* Transaction Info Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TRANSACTION INFO</Text>

            {/* From Address */}
        <SovereignCard backgroundColor={colors.surfaceCard} padding={0}>
          <View style={styles.infoRow}>
            <View style={styles.infoLabelContainer}>
              <Icon name="send" size={16} color={colors.accent} />
              <Text style={styles.infoLabel}>From</Text>
            </View>
            <View style={styles.infoValueContainer}>
              <Text style={styles.infoValue}>{formatAddress(transaction.from)}</Text>
              <TouchableOpacity
                style={styles.copyButton}
                onPress={() => handleCopyAddress(transaction.from)}
                accessibilityRole="button"
                accessibilityLabel="Copy sender address"
                accessibilityHint="Copies the sender wallet address"
              >
                <Icon name="copy" size={16} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              </View>
            </SovereignCard>

            {/* To Address */}
        <SovereignCard backgroundColor={colors.surfaceCard} padding={0}>
          <View style={styles.infoRow}>
            <View style={styles.infoLabelContainer}>
              <Icon name="receive" size={16} color={colors.accent} />
              <Text style={styles.infoLabel}>To</Text>
            </View>
            <View style={styles.infoValueContainer}>
              <Text style={styles.infoValue}>{formatAddress(transaction.to)}</Text>
              <TouchableOpacity
                style={styles.copyButton}
                onPress={() => handleCopyAddress(transaction.to)}
                accessibilityRole="button"
                accessibilityLabel="Copy recipient address"
                accessibilityHint="Copies the recipient wallet address"
              >
                <Icon name="copy" size={16} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              </View>
            </SovereignCard>

            {/* Date & Time */}
        <SovereignCard backgroundColor={colors.surfaceCard} padding={0}>
          <View style={styles.infoRow}>
            <View style={styles.infoLabelContainer}>
              <Icon name="calendar" size={16} color={colors.accent} />
                  <Text style={styles.infoLabel}>Date</Text>
                </View>
                <View style={styles.infoValueContainer}>
                  <Text style={styles.infoValue}>{formattedDate}</Text>
                  <Text style={styles.infoSubvalue}>{formattedTime}</Text>
                </View>
              </View>
            </SovereignCard>

            {/* Network */}
        <SovereignCard backgroundColor={colors.surfaceCard} padding={0}>
          <View style={styles.infoRow}>
            <View style={styles.infoLabelContainer}>
              <Icon name="globe" size={16} color={colors.accent} />
                  <Text style={styles.infoLabel}>Network</Text>
                </View>
                <View style={styles.infoValueContainer}>
                  <Text style={styles.infoValue}>{activeChain?.name || "Ethereum"}</Text>
                </View>
              </View>
            </SovereignCard>

            {/* Fee (if available) */}
            {transaction.fee && (
          <SovereignCard backgroundColor={colors.surfaceCard} padding={0}>
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Icon name="wallet" size={16} color={colors.accent} style={styles.infoIcon} />
                    <Text style={styles.infoLabel}>Network Fee</Text>
                  </View>
                  <View style={styles.infoValueContainer}>
                    <Text style={styles.infoValue}>{transaction.fee}</Text>
                  </View>
                </View>
              </SovereignCard>
            )}
          </View>

          {/* Transaction Hash Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TRANSACTION HASH</Text>

          <SovereignCard backgroundColor={colors.surfaceCard} padding={0}>
            <View style={styles.hashContainer}>
              <Text style={styles.hashLabel}>Hash</Text>
              <Text style={styles.hashValue} numberOfLines={2} selectable>
                {transaction.hash}
              </Text>
              <View style={styles.hashActions}>
                <TouchableOpacity
                  style={styles.hashActionButton}
                  onPress={handleCopyHash}
                  accessibilityRole="button"
                  accessibilityLabel="Copy transaction hash"
                  accessibilityHint="Copies the full transaction hash"
                >
                  <Icon name="copy" size={16} color={colors.accent} />
                  <Text style={styles.hashActionText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.hashActionButton}
                  onPress={handleViewOnExplorer}
                  accessibilityRole="button"
                  accessibilityLabel="View on block explorer"
                  accessibilityHint="Opens the transaction on the chain explorer"
                >
                  <Icon name="link" size={16} color={colors.accent} />
                    <Text style={styles.hashActionText}>View on Explorer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </SovereignCard>
          </View>

          {/* Privacy Notice */}
          {transaction.privacyLevel === "max" && (
            <View style={styles.section}>
          <SovereignCard backgroundColor={colors.successBg} padding={0}>
            <View style={styles.privacyNotice}>
              <Icon name="private-lock" size={24} color={colors.success} />
                  <View style={styles.privacyNoticeContent}>
                    <Text style={styles.privacyNoticeTitle}>Private Transaction</Text>
                    <Text style={styles.privacyNoticeText}>
                      This transaction was sent with MAX privacy using stealth addresses. The
                      recipient's identity is protected.
                    </Text>
                  </View>
                </View>
              </SovereignCard>
            </View>
          )}

          {/* Bottom spacing */}
          <View style={styles.bottomSpacing} />
        </ScrollView>
      </Animated.View>

      {/* Toast */}
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
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  scrollView: {
    flex: 1,
  },
  animatedContent: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  amountCard: {
    alignItems: "center",
    padding: 32,
    marginTop: 8,
  },
  typeIconLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  typeIconTextLarge: {
    fontSize: 32,
    color: colors.textPrimary,
  },
  amountText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 36,
    fontWeight: "bold",
    marginBottom: 4,
  },
  tokenName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 8,
  },
  statusIcon: {
    marginRight: 6,
  },
  statusLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  privacyBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.successBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  privacyIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  privacyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.success,
    fontWeight: "bold",
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: "bold",
    letterSpacing: 1,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  infoLabelContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  infoIcon: {
    marginRight: 8,
  },
  infoLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
  },
  infoValueContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  infoValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
  },
  infoSubvalue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 8,
  },
  copyButton: {
    marginLeft: 8,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  copyIcon: {
    fontSize: 14,
  },
  hashContainer: {
    padding: 16,
  },
  hashLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  hashValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    lineHeight: 18,
    marginBottom: 16,
  },
  hashActions: {
    flexDirection: "row",
    gap: 12,
  },
  hashActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceCard,
    paddingVertical: 12,
    borderRadius: 8,
  },
  hashActionIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  hashActionText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: "bold",
  },
  privacyNotice: {
    flexDirection: "row",
    padding: 16,
  },
  privacyNoticeIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  privacyNoticeContent: {
    flex: 1,
  },
  privacyNoticeTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.success,
    fontWeight: "bold",
    marginBottom: 4,
  },
  privacyNoticeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  bottomSpacing: {
    height: 32,
  },
});

export default TransactionDetailsScreen;
