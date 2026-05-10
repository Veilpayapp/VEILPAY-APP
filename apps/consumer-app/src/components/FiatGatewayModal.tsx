import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SovereignButton } from './SovereignButton';
import { SovereignCard } from './SovereignCard';
import { Icon } from './Icon';
import { useTheme, useStyles, typography } from '../styles/design-tokens';

interface FiatGatewayModalProps {
  visible: boolean;
  onClose: () => void;
  onBuy: () => void;
  onSell: () => void;
}

export function FiatGatewayModal({ visible, onClose, onBuy, onSell }: FiatGatewayModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss gateway chooser"
        />

        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>FIAT GATEWAY</Text>
              <Text style={styles.subtitle}>
                Powered by Onramp.money. Fast, secure, and India-native payments via UPI/IMPS.
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
            >
              <Icon name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.options}>
            <SovereignCard
              onPress={onBuy}
              backgroundColor={colors.surfaceCard}
              borderRadius={24}
              style={styles.optionCard}
            >
              <View style={styles.optionContent}>
                <View style={styles.optionIconWrap}>
                  <Icon name="card" size={22} color={colors.accent} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>BUY CRYPTO</Text>
                  <Text style={styles.optionDescription}>
                    Instant UPI, NetBanking, or IMPS. Best rates for INR.
                  </Text>
                </View>
              </View>
            </SovereignCard>

            <SovereignCard
              onPress={onSell}
              backgroundColor={colors.surfaceCard}
              borderRadius={24}
              style={styles.optionCard}
            >
              <View style={styles.optionContent}>
                <View style={styles.optionIconWrap}>
                  <Icon name="receive" size={22} color={colors.accent} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>OFF-RAMP FIAT</Text>
                  <Text style={styles.optionDescription}>
                    Sell crypto and receive INR directly into your bank account.
                  </Text>
                </View>
              </View>
            </SovereignCard>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Onramp.money handles KYC securely. VeilPay does not store your personal identity data.
            </Text>
            <SovereignButton title="CLOSE" variant="outline" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  content: {
    backgroundColor: colors.surfaceScreen,
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 24,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 1.5,
  },
  subtitle: {
    marginTop: 8,
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    gap: 16,
  },
  optionCard: {
    marginBottom: 0,
    borderWidth: 0,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
  },
  optionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  optionCopy: {
    flex: 1,
  },
  optionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.accent,
    letterSpacing: 0.8,
  },
  optionDescription: {
    marginTop: 4,
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  footer: {
    marginTop: 24,
    gap: 16,
  },
  footerText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});
