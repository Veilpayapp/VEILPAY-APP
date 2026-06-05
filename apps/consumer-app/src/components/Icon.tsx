/**
 * Veilpay Icon Component
 * Premium SVG icon system replacing all emoji icons
 * 
 * Design System:
 * - Stroke Width: 2px (consistent weight)
 * - Corner Radius: 2px (minimal rounding)
 * - ViewBox: 24x24 (standard)
 * - Colors: Primary (#FFFFFF), Secondary (#888888), Accent (#F59E0B)
 */

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Path, Circle, Rect, Line, G, ClipPath, Defs, Use } from 'react-native-svg';
import { useTheme, useStyles } from '../styles/design-tokens';

// Icon name type for type safety
export type IconName =
  // Navigation
  | 'home'
  | 'send'
  | 'receive'
  | 'scan'
  | 'settings'
  | 'back'
  | 'close'
  // Actions
  | 'copy'
  | 'paste'
  | 'edit'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'visibility'
  | 'visibility-off'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-right'
  // Status
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'loading'
  | 'private'
  | 'private-lock'
  // Features
  | 'shield'
  | 'zk-proof'
  | 'globe'
  | 'wallet'
  | 'card'
  | 'camera'
  | 'flash'
  | 'flash-off'
  | 'user'
  | 'bell'
  | 'key'
  | 'document'
  | 'trash'
  | 'export'
  | 'calendar'
  | 'link'
  | 'testtube'
  | 'hourglass'
  | 'inbox'
  | 'hexagon'
  | 'search'
  | 'water'
  | 'plus';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

// Icon SVG paths and elements
const ICONS: Record<IconName, React.ReactNode> = {
  // Navigation Icons
  home: (
    <G>
      <Path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  send: (
    <G>
      <Path d="M12 19V5M12 5l-7 7M12 5l7 7" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  receive: (
    <G>
      <Path d="M12 5v14M12 19l-7-7M12 19l7-7" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  scan: (
    <G>
      <Path d="M12 4v4m0 8v4M4 12h4m8 0h4" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <Circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" fill="none"/>
    </G>
  ),
  
  settings: (
    <G>
      <Circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M12 1v4m0 14v4M4.22 4.22l2.83 2.83m9.9 9.9l2.83 2.83M1 12h4m14 0h4M4.22 19.78l2.83-2.83m9.9-9.9l2.83-2.83" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  back: (
    <G>
      <Path d="M19 12H5M12 19l-7-7 7-7" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  close: (
    <G>
      <Path d="M18 6L6 18M6 6l12 12" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  // Action Icons
  copy: (
    <G>
      <Rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  paste: (
    <G>
      <Rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M16 8V6a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" 
        stroke="currentColor" strokeWidth="2" fill="none"/>
    </G>
  ),
  
  edit: (
    <G>
      <Path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  'chevron-right': (
    <G>
      <Path d="M9 18l6-6-6-6" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  'chevron-down': (
    <G>
      <Path d="M6 9l6 6 6-6" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  'chevron-up': (
    <G>
      <Path d="M18 15l-6-6-6 6" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  visibility: (
    <G>
      <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" 
        stroke="currentColor" strokeWidth="2" fill="none"/>
      <Circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" fill="none"/>
    </G>
  ),
  
  'visibility-off': (
    <G>
      <Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  'arrow-up': (
    <G>
      <Path d="M12 19V5M5 12l7-7 7 7" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  'arrow-down': (
    <G>
      <Path d="M12 5v14M5 12l7 7 7-7" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  'arrow-right': (
    <G>
      <Path d="M5 12h14M12 5l7 7-7 7" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  // Status Icons
  success: (
    <G>
      <Circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M8 12l3 3 5-6" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  error: (
    <G>
      <Circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M15 9l-6 6M9 9l6 6" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  warning: (
    <G>
      <Path d="M12 9v4M12 17h.01" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <Path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  info: (
    <G>
      <Circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M12 16v-4M12 8h.01" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  loading: (
    <G>
      <Path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  private: (
    <G>
      <Rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M7 11V7a5 5 0 0110 0v4" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  'private-lock': (
    <G>
      <Rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M8 11V7a4 4 0 018 0v4" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <Circle cx="12" cy="16" r="1" fill="currentColor"/>
    </G>
  ),
  
  // Feature Icons
  shield: (
    <G>
      <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <Path d="M9 12l2 2 4-4" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  'zk-proof': (
    <G>
      <Circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M12 6v6l4 2" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <Path d="M8 14l4 4 4-4" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  globe: (
    <G>
      <Circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" 
        stroke="currentColor" strokeWidth="2" fill="none"/>
    </G>
  ),
  
  wallet: (
    <G>
      <Rect x="1" y="4" width="22" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M1 10h22" stroke="currentColor" strokeWidth="2"/>
      <Circle cx="17" cy="14" r="2" stroke="currentColor" strokeWidth="2" fill="none"/>
    </G>
  ),
  
  card: (
    <G>
      <Rect x="1" y="4" width="22" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M1 10h22" stroke="currentColor" strokeWidth="2"/>
    </G>
  ),
  
  camera: (
    <G>
      <Path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <Circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2" fill="none"/>
    </G>
  ),
  
  flash: (
    <G>
      <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  'flash-off': (
    <G>
      <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <Path d="M1 1l22 22" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  user: (
    <G>
      <Path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <Circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" fill="none"/>
    </G>
  ),
  
  bell: (
    <G>
      <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  key: (
    <G>
      <Path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  document: (
    <G>
      <Path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <Path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  trash: (
    <G>
      <Path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  export: (
    <G>
      <Path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  calendar: (
    <G>
      <Rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </G>
  ),
  
  link: (
    <G>
      <Path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <Path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  testtube: (
    <G>
      <Path d="M9 3v6l-3 9a2 2 0 002 2h8a2 2 0 002-2l-3-9V3" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <Path d="M9 3h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <Path d="M10 9h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </G>
  ),
  
  hourglass: (
    <G>
      <Path d="M5 3h14M5 21h14M6 3v4a6 6 0 006 6 6 6 0 006-6V3M6 21v-4a6 6 0 016-6 6 6 0 016 6v4" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  inbox: (
    <G>
      <Path d="M22 12h-6l-2 3h-4l-2-3H2" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <Path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" 
        stroke="currentColor" strokeWidth="2" fill="none"/>
    </G>
  ),
  
  hexagon: (
    <G>
      <Path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" 
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
  
  search: (
    <G>
      <Circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" fill="none"/>
      <Path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </G>
  ),
  
  water: (
    <G>
      <Path d="M12 2L6 12a6 6 0 0012 0L12 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),

  plus: (
    <G>
      <Path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </G>
  ),
};

export function Icon({ name, size = 24, color, style }: IconProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const iconColor = color || colors.textPrimary;
  const iconElement = ICONS[name];
  
  if (!iconElement) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }
  
  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        color={iconColor}
      >
        {iconElement}
      </Svg>
    </View>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default Icon;
