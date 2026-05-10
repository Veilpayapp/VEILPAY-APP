/**
 * Veilpay Design Tokens
 * Based on "The Sovereign Minimalist" design system from Stitch
 *
 * Core Principles:
 * - No borders, no glass, no gradients
 * - Radical Reduction - strip away non-essential elements
 * - High-voltage Amber Gold (#F59E0B) highlights
 */

import { Dimensions, StyleSheet } from 'react-native';
import { useThemeState } from '../stores/walletStore';
import { useMemo } from 'react';

export const darkColors = {
  // Backgrounds
  bgPrimary: '#0A0A0A',
  bgSecondary: '#111111',
  bgTertiary: '#1A1A1A',
  bgContainer: '#201F1F',
  bgContainerHigh: '#2A2A2A',
  bgContainerHighest: '#353534',
  
  // Semantic surface colors (standardized replacements for hardcoded values)
  surfaceCard: '#131313',
  surfaceScreen: '#050505',
  surfaceElevated: '#201F1F',
  surfaceInput: '#131313',
  surfaceHover: '#2A2A2A',
  
  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#888888',
  textTertiary: '#8A8A8A',
  textOnPrimary: '#1A1A1A',
  textMuted: '#A3A3A3',
  textFaint: '#555555',
  
  // Accent (Amber Gold)
  accent: '#F59E0B',
  accentMuted: '#D97706',
  accentLight: '#FFC174',
  accentContainer: '#613B00',
  accentOnBg: '#F59E0B',
  
  // Status
  success: '#22C55E',
  successMuted: '#16A34A',
  successBg: '#14532D',
  warning: '#F59E0B',
  warningBg: '#78350F',
  error: '#EF4444',
  errorMuted: '#DC2626',
  errorBg: '#7F1D1D',
  errorSurface: '#2A1010',
  
  // Outline (use sparingly - "No-Line" rule)
  outline: '#534434',
  outlineVariant: '#2A2A2A',
  outlineSubtle: '#1A1A1A',
  outlineDefault: '#333333',
  
  // Semantic opacity tokens
  opacityOverlay: 'rgba(0, 0, 0, 0.75)',
  opacityOverlayHeavy: 'rgba(0, 0, 0, 0.82)',
  opacityButtonBackdrop: 'rgba(255, 255, 255, 0.1)',
};

export const lightColors: typeof darkColors = {
  // Backgrounds - Premium Ivory
  bgPrimary: '#FDFBF7',
  bgSecondary: '#F5F2EB',
  bgTertiary: '#EAE6DB',
  bgContainer: '#FDFBF7',
  bgContainerHigh: '#FFFFFF',
  bgContainerHighest: '#FDFBF7',
  
  // Semantic surface colors
  surfaceCard: '#FFFFFF',
  surfaceScreen: '#FDFBF7',
  surfaceElevated: '#FFFFFF',
  surfaceInput: '#F5F2EB',
  surfaceHover: '#EAE6DB',
  
  // Text
  textPrimary: '#1A1A1A',
  textSecondary: '#555555',
  textTertiary: '#777777',
  textOnPrimary: '#FFFFFF',
  textMuted: '#8A8A8A',
  textFaint: '#A3A3A3',
  
  // Accent (Amber Gold)
  accent: '#F59E0B',
  accentMuted: '#D97706',
  accentLight: '#FFC174',
  accentContainer: '#FCEFC7',
  accentOnBg: '#1A1A1A',
  
  // Status
  success: '#16A34A',
  successMuted: '#22C55E',
  successBg: '#DCFCE7',
  warning: '#D97706',
  warningBg: '#FEF3C7',
  error: '#DC2626',
  errorMuted: '#EF4444',
  errorBg: '#FEE2E2',
  errorSurface: '#FEF2F2',
  
  // Outline
  outline: '#D1D5DB',
  outlineVariant: '#E5E7EB',
  outlineSubtle: '#F3F4F6',
  outlineDefault: '#E5E7EB',
  
  // Semantic opacity tokens
  opacityOverlay: 'rgba(0, 0, 0, 0.5)',
  opacityOverlayHeavy: 'rgba(0, 0, 0, 0.7)',
  opacityButtonBackdrop: 'rgba(0, 0, 0, 0.05)',
};

export function useTheme() {
  const theme = useThemeState() || 'dark';
  return {
    theme,
    colors: theme === 'light' ? lightColors : darkColors,
  };
}

export function useStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  styleBuilder: (themeColors: typeof darkColors) => T
): T {
  const { colors: themeColors } = useTheme();
  return useMemo(() => styleBuilder(themeColors), [themeColors]);
}

// Fallback removed after full migration

export const typography = {
  fontFamily: {
    headline: 'Manrope_600SemiBold',
    headlineBold: 'Manrope_700Bold',
    headlineSovereign: 'Manrope_800ExtraBold',
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_500Medium',
    bodyBold: 'Inter_600SemiBold',
    mono: 'JetBrainsMono_400Regular',
  },
  fontSize: {
    display: 36,    // Large numbers, hero
    h1: 28,         // Page titles
    h2: 20,         // Section titles
    h3: 16,         // Subsection titles
    body: 15,       // Body text
    small: 13,      // Secondary text
    micro: 11,      // Labels, tags
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  letterSpacing: {
    tight: -0.02,
    normal: 0,
    wide: 0.02,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
};

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
};

export const borderRadius = {
  none: 0,
  sm: 2,          // Minimal rounding
  md: 6,
  lg: 10,
  xl: 14,
  '2xl': 20,
  full: 9999,
};

// Runtime screen dimensions for layout calculations.
export const screen = {
  get width() {
    return Dimensions.get('window').width;
  },
  get height() {
    return Dimensions.get('window').height;
  },
};

// Animation durations
export const animation = {
  fast: 150,
  normal: 200,
  slow: 300,
  verySlow: 500,
};

// Z-index layers
export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  modal: 30,
  popover: 40,
  toast: 50,
  tooltip: 60,
};

// Standard component dimensions for layout consistency
export const component = {
  header: {
    height: 64,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: darkColors.outlineSubtle,
  },
  touchTarget: {
    minHeight: 44,
    minWidth: 44,
  },
  iconBox: {
    small: 40,
    medium: 44,
    large: 48,
  },
  footer: {
    padding: 24,
  },
  bottomSpacer: 120,
} as const;

// WCAG 2.1 contrast ratio utilities
export function meetsWcagAA(foreground: string, background: string): boolean {
  const luminance = (hex: string) => {
    const rgb = hex.replace('#', '').match(/.{2}/g);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map((c) => {
      const v = parseInt(c, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio >= 4.5;
}

export type Colors = typeof darkColors;
export type Typography = typeof typography;
export type Spacing = typeof spacing;
export type BorderRadius = typeof borderRadius;
