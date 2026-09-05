/**
 * Shield Progress Modal
 *
 * Full-screen overlay showing the five sequential SPP stages. Each stage has
 * an icon from the app's SVG icon set, a status badge (active spinner, success
 * checkmark, error X), and a highlighted active stage. The card styling
 * matches the app's SovereignCard design language.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { Icon, type IconName } from '../Icon';
import { SovereignButton } from '../SovereignButton';
import {
  subscribeSppProgress,
  type SppProgressState,
  type SppProgressStage,
} from '../../utils/stellarSpp/sppProgressSubscriber';

// ---------------------------------------------------------------------------
// Stage metadata
// ---------------------------------------------------------------------------

interface StageMeta {
  label: string;
  description: string;
  icon: IconName;
}

const STAGE_META: Record<SppProgressStage, StageMeta> = {
  derive_keys: {
    label: 'Deriving keys',
    description: 'Preparing your private keys.',
    icon: 'key',
  },
  sync_pool: {
    label: 'Syncing pool',
    description: 'Fetching the latest shielded pool state from the network.',
    icon: 'globe',
  },
  generate_proof: {
    label: 'Generating proof',
    description: 'Computing your zero-knowledge proof. This usually takes 15–20 seconds.',
    icon: 'zk-proof',
  },
  submit_tx: {
    label: 'Submitting',
    description: 'Broadcasting the shielded transaction to the Stellar network.',
    icon: 'send',
  },
  confirmed: {
    label: 'Confirmed',
    description: 'Your shielded transaction is complete.',
    icon: 'success',
  },
};

const STAGE_ORDER: SppProgressStage[] = [
  'derive_keys',
  'sync_pool',
  'generate_proof',
  'submit_tx',
  'confirmed',
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ShieldProgressModalProps {
  visible: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShieldProgressModal({
  visible,
  onRetry,
  onDismiss,
}: ShieldProgressModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [stages, setStages] = useState<SppProgressState[]>([]);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!visible) {
      setStages([]);
      return;
    }
    const unsub = subscribeSppProgress(setStages);
    return () => unsub();
  }, [visible]);

  // Auto-dismiss 1.2s after all stages succeed
  useEffect(() => {
    if (!visible) return;
    const allSuccess = stages.length > 0 && stages.every((s) => s.status === 'success');
    if (!allSuccess) return;
    const timer = setTimeout(() => onDismissRef.current(), 1200);
    return () => clearTimeout(timer);
  }, [visible, stages]);

  const hasError = stages.some((s) => s.status === 'error');
  const activeStage = stages.find((s) => s.status === 'active');

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIconWrap}>
              <Icon name="shield" size={22} color={colors.accent} />
            </View>
            <Text style={styles.title}>Shielding</Text>
            <Text style={styles.subtitle}>
              Preparing your private transaction on-device.
            </Text>
          </View>

          {/* Steps */}
          <View style={styles.steps}>
            {STAGE_ORDER.map((stage) => {
              const meta = STAGE_META[stage];
              const state = stages.find((s) => s.stage === stage);
              const status = state?.status ?? 'pending';
              const isActive = status === 'active';
              const isDone = status === 'success';
              const isErr = status === 'error';
              const isPending = !isActive && !isDone && !isErr;

              return (
                <Animated.View
                  key={stage}
                  entering={FadeIn.duration(200)}
                  exiting={FadeOut.duration(200)}
                >
                  <View
                    style={[
                      styles.step,
                      isActive && styles.stepActive,
                    ]}
                  >
                    {/* Icon badge */}
                    <View
                      style={[
                        styles.badge,
                        isDone && styles.badgeDone,
                        isErr && styles.badgeError,
                        isActive && styles.badgeActive,
                        isPending && styles.badgePending,
                      ]}
                    >
                      {isDone ? (
                        <Icon name="success" size={16} color={colors.success} />
                      ) : isErr ? (
                        <Icon name="error" size={16} color={colors.error} />
                      ) : (
                        <Icon name={meta.icon} size={16} color={isActive ? colors.accent : colors.textFaint} />
                      )}
                    </View>

                    {/* Content */}
                    <View style={styles.stepContent}>
                      <Text
                        style={[
                          styles.stepLabel,
                          isActive && styles.stepLabelActive,
                          isDone && styles.stepLabelDone,
                          isErr && styles.stepLabelError,
                          isPending && styles.stepLabelPending,
                        ]}
                      >
                        {meta.label}
                      </Text>

                      {isActive && meta.description && (
                        <Text style={styles.stepDescription}>
                          {meta.description}
                        </Text>
                      )}

                      {isErr && state?.message && (
                        <Text style={styles.stepError}>{state.message}</Text>
                      )}
                    </View>

                    {/* Status indicator */}
                    {isActive && (
                      <ActivityIndicator size="small" color={colors.accent} style={styles.spinner} />
                    )}
                    {isDone && (
                      <Icon name="success" size={16} color={colors.success} style={styles.statusIcon} />
                    )}
                    {isErr && (
                      <Icon name="error" size={16} color={colors.error} style={styles.statusIcon} />
                    )}
                  </View>
                </Animated.View>
              );
            })}
          </View>

          {/* Timing hint for the proof stage */}
          {activeStage?.stage === 'generate_proof' && (
            <Animated.View entering={FadeIn.duration(300)} style={styles.hint}>
              <Icon name="hourglass" size={14} color={colors.textMuted} />
              <Text style={styles.hintText}>
                This usually takes 15–20 seconds
              </Text>
            </Animated.View>
          )}

          {/* Error state — retry */}
          {hasError && (
            <Animated.View entering={FadeIn.duration(300)} style={styles.footer}>
              <SovereignButton
                title="Try Again"
                variant="primary"
                onPress={onRetry}
              />
            </Animated.View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const themeStyles = (colors: Colors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.surfaceCard,
      borderRadius: 16,
      padding: 24,
      paddingTop: 28,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    header: {
      alignItems: 'center',
      marginBottom: 28,
    },
    headerIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accentContainer,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    title: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    subtitle: {
      fontFamily: typography.fontFamily.body,
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    steps: {
      gap: 6,
    },
    step: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
    },
    stepActive: {
      backgroundColor: colors.surfaceHover,
    },
    badge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
    },
    badgeDone: {
      backgroundColor: colors.successBg,
      borderColor: colors.success,
    },
    badgeError: {
      backgroundColor: colors.errorBg,
      borderColor: colors.error,
    },
    badgeActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentContainer,
    },
    badgePending: {
      borderColor: colors.outlineDefault,
      backgroundColor: colors.surfaceElevated,
    },
    stepContent: {
      flex: 1,
      gap: 2,
    },
    stepLabel: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 14,
      letterSpacing: 0.3,
    },
    stepLabelActive: {
      color: colors.accent,
      fontWeight: '700',
    },
    stepLabelDone: {
      color: colors.success,
    },
    stepLabelError: {
      color: colors.error,
      fontWeight: '600',
    },
    stepLabelPending: {
      color: colors.textMuted,
    },
    stepDescription: {
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 17,
      marginTop: 1,
    },
    stepError: {
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.errorMuted,
      lineHeight: 17,
      marginTop: 1,
    },
    spinner: {
      marginLeft: 4,
    },
    statusIcon: {
      marginLeft: 4,
    },
    hint: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.surfaceElevated,
      borderRadius: 10,
      padding: 12,
      marginTop: 20,
    },
    hintText: {
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.textMuted,
    },
    footer: {
      marginTop: 24,
      alignItems: 'center',
    },
  });