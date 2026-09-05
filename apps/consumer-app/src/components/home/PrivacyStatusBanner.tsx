/**
 * PrivacyStatusBanner — Premium SPP status surface for the balance card.
 *
 * Replaces the raw `privacyStatusDetail` text with a structured, Freighter-inspired
 * status banner that conveys setup progress, errors, and readiness with visual
 * clarity and micro-animations.
 *
 * States:
 * - setting_up → pulsing amber bar with step label
 * - error      → subtle error surface with actionable hint
 * - ready      → brief fade-in confirmation, then hides
 * - syncing    → indeterminate progress with sync copy
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Icon, type IconName } from '../Icon';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import type { PrivacyReadyStatus } from './DashboardBalanceCard';

export type PrivacyBannerVariant = 'setting_up' | 'syncing' | 'error' | 'fund_needed' | 'ready' | 'info';

export interface PrivacyStatusBannerProps {
  /** Current readiness status from the balance card. */
  readyStatus: PrivacyReadyStatus;
  /** Raw status detail string from the setup/sync flow. */
  statusDetail: string | null;
  /** Whether private mode is active. */
  privacyMode: boolean;
  /** Network qualifier for network-ambiguous copy ('TESTNET' | 'MAINNET'). */
  networkLabel?: string;
  /** Clears transient success/info copy after its quiet confirmation window. */
  onDismiss?: () => void;
}

/**
 * Classify the raw status detail + readyStatus into a visual variant.
 */
function classifyBanner(
  readyStatus: PrivacyReadyStatus,
  detail: string | null,
  networkLabel?: string
): { variant: PrivacyBannerVariant; icon: IconName; label: string; sublabel?: string } | null {
  const qual = networkLabel ? ` · ${networkLabel}` : '';
  if (!detail && readyStatus === 'ready') return null; // fully ready, hide banner
  if (!detail && !readyStatus) return null;

  // Prove-ready confirmation. Must be matched before the generic `/sync/`
  // classifier below, otherwise the "Sync ready" detail set by the home
  // readiness gate renders as an indeterminate spinner — i.e. the banner
  // would claim it is still syncing at the exact moment sync completed.
  if (
    readyStatus === 'ready' &&
    /sync ready|ready for private|private xlm ready/i.test(detail || '')
  ) {
    return {
      variant: 'ready',
      icon: 'success',
      label: `Private XLM ready${qual}`,
      sublabel: 'Sync complete — private sends enabled',
    };
  }

  // Prove-readiness is authoritative and sticky. A later best-effort balance
  // refresh can still hit a transient RPC/network error, but that must not
  // replace the confirmed ready state with the contradictory red
  // "Sync unavailable" banner. Keep the useful distinction in quiet copy;
  // diagnostics retain the underlying transport failure for troubleshooting.
  if (
    readyStatus === 'ready' &&
    /sync failed|network error|error sending|unreachable|timed out/i.test(detail || '')
  ) {
    return {
      variant: 'info',
      icon: 'success',
      label: `Private XLM ready${qual}`,
      sublabel: 'Latest balance refresh was unavailable',
    };
  }

  // Fund needed — highest priority actionable state
  if (/not funded|send at least|fund.*account|2 xlm/i.test(detail || '')) {
    return {
      variant: 'fund_needed',
      icon: 'wallet',
      label: 'Account needs funding',
      sublabel: 'Send at least 2 XLM to activate private payments',
    };
  }

  // Network / sync error
  if (/sync failed|network error|error sending|unreachable|timed out/i.test(detail || '')) {
    return {
      variant: 'error',
      icon: 'warning',
      label: 'Sync unavailable',
      sublabel: 'Check your connection and try again',
    };
  }

  // ASP leaf insert pending (the main issue from screenshots)
  if (/ASP leaf ready|on-chain insert pending/i.test(detail || '')) {
    return {
      variant: 'setting_up',
      icon: 'key',
      label: 'Registering privacy membership',
      sublabel: 'One-time on-chain registration in progress',
    };
  }

  // Publishing receive keys
  if (/publish.*key|receive key/i.test(detail || '')) {
    return {
      variant: 'setting_up',
      icon: 'shield',
      label: 'Publishing receive keys',
      sublabel: 'Other wallets will be able to send you private payments',
    };
  }

  // Pool-ops build needed
  if (/pool-ops build|native.*not linked/i.test(detail || '')) {
    return {
      variant: 'error',
      icon: 'info',
      label: 'App update required',
      sublabel: 'Private sends require a newer app build',
    };
  }

  // Restored balance
  if (/restored/i.test(detail || '')) {
    return {
      variant: 'ready',
      icon: 'success',
      label: detail || 'Balance restored',
    };
  }

  // Generic setup
  if (readyStatus === 'setting_up' || /setting up/i.test(detail || '')) {
    return {
      variant: 'setting_up',
      icon: 'shield',
      label: `Setting up private account${qual}`,
      sublabel: 'This only happens once per network',
    };
  }

  // Unavailable
  if (readyStatus === 'unavailable') {
    return {
      variant: 'error',
      icon: 'info',
      label: 'Private sends unavailable',
      sublabel: detail || undefined,
    };
  }

  // Syncing
  if (/sync|restor|recover/i.test(detail || '')) {
    return {
      variant: 'syncing',
      icon: 'loading',
      label: detail || 'Syncing private balance',
    };
  }

  // Generic info fallback
  if (detail) {
    return {
      variant: 'info',
      icon: 'info',
      label: detail,
    };
  }

  return null;
}

