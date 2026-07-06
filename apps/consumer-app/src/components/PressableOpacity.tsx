import React from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

export interface PressableOpacityProps extends Omit<PressableProps, 'style'> {
  /**
   * Opacity applied while the element is pressed. Mirrors the (frozen)
   * TouchableOpacity `activeOpacity` prop so existing call sites keep their
   * press-dim feedback. Defaults to 0.2 to match TouchableOpacity.
   */
  activeOpacity?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Drop-in replacement for React Native's frozen `TouchableOpacity`, built on
 * `Pressable`. Applies `activeOpacity` while pressed so migrated call sites
 * preserve their original press feedback without any per-call-site changes.
 */
export function PressableOpacity({
  activeOpacity = 0.2,
  style,
  disabled,
  ...rest
}: PressableOpacityProps) {
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: activeOpacity } : null]}
    />
  );
}
