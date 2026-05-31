import { StyleSheet } from "react-native";
import { typography } from "../../styles/design-tokens";

export const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    height: 64,
    borderBottomWidth: 2,
    borderBottomColor: colors.outlineSubtle,
  },
  backButton: {
    width: 80,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  backButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonText: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  animatedContent: {
    flex: 1,
  },
  testnetNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  testnetIcon: {
    fontSize: 24,
  },
  testnetNoticeText: {
    flex: 1,
    gap: 4,
  },
  testnetNoticeTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  testnetNoticeDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  faucetLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  faucetLink: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    marginTop: 4,
  },
  faucetLinkIcon: {
    marginLeft: 4,
    marginTop: 4,
  },
  faucetButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  faucetLinkDisabled: {
    color: colors.textTertiary,
  },
  statusContent: {
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  statusIcon: {
    marginBottom: 4,
  },
  statusTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  statusHash: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    opacity: 0.8,
  },
  viewExplorer: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accent,
    marginTop: 4,
  },
  explorerButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  explorerLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  viewExplorerIcon: {
    marginLeft: 4,
  },
  blockInfo: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textPrimary,
    opacity: 0.6,
    marginTop: 4,
  },
  errorText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.errorMuted,
    textAlign: 'center',
    marginTop: 8,
  },
  amountSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  amountLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  amountDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  amountValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 48,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  amountToken: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 24,
    color: colors.accent,
    fontWeight: 'bold',
  },
  usdValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textTertiary,
    marginTop: 4,
  },
  usdValueContainer: {
    alignItems: 'center',
    marginTop: 4,
  },
  priceLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 16,
  },
  usdValueLoading: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
  },
  priceUpdated: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
  },
  staleWarning: {
    color: colors.accent,
    fontStyle: 'italic',
  },
  priceErrorText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accentMuted,
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  detailsContent: {
    padding: 16,
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLeft: {
    flex: 1,
    gap: 4,
  },
  detailLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  detailValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
  },
  detailIcon: {
    fontSize: 20,
    color: colors.accent,
  },
  detailDivider: {
    height: 1,
    backgroundColor: colors.outlineSubtle,
  },
  privacyBadge: {
    backgroundColor: colors.accentContainer,
    borderWidth: 0,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  privacyBadgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
  },
  feeContent: {
    padding: 16,
    gap: 12,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feeLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
  feeValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
  },
  feeDivider: {
    height: 1,
    backgroundColor: colors.outlineSubtle,
  },
  feeLabelTotal: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  feeValueTotal: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: 'bold',
  },
  gasWarningContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  gasWarningIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accentContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  gasWarningTextWrap: {
    flex: 1,
    gap: 4,
  },
  gasWarningTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  gasWarningDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.accentLight,
    lineHeight: 18,
  },
  gasWarningMeta: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accentMuted,
  },
  privacyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  privacyNoticeIcon: {
    fontSize: 24,
  },
  privacyNoticeText: {
    flex: 1,
    gap: 4,
  },
  privacyNoticeTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  privacyNoticeDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
