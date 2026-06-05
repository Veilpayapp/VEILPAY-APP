import React, { useState } from "react";
import { View, TouchableOpacity, StyleSheet, Text } from "react-native";
import { useTheme, useStyles, typography } from "../../styles/design-tokens";
import { Logo } from "../Logo";
import { Icon } from "../Icon";
import { AccountSelectorModal } from "./AccountSelectorModal";
import { useWalletStore } from "../../stores/walletStore";

interface DashboardHeaderProps {
  onSettingsPress: () => void;
}

export function DashboardHeader({ onSettingsPress }: DashboardHeaderProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  
  const accounts = useWalletStore(state => state.accounts) || [];
  const activeAccountId = useWalletStore(state => state.activeAccountId);
  
  // Fallback if accounts is empty due to old state hydration
  const activeAccount = accounts.length > 0 
    ? (accounts.find(a => a.id === activeAccountId) || accounts[0])
    : { id: '0', name: 'Account 1', index: 0 };

  return (
    <View style={styles.header}>
      <Logo variant="manual" size="small" />
      <View style={styles.headerActions}>
        <TouchableOpacity 
          style={styles.accountSelectorBtn}
          onPress={() => setAccountModalVisible(true)}
        >
          <View style={styles.accountIconContainer}>
            <Icon name="user" size={16} color={colors.accent} />
          </View>
          <Text style={styles.accountNameText}>{activeAccount.name}</Text>
          <Icon name="chevron-down" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={onSettingsPress}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          accessibilityHint="Opens settings screen"
        >
          <Icon name="settings" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
      
      <AccountSelectorModal 
        visible={accountModalVisible} 
        onClose={() => setAccountModalVisible(false)} 
      />
    </View>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerActions: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  accountSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  accountIconContainer: {
    width: 20,
    height: 20,
    borderRadius: 0,
    backgroundColor: colors.accentContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountNameText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
