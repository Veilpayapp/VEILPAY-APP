/**
 * Veilpay Logo Component
 * Reusable logo component for consistent branding across the app
 * 
 * Usage:
 * - <Logo variant="full" /> - Full Veilpay logo with text (uses Veilpay.png)   
 * - <Logo variant="icon" /> - Icon only (shield logo from Logo.png)
 * - <Logo variant="header" /> - Compact icon version for headers
 * - <Logo variant="manual" /> - Shield icon + Manually written text
 */import React from 'react';import { View, Image, StyleSheet, Text, ViewStyle, TextStyle, ImageStyle } from 'react-native';
import { useTheme, useStyles, typography, spacing, type Colors } from "../styles/design-tokens";

export type LogoVariant = 'full' | 'icon' | 'header' | 'manual';

interface LogoProps {
  variant?: LogoVariant;
  style?: ViewStyle;
  size?: 'small' | 'medium' | 'large';
  textStyle?: TextStyle;
  imageStyle?: ImageStyle;
}

export function Logo({ 
  variant = 'full', 
  style, 
  size = 'medium',
  textStyle,
  imageStyle
}: LogoProps) { 
  const { theme, colors } = useTheme();
  const styles = useStyles(themeStyles);
  
  const iconSource = theme === 'dark' ? require('../../assets/logo-icon-dark.png') : require('../../assets/logo-icon.png');
  const fullSource = theme === 'dark' ? require('../../assets/logo-full-dark.png') : require('../../assets/logo-full.png');
  
  // Size configurations for different variants
  const sizeConfig = {
    small: {
      icon: 24,
      full: 100,
      header: 28,
      fontSize: 20,
    },
    medium: {
      icon: 40,
      full: 140,
      header: 36,
      fontSize: 28,
    },
    large: {
      icon: 64,
      full: 200,
      header: 56,
      fontSize: 36,
    },
  };

  const currentSize = sizeConfig[size];

  // Render manual variant: Logo icon + Manually written VEILPAY text
  if (variant === 'manual') {
    return (
      <View style={[styles.manualContainer, style]}>
        <Image
          source={iconSource}
          style={[{ width: currentSize.icon, height: currentSize.icon }, imageStyle]}
          resizeMode="contain"
        />
        <Text style={[
          styles.manualText,
          { fontSize: currentSize.fontSize },
          textStyle
        ]}>
          VEILPAY
        </Text>
      </View>
    );
  }

  // Render icon only (Logo.png - shield icon)
  if (variant === 'icon') {
    return (
      <View style={[styles.iconContainer, style]}>
        <Image
          source={iconSource}
          style={[{ width: currentSize.icon, height: currentSize.icon }, imageStyle]}
          resizeMode="contain"
        />
      </View>
    );
  }

  // Render full logo (Veilpay.png - full name logo) or header icon
  const logoSize = variant === 'full' ? currentSize.full : currentSize.header;  

  return (
    <View style={[styles.container, style]}>
      <Image
        source={fullSource}
        style={[{ width: logoSize, height: logoSize * 0.3 }, imageStyle]}
        resizeMode="contain"
      />
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
  },
  manualText: {
    fontFamily: typography.fontFamily.headlineBold,
    color: colors.textPrimary,
    letterSpacing: 2,
  },
});

export default Logo;
