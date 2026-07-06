import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { SovereignButton } from './SovereignButton';
import { Icon } from './Icon';

interface SecurityWarningModalProps {
  visible: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmText?: string;
}

export function SecurityWarningModal({
  visible,
  title,
  message,
  onCancel,
  onConfirm,
  confirmText = "COPY ANYWAY",
}: SecurityWarningModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable onPress={onCancel}>
        <View style={styles.overlay}>
          <Pressable>
            <View style={styles.modalContent}>
              <View style={styles.iconContainer}>
                <Icon name="info" size={32} color={colors.warning} />
              </View>
              
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.message}>{message}</Text>
              
              <View style={styles.buttonRow}>
                <SovereignButton
                  title="CANCEL"
                  variant="outline"
                  onPress={onCancel}
                  style={styles.button}
                />
                <SovereignButton
                  title={confirmText}
                  variant="primary"
                  onPress={onConfirm}
                  style={styles.button}
                />
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
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
    backgroundColor: colors.warningBg + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.warningBg + '40',
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
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
  },
});
