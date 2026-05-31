import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useTheme, useStyles, type Colors } from "../styles/design-tokens";

export function NetworkStatusBanner() {
  const { isConnected } = useNetworkStatus();
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  if (isConnected === null || isConnected === true) {
    return null;
  }

  return (
    <View 
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLabel="No internet connection warning"
      accessibilityHint="Internet connection is required for full app functionality"
    >
      <Text style={styles.text}>No internet connection</Text>
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    backgroundColor: colors.error,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  text: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
});
