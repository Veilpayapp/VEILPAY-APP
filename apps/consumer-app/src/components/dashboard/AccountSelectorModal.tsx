import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TouchableWithoutFeedback } from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInDown } from 'react-native-reanimated';
import { useTheme, useStyles, typography, spacing } from '../../styles/design-tokens';
import { Icon } from '../Icon';
import { useWalletStore, WalletAccount } from '../../stores/walletStore';
import { SovereignButton } from '../SovereignButton';

interface AccountSelectorModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AccountSelectorModal({ visible, onClose }: AccountSelectorModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  
  const rawAccounts = useWalletStore(state => state.accounts) || [];
  const activeAccountId = useWalletStore(state => state.activeAccountId);
  const switchAccount = useWalletStore(state => state.switchAccount);
  const addAccount = useWalletStore(state => state.addAccount);
  const isConnecting = useWalletStore(state => state.isConnecting);

  // Fallback if accounts is empty due to old state hydration
  const accounts = rawAccounts.length > 0 
    ? rawAccounts 
    : [{ id: '0', name: 'Account 1', index: 0 }];

  const handleSelectAccount = async (accountId: string) => {
    if (accountId === activeAccountId) {
      onClose();
      return;
    }
    
    await switchAccount(accountId);
    onClose();
  };
  
  const handleAddAccount = async () => {
    await addAccount();
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View entering={FadeIn.duration(200)} style={styles.overlay}>
          <TouchableWithoutFeedback>
            <Animated.View entering={SlideInDown.duration(300).springify()} style={styles.modalContainer}>
              <View style={styles.header}>
                <View>
                  <Text style={styles.title}>Your Accounts</Text>
                  <Text style={styles.subtitle}>Switch or create a new one</Text>
                </View>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Icon name="close" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.accountList} showsVerticalScrollIndicator={false}>
                {accounts.map((account, index) => {
                  const isActive = account.id === (activeAccountId || '0');
                  return (
                    <Animated.View key={account.id} entering={FadeInDown.delay(index * 100).duration(400)}>
                      <TouchableOpacity
                        style={[styles.accountRow, isActive && styles.accountRowActive]}
                        onPress={() => handleSelectAccount(account.id)}
                        disabled={isConnecting}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.accountIconContainer, isActive && styles.accountIconContainerActive]}>
                          <Icon name="user" size={20} color={isActive ? colors.textOnPrimary : colors.textPrimary} />
                        </View>
                        
                        <View style={styles.accountInfo}>
                          <Text style={[styles.accountName, isActive && styles.accountNameActive]}>
                            {account.name}
                          </Text>
                          {isActive && (
                            <Text style={styles.activeTag}>Current</Text>
                          )}
                        </View>

                        {isActive ? (
                          <View style={styles.checkmarkBadge}>
                            <Icon name="success" size={14} color={colors.textOnPrimary} />
                          </View>
                        ) : (
                          <Icon name="chevron-right" size={20} color={colors.outlineSubtle} />
                        )}
                      </TouchableOpacity>
                    </Animated.View>
                  );
                })}
              </ScrollView>
              
              <View style={styles.footer}>
                <SovereignButton
                  title="CREATE NEW ACCOUNT"
                  onPress={handleAddAccount}
                  disabled={isConnecting}
                  variant="primary"
                />
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.bgPrimary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  title: {
    fontFamily: typography.fontFamily.display,
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
  },
  closeBtn: {
    padding: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 20,
  },
  accountList: {
    padding: 20,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  accountRowActive: {
    backgroundColor: colors.accentContainer,
    borderColor: colors.accent,
  },
  accountIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  accountIconContainerActive: {
    backgroundColor: colors.accent,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontFamily: typography.fontFamily.body,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  accountNameActive: {
    color: colors.accent,
  },
  activeTag: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  checkmarkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: colors.outlineSubtle,
    paddingBottom: 40, // extra padding for bottom safe area
  },
});
