import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";
import { SovereignCard } from './SovereignCard';
import { Icon, type IconName } from './Icon';

interface FeatureCardProps {
  title: string;
  description: string;
  iconName: IconName;
}

export function FeatureCard({ title, description, iconName }: FeatureCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  return (
    <SovereignCard style={{ marginBottom: 12 }} padding={20} backgroundColor={colors.bgSecondary}>
      <View style={styles.featureRow} accessibilityLabel={`${title}: ${description}`}>
        <View style={styles.iconBox}>
          <Icon name={iconName} size={24} color={colors.textPrimary} />
        </View>
        <View style={styles.featureTextContainer}>
          <Text style={styles.featureTitle}>{title}</Text>
          <Text style={styles.featureDescription}>{description}</Text>
        </View>
      </View>
    </SovereignCard>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTextContainer: { flex: 1, gap: 6, justifyContent: 'center', minHeight: 48 },
  featureTitle: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 18,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  featureDescription: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
