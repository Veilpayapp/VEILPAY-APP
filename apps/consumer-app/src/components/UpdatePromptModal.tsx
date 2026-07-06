import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useTheme, useStyles, typography, type Colors } from '../styles/design-tokens';
import { SovereignButton } from './SovereignButton';
import { Icon } from './Icon';

interface UpdatePromptModalProps {
  visible: boolean;
  /** True while the new bundle is downloading — buttons lock and show progress. */
  isDownloading?: boolean;
  /** Non-null when the last download/apply attempt failed. */
  error?: string | null;
  /** Dismiss without updating ("Later"). Hidden while downloading. */
  onLater: () => void;
  /** Download the pending update and reload into it. */
  onUpdate: () => void;
}

/**
 * Branded replacement for the stock `Alert.alert('Update Available', …)`.
 * Purely presentational — the OTA lifecycle lives in `useOTAUpdates`; this
 * component just renders its state and forwards the two user actions.
 */
export function UpdatePromptModal({
  visible,
  isDownloading = false,
  error = null,
  onLater,
  onUpdate,
}: UpdatePromptModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  // While downloading, block the backdrop/back-button dismissal so the reload
  // isn't interrupted midway.
  const handleRequestClose = () => {
    if (isDownloading) {
      return;
    }
    onLater();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleRequestClose}
    >
      <Pressable onPress={handleRequestClose}>
        <View style={styles.overlay}>
          <Pressable>
            <View style={styles.modalContent}>
              <View style={styles.iconContainer}>
                <Icon name="arrow-down" size={32} color={colors.accent} />
              </View>

              <Text style={styles.title}>Update Available</Text>
              <Text style={styles.message}>
                A new Veilpay update is ready. Update now to get the latest fixes and improvements.
              </Text>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.buttonRow}>
                <SovereignButton
                  title="LATER"
                  variant="outline"
                  onPress={onLater}
                  disabled={isDownloading}
                  style={styles.button}
                />
                <SovereignButton
                  variant="primary"
                  onPress={onUpdate}
                  disabled={isDownloading}
                  style={styles.button}
                  accessibilityLabel="Update now"
                >
                  {isDownloading ? (
                    <View style={styles.downloadingRow}>
                      <ActivityIndicator size="small" color={colors.textPrimary} />
                      <Text style={styles.downloadingText}>UPDATING…</Text>
                    </View>
                  ) : (
                    <Text style={styles.updateText}>UPDATE NOW</Text>
                  )}
                </SovereignButton>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 0,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 0,
    backgroundColor: colors.accent + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.accent + '40',
  },
  title: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontFamily: typography.fontFamily.body,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  errorText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.error,
    textAlign: 'center',
    marginTop: -12,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
  },
  downloadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  downloadingText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  updateText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.bgPrimary,
  },
});
