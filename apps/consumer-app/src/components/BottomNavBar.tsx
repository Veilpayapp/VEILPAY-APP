/**
 * Veilpay Bottom Navigation Bar
 * 5-tab navigation matching Stitch design: Home, Send, Scan QR, Receive, Settings
 * Uses the current structural design language with a prominent center QR button
 *
 * UPDATED: Now uses premium SVG icons instead of emojis
 */import React from "react";import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";
import { SCREENS } from "../constants/screens";
import { Icon, IconName } from "./Icon";
import { triggerLightImpactHaptic } from "../utils/haptics";
import type { RootStackParamList } from "../navigation/AppNavigator";

// Constants for consistent layout
const MIN_TOUCH_TARGET = 44;
const TAB_BAR_HEIGHT = 72;
const PROMINENT_BUTTON_SIZE = 64;
const PROMINENT_OFFSET = -24;

interface BottomNavBarProps {
  currentScreen: string;
  onNavigate: <K extends keyof RootStackParamList>(
    screen: K,
    params?: RootStackParamList[K]
  ) => void;
}

interface NavItem {
  id: string;
  icon: IconName;
  label: string;
  screen: keyof RootStackParamList;
  prominent?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", icon: "home", label: "Home", screen: SCREENS.HOME as keyof RootStackParamList },
  { id: "send", icon: "send", label: "Send", screen: SCREENS.SEND_PAYMENT as keyof RootStackParamList },
  { id: "scan", icon: "scan", label: "Scan", screen: SCREENS.QR_SCANNER as keyof RootStackParamList, prominent: true },
  { id: "receive", icon: "receive", label: "Receive", screen: SCREENS.RECEIVE_QR as keyof RootStackParamList },
  { id: "settings", icon: "settings", label: "Settings", screen: SCREENS.SETTINGS as keyof RootStackParamList },
];

export function BottomNavBar({ currentScreen, onNavigate }: BottomNavBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
    <View
      style={[styles.container, { paddingBottom: Math.max(insets.bottom, 16) }]}
      accessibilityRole="tablist"
      accessibilityLabel="Bottom navigation bar"
    >
      <View style={styles.navBar}>
        {NAV_ITEMS.map((item) => {
          const isActive = currentScreen === item.screen;
          const isProminent = item.prominent;

          if (isProminent) {
            // Prominent center button (QR Scanner)
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.prominentButton}
                onPress={() => {
                  void triggerLightImpactHaptic();
                  onNavigate(item.screen);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${item.label} QR code`}
                accessibilityHint={`Opens ${item.label} screen to scan QR codes`}
                accessibilityState={isActive ? { selected: true } : undefined}
              >
                <View style={styles.prominentInner}>
                  <Icon name={item.icon} size={28} color={colors.bgPrimary} />
                </View>
                <Text style={styles.prominentLabel}>{item.label}</Text>
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={item.id}
              style={styles.navItem}
              onPress={() => {
                void triggerLightImpactHaptic();
                onNavigate(item.screen);
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityHint={`Navigates to ${item.label} screen`}
              accessibilityState={isActive ? { selected: true } : undefined}
            >
              <View style={[styles.iconWrapper, isActive && styles.iconWrapperActive]}>
                <Icon name={item.icon} size={22} color={isActive ? colors.accent : colors.textTertiary} />
              </View>
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bgPrimary,
    // No-Line Rule: Removed borderTopWidth and borderTopColor
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 8,
    height: TAB_BAR_HEIGHT,
  },
  navItem: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "transparent",
  },
  iconWrapperActive: {
    backgroundColor: `${colors.accent}20`,
  },
  navLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  navLabelActive: {
    color: colors.accent,
    fontWeight: "bold",
  },
  prominentButton: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1.2,    marginTop: PROMINENT_OFFSET,
  },  prominentInner: {
    width: PROMINENT_BUTTON_SIZE,
    height: PROMINENT_BUTTON_SIZE,
    borderRadius: PROMINENT_BUTTON_SIZE / 2,
    backgroundColor: colors.accent,    alignItems: "center",
    justifyContent: "center",
    // No-Line Rule: Removed borderWidth and borderColor    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  prominentLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.accent,
    marginTop: 4,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
});

export default BottomNavBar;
