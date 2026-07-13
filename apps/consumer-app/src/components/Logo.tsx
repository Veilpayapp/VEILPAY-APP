/**
 * Veilpay Logo
 *
 * Brand mark from `New logo/Logo.png`, inlined as base64 (logoIconBase64.ts)
 * and drawn via react-native-svg — same pipeline as the rest of the icon system.
 *
 * Why not `require()` + RN Image?
 * Local APK builds were showing a blank shield next to the VEILPAY text while
 * the native splash (assets/logo-icon.png) painted fine. Inlining the bitmap
 * into the JS bundle avoids the asset-resolve path entirely so a local
 * assembleRelease/Debug always ships a visible mark.
 *
 * `assets/logo-icon.png` is kept only for app icon + expo-splash-screen.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet, Text, type ViewStyle, type TextStyle, type ImageStyle } from 'react-native';
import Svg, { Image as SvgImage } from 'react-native-svg';
import { useTheme, useStyles, typography, spacing, type Colors } from '../styles/design-tokens';
import { LOGO_ICON_DATA_URI } from './logoIconBase64';

export type LogoVariant = 'full' | 'icon' | 'header' | 'manual';

const LOGO_SIZE_CONFIG = {
  small: { icon: 28, header: 28, fontSize: 18 },
  medium: { icon: 44, header: 36, fontSize: 26 },
  large: { icon: 72, header: 56, fontSize: 34 },
} as const;

interface LogoProps {
  variant?: LogoVariant;
  style?: ViewStyle;
  size?: 'small' | 'medium' | 'large';
  textStyle?: TextStyle;
  /** Kept for API compatibility; SVG image uses width/height from size. */
  imageStyle?: ImageStyle;
}

export function Logo({
  variant = 'full',
  style,
  size = 'medium',
  textStyle,
}: LogoProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const currentSize = LOGO_SIZE_CONFIG[size];

  const iconPx = variant === 'header' ? currentSize.header : currentSize.icon;
  const showText = variant === 'manual' || variant === 'full';

  const href = useMemo(() => LOGO_ICON_DATA_URI, []);

  return (
    <View
      collapsable={false}
      style={[showText ? styles.row : styles.iconOnly, style]}
      accessibilityLabel="VeilPay"
    >
      <View style={{ width: iconPx, height: iconPx }} collapsable={false}>
        <Svg width={iconPx} height={iconPx} viewBox="0 0 256 256">
          <SvgImage
            href={href}
            width={256}
            height={256}
            preserveAspectRatio="xMidYMid meet"
          />
        </Svg>
      </View>
      {showText ? (
        <Text
          style={[
            styles.wordmark,
            { fontSize: currentSize.fontSize, color: colors.textPrimary },
            textStyle,
          ]}
        >
          VEILPAY
        </Text>
      ) : null}
    </View>
  );
}

const themeStyles = (_colors: Colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[2],
    },
    iconOnly: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    wordmark: {
      fontFamily: typography.fontFamily.headlineBold,
      letterSpacing: 2,
    },
  });

export default Logo;