export function PrivacyStatusBanner({
  readyStatus,
  statusDetail,
  privacyMode,
  networkLabel,
  onDismiss,
}: PrivacyStatusBannerProps) {
  const styles = useStyles(themeStyles);
  const { colors } = useTheme();

  const banner = useMemo(
    () => classifyBanner(readyStatus, statusDetail, networkLabel),
    [readyStatus, statusDetail, networkLabel]
  );

  useEffect(() => {
    if (!privacyMode || !banner || !onDismiss) return;
    if (banner.variant !== 'ready' && banner.variant !== 'info') return;

    const timer = setTimeout(onDismiss, 2_500);
    return () => clearTimeout(timer);
  }, [banner, onDismiss, privacyMode]);

  if (!privacyMode || !banner) return null;

  const variantStyles = {
    setting_up: {
      bg: colors.accentContainer,
      border: colors.accentMuted,
      iconColor: colors.accent,
      labelColor: colors.accent,
      sublabelColor: colors.textMuted,
    },
    syncing: {
      bg: colors.bgTertiary,
      border: colors.outlineSubtle,
      iconColor: colors.accent,
      labelColor: colors.textSecondary,
      sublabelColor: colors.textTertiary,
    },
    error: {
      bg: colors.errorSurface,
      border: colors.errorMuted,
      iconColor: colors.error,
      labelColor: colors.error,
      sublabelColor: colors.textMuted,
    },
    fund_needed: {
      bg: colors.warningBg,
      border: colors.accentMuted,
      iconColor: colors.accent,
      labelColor: colors.accent,
      sublabelColor: colors.textMuted,
    },
    ready: {
      bg: colors.successBg,
      border: colors.successMuted,
      iconColor: colors.success,
      labelColor: colors.success,
      sublabelColor: colors.textMuted,
    },
    info: {
      bg: colors.bgTertiary,
      border: colors.outlineSubtle,
      iconColor: colors.textMuted,
      labelColor: colors.textSecondary,
      sublabelColor: colors.textTertiary,
    },
  };

  const vs = variantStyles[banner.variant];
  const showSpinner = banner.variant === 'setting_up' || banner.variant === 'syncing';

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={[
        styles.container,
        {
          backgroundColor: vs.bg,
          borderLeftColor: vs.border,
        },
      ]}
    >
      <View style={styles.iconWrap}>
        {showSpinner ? (
          <ActivityIndicator size={16} color={vs.iconColor} />
        ) : (
          <Icon name={banner.icon} size={16} color={vs.iconColor} />
        )}
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.label, { color: vs.labelColor }]} numberOfLines={2}>
          {banner.label}
        </Text>
        {banner.sublabel ? (
          <Text style={[styles.sublabel, { color: vs.sublabelColor }]} numberOfLines={2}>
            {banner.sublabel}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const themeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginTop: 12,
      borderLeftWidth: 3,
      gap: 10,
    },
    iconWrap: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -2,
    },
    textWrap: {
      flex: 1,
      gap: 2,
    },
    label: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
    sublabel: {
      fontFamily: typography.fontFamily.body,
      fontSize: 11,
      lineHeight: 15,
      flexWrap: 'wrap',
    },
  });
