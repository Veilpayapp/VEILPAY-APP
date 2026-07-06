import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PressableOpacity } from '../PressableOpacity';
import { useTheme, useStyles, typography } from "../../styles/design-tokens";
import { SovereignCard } from "../SovereignCard";
import { Icon } from "../Icon";

interface FiatGatewayCardProps {
  onOpenFiatGateway: () => void;
  visibleTransakOrder: any;
  transakOrderMeta: any;
  visibleOnrampOrder: any;
  onrampOrderMeta: any;
  clearLatestTransakOrder: () => void;
  clearLatestOnrampOrder: () => void;
  formatTransakAmount: (value?: string, currency?: string) => string | null;
}

export function FiatGatewayCard({
  onOpenFiatGateway,
  visibleTransakOrder,
  transakOrderMeta,
  visibleOnrampOrder,
  onrampOrderMeta,
  clearLatestTransakOrder,
  clearLatestOnrampOrder,
  formatTransakAmount,
}: FiatGatewayCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
    <>
      {/* Fiat Gateway Card */}
      <View style={styles.transakCardWrapper}>
        <PressableOpacity
          onPress={onOpenFiatGateway}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Buy or sell crypto"
          accessibilityHint="Opens the buy or sell chooser for the in-app fiat gateway"
        >
          <SovereignCard backgroundColor={colors.bgSecondary} padding={0}>
            <View style={styles.transakContent}>
              <Icon name="card" size={24} color={colors.accent} />
              <View style={styles.transakInfo}>
                <Text style={styles.transakTitle}>FIAT GATEWAY</Text>
                <Text style={styles.transakSub}>Buy/Sell crypto via VeilPay Aggregator</Text>
              </View>
              <Icon name="chevron-right" size={20} color={colors.accent} />
            </View>
          </SovereignCard>
        </PressableOpacity>
      </View>

      {visibleTransakOrder && transakOrderMeta ? (
        <View style={styles.transakOutcomeWrapper}>
          <SovereignCard
            backgroundColor={colors.surfaceCard}
            borderRadius={24}
          >
            <View style={styles.transakOutcomeContent}>
              <View style={[styles.transakOutcomeIcon, { backgroundColor: transakOrderMeta.tint }]}>
                <Icon name={transakOrderMeta.icon} size={20} color={transakOrderMeta.accent} />
              </View>
              <View style={styles.transakOutcomeCopy}>
                <Text style={styles.transakOutcomeTitle}>{transakOrderMeta.title}</Text>
                <Text style={styles.transakOutcomeStatus}>{transakOrderMeta.label}</Text>
                <Text style={styles.transakOutcomeMeta}>
                  {formatTransakAmount(visibleTransakOrder.cryptoAmount, visibleTransakOrder.cryptoCurrency) ?? 'Awaiting final amounts'}
                  {visibleTransakOrder.orderId ? ` • Order ${visibleTransakOrder.orderId}` : ''}
                </Text>
              </View>
              <PressableOpacity
                onPress={clearLatestTransakOrder}
                style={styles.transakOutcomeDismiss}
              >
                <Icon name="close" size={18} color={colors.textMuted} />
              </PressableOpacity>
            </View>
          </SovereignCard>
        </View>
      ) : null}

      {visibleOnrampOrder && onrampOrderMeta ? (
        <View style={styles.transakOutcomeWrapper}>
          <SovereignCard
            backgroundColor={colors.surfaceCard}
            borderRadius={24}
          >
            <View style={styles.transakOutcomeContent}>
              <View style={[styles.transakOutcomeIcon, { backgroundColor: onrampOrderMeta.tint }]}>
                <Icon name={onrampOrderMeta.icon} size={20} color={onrampOrderMeta.accent} />
              </View>
              <View style={styles.transakOutcomeCopy}>
                <Text style={styles.transakOutcomeTitle}>{onrampOrderMeta.title}</Text>
                <Text style={styles.transakOutcomeStatus}>{onrampOrderMeta.label}</Text>
                <Text style={styles.transakOutcomeMeta}>
                  {visibleOnrampOrder.fiatAmount} {visibleOnrampOrder.fiatCurrency} • {visibleOnrampOrder.cryptoToken}
                </Text>
              </View>
              <PressableOpacity
                onPress={clearLatestOnrampOrder}
                style={styles.transakOutcomeDismiss}
              >
                <Icon name="close" size={18} color={colors.textMuted} />
              </PressableOpacity>
            </View>
          </SovereignCard>
        </View>
      ) : null}
    </>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  transakCardWrapper: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  transakOutcomeWrapper: {
    // Horizontal inset lives on the wrapper (not as marginHorizontal on the
    // card) because SovereignCard's surface is width: "100%". A horizontal
    // margin on a 100%-wide box overflows the parent by 2× the margin, which
    // pushed the pending-order card off the right edge of the screen.
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  transakOutcomeContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  transakOutcomeIcon: {
    width: 48,
    height: 48,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  transakOutcomeCopy: {
    flex: 1,
  },
  transakOutcomeTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  transakOutcomeStatus: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 3,
  },
  transakOutcomeMeta: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 4,
  },
  transakOutcomeDismiss: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  transakContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  transakInfo: {
    flex: 1,
  },
  transakTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  transakSub: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
});
