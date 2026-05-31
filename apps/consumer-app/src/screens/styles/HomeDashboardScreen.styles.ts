import { StyleSheet } from "react-native";
import { typography } from "../../styles/design-tokens";

export const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerActions: {
    flexDirection: "row",
    gap: 12,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIcon: {
    fontSize: 20,
    color: colors.textMuted,
  },
  animatedContent: {
    flex: 1,
  },
  chainSelectorWrapper: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  chainSelectorContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  chainSelectorLeft: {
    gap: 4,
  },
  chainLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  chainName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.accent,
    fontWeight: "bold",
  },
  chainSelectorRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chainSymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "bold",
  },
  chainArrow: {
    fontSize: 12,
    color: colors.textMuted,
  },
  balanceCardWrapper: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  balanceContent: {
    padding: 20,
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  balanceLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  balanceAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 36,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: -0.5,
  },
  balanceCrypto: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  balanceRight: {
    alignItems: "flex-end",
    gap: 12,
  },
  visibilityBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  visibilityIcon: {
    fontSize: 20,
  },
  privacyBadge: {
    backgroundColor: colors.accentContainer,
    borderWidth: 0,
    borderColor: "transparent",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  privacyBadgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.accent,
    letterSpacing: 0.5,
    fontWeight: "bold",
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  priceLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
  priceSource: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
  },
  changeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  changePositive: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.success,
  },
  changeNegative: {
    color: colors.error,
  },
  changePlaceholder: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textTertiary,
  },
  changeLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
  },
  balanceSkeletonWrap: {
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  actionBtn: {
    alignItems: "center",
    gap: 8,
  },
  actionBtnProminent: {
    alignItems: "center",
    gap: 8,
    marginTop: -16,
  },
  actionIconCircle: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconCircleProminent: {
    width: 72,
    height: 72,
  },
  actionIcon: {
    fontSize: 22,
    color: colors.accent,
  },
  actionIconProminent: {
    fontSize: 32,
    color: colors.bgPrimary,
    fontWeight: "bold",
  },
  actionLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  actionLabelProminent: {
    color: colors.accent,
    fontWeight: "bold",
  },
  transakCardWrapper: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  transakOutcomeWrapper: {
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
    borderRadius: 16,
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
  transakIcon: {
    fontSize: 28,
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
  transakArrow: {
    fontSize: 18,
    color: colors.accent,
  },

  txRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  txIconCircle: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  txIconReceive: {
    backgroundColor: colors.successBg,
  },
  txIconSend: {
    backgroundColor: colors.errorSurface,
  },
  txIcon: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  txInfo: {
    flex: 1,
  },
  txAddress: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
  },
  txTime: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
  },
  txAmounts: {
    alignItems: "flex-end",
  },
  txAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: "bold",
  },
  txAmountPositive: {
    color: colors.success,
  },
  txAmountNegative: {
    color: colors.error,
  },
  txCrypto: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.opacityOverlay,
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: colors.surfaceScreen,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 48,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  modalClose: {
    fontSize: 20,
    color: colors.textMuted,
  },
  modalCloseButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  chainOptionContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  chainOptionLeft: {
    gap: 4,
  },
  chainOptionName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "bold",
  },
  chainOptionNameActive: {
    color: colors.bgPrimary,
  },
  chainOptionType: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  chainOptionTypeActive: {
    color: colors.outlineDefault,
  },
  chainOptionSymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: "bold",
  },
  chainOptionSymbolActive: {
    color: colors.accent,
  },
});
