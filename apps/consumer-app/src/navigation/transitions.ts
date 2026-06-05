/**
 * Veilpay Navigation Transitions
 * Sophisticated animation configuration for smooth navigation
 * 
 * Animation Timing:
 * - Fast: 150ms (micro-interactions)
 * - Normal: 250ms (standard transitions)
 * - Slow: 350ms (modal presentations)
 */

import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

// Animation durations (matching design-tokens.ts)
export const ANIMATION = {
  fast: 150,
  normal: 250,
  slow: 350,
  verySlow: 500,
} as const;

// Transition presets for different screen types
export const transitionPresets = {
  /**
   * Standard push navigation (forward)
   * Used for: Sequential flows, detail screens
   */
  push: {
    animation: 'slide_from_right' as const,
    gestureEnabled: true,
    gestureDirection: 'horizontal' as const,
    animationDuration: ANIMATION.normal,
  },

  /**
   * Modal/sheet presentation
   * Used for: Action sheets, filters, selectors
   */
  modal: {
    animation: 'slide_from_bottom' as const,
    gestureEnabled: true,
    gestureDirection: 'vertical' as const,
    animationDuration: ANIMATION.slow,
    presentation: 'containedTransparentModal' as const,
  },

  /**
   * Full-screen overlay
   * Used for: QR Scanner, Camera, Full-screen modals
   */
  overlay: {
    animation: 'fade' as const,
    gestureEnabled: false,
    animationDuration: ANIMATION.normal,
    presentation: 'fullScreenModal' as const,
  },

  /**
   * Scale and fade (pop effect)
   * Used for: Quick selections, token selector
   */
  scaleFade: {
    animation: 'scale_from_center' as const,
    gestureEnabled: true,
    animationDuration: ANIMATION.normal,
  },

  /**
   * Simple fade transition
   * Used for: Settings, preferences, non-sequential screens
   */
  fade: {
    animation: 'fade' as const,
    gestureEnabled: true,
    animationDuration: ANIMATION.fast,
  },

  /**
   * Instant transition
   * Used for: Tab navigation switching to avoid flashing
   */
  none: {
    animation: 'none' as const,
    gestureEnabled: false,
  },

  /**
   * Flip transition
   * Used for: Card flips, privacy level selection
   */
  flip: {
    animation: 'flip' as const,
    gestureEnabled: false,
    animationDuration: ANIMATION.slow,
  },
};

// Screen-specific animation assignments
export const screenTransitions: Record<string, NativeStackNavigationOptions> = {
  // Onboarding Flow - Sequential push
  Onboarding: {
    ...transitionPresets.fade,
  },
  
  WalletConnect: {
    ...transitionPresets.none,
  },
  
  CreateWallet: {
    ...transitionPresets.none,
  },
  
  ImportWallet: {
    ...transitionPresets.none,
  },
  
  SetPassword: {
    ...transitionPresets.none,
  },
  
  BiometricSetup: {
    ...transitionPresets.none,
  },
  
  // Main App - Tab-like behavior
  Home: {
    ...transitionPresets.none,
  },
  
  // Payment Flow
  SendPayment: {
    ...transitionPresets.push,
  },
  
  PrivacyLevel: {
    ...transitionPresets.push,
  },
  
  PaymentConfirmation: {
    ...transitionPresets.push,
  },
  
  PaymentSuccess: {
    ...transitionPresets.fade,
  },
  
  ReceiveQR: {
    ...transitionPresets.push,
  },
  
  // Wallet Security & Backup
  BackupWallet: {
    ...transitionPresets.none,
  },
  
  ExportPrivateKey: {
    ...transitionPresets.none,
  },
  
  // Scanner - Full overlay
  QRScanner: {
    ...transitionPresets.overlay,
  },
  
  // Selectors - Fade with modal presentation
  TokenSelector: {
    ...transitionPresets.fade,
    presentation: 'transparentModal' as const,
  },
  
  // History & Details
  TransactionHistory: {
    ...transitionPresets.none,
  },
  
  TransactionDetails: {
    ...transitionPresets.none,
  },
  
  // Settings
  Settings: {
    ...transitionPresets.none,
  },
  
  AddCustomNetwork: {
    ...transitionPresets.none,
  },
  
  // Fiat Gateway Flow
  DepositCrypto: {
    ...transitionPresets.none,
  },
  
  WithdrawFiat: {
    ...transitionPresets.none,
  },
  
  TransakWebView: {
    ...transitionPresets.none,
  },
  
  OnrampWidget: {
    ...transitionPresets.none,
  },
  
  OnrampAmount: {
    ...transitionPresets.none,
  },
  
  OnrampQuotes: {
    ...transitionPresets.none,
  },
  
  OfframpQuotes: {
    ...transitionPresets.none,
  },
};

// Animation timing functions
export const timingFunctions = {
  /**
   * Ease out cubic - decelerate at end
   * Best for: Elements entering the screen
   */
  easeOutCubic: 'cubic-bezier(0.33, 1, 0.68, 1)',
  
  /**
   * Ease in cubic - accelerate at start
   * Best for: Elements leaving the screen
   */
  easeInCubic: 'cubic-bezier(0.32, 0, 0.67, 0)',
  
  /**
   * Ease in-out cubic - smooth both ways
   * Best for: Continuous animations
   */
  easeInOutCubic: 'cubic-bezier(0.65, 0, 0.35, 1)',
  
  /**
   * Spring physics - natural bounce
   * Best for: Interactive elements, buttons
   */
  spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
};

// Shared element transition configuration
export const sharedElementConfig = {
  /**
   * Transaction card → Details transition
   */
  transactionCard: {
    animation: 'move' as const,
    resize: 'clip' as const,
    opacity: 0.8,
  },
  
  /**
   * Token selector → Payment transition
   */
  tokenSelector: {
    animation: 'fade-in-place' as const,
    resize: 'stretch' as const,
  },
};

/**
 * Get transition options for a screen
 */
export function getScreenTransition(screenName: string): NativeStackNavigationOptions {
  return screenTransitions[screenName] || transitionPresets.push;
}

export default {
  ANIMATION,
  transitionPresets,
  screenTransitions,
  timingFunctions,
  sharedElementConfig,
  getScreenTransition,
};
