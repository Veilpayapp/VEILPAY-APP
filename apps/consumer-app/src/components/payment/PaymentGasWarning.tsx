import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';
import { Icon } from '../Icon';

interface PaymentGasWarningProps {
  gasWarning: string | null;
  isStale: boolean | undefined;
}

export function PaymentGasWarning({ gasWarning, isStale }: PaymentGasWarningProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  if (!gasWarning) return null;

  return (
    <SovereignCard backgroundColor={colors.warningBg} padding={0} style={{ marginBottom: 24 }}>
      <View style={styles.gasWarningContent}>
        <View style={styles.gasWarningIconWrap}>
          <Icon name="warning" size={20} color={colors.accent} />
        </View>
        <View style={styles.gasWarningTextWrap}>
          <Text style={styles.gasWarningTitle}>HIGH GAS FEES</Text>
          <Text style={styles.gasWarningDesc}>{gasWarning}</Text>
          {isStale && (
            <Text style={styles.gasWarningMeta}>Using a cached fallback estimate.</Text>
          )}
        </View>
      </View>
    </SovereignCard>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  gasWarningContent: {
    flexDirection: 'row',
    padding: 16,
    gap: 16,
  },
  gasWarningIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 107, 0, 0.1)',
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
    fontWeight: 'bold',
    color: colors.accent,
    letterSpacing: 0.5,
  },
  gasWarningDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  gasWarningMeta: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.warning,
    marginTop: 4,
  },
});
