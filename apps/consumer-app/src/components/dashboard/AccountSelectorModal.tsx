import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TouchableWithoutFeedback, TextInput } from 'react-native';
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
  const updateAccountName = useWalletStore(state => state.updateAccountName);
  const deleteAccount = useWalletStore(state => state.deleteAccount);

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [accountToDelete, setAccountToDelete] = useState<string | null>(null);

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

  const handleEditSave = () => {
    if (editingAccountId && editNameValue.trim()) {
      updateAccountName(editingAccountId, editNameValue.trim());
    }
    setEditingAccountId(null);
  };

  const handleDeleteRequest = (accountId: string) => {
    setAccountToDelete(accountId);
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
                  <Text style={styles.title}>[ LEDGER_ACCOUNTS ]</Text>
                  <Text style={styles.subtitle}>SWITCH_OR_CREATE</Text>
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
                          {editingAccountId === account.id ? (
                            <TextInput
                              style={styles.accountNameInput}
                              value={editNameValue}
                              onChangeText={setEditNameValue}
                              onBlur={handleEditSave}
                              onSubmitEditing={handleEditSave}
                              autoFocus
                              selectTextOnFocus
                            />
                          ) : (
                            <Text style={[styles.accountName, isActive && styles.accountNameActive]}>
                              {account.name.toUpperCase()}
                            </Text>
                          )}
                          {isActive && (
                            <Text style={styles.activeTag}>Current</Text>
                          )}
                        </View>

                        {isActive ? (
                          <View style={styles.activeActions}>
                            <TouchableOpacity onPress={() => { setEditingAccountId(account.id); setEditNameValue(account.name); }} style={styles.actionBtn}>
                              <Icon name="edit" size={18} color={colors.textPrimary} />
                            </TouchableOpacity>
                            <View style={styles.checkmarkBadge}>
                              <Icon name="success" size={14} color={colors.textOnPrimary} />
                            </View>
                          </View>
                        ) : accountToDelete === account.id ? (
                          <View style={styles.inlineConfirmActions}>
                            <TouchableOpacity onPress={() => setAccountToDelete(null)} style={styles.inlineActionBtn}>
                              <Text style={styles.inlineCancelText}>CANCEL</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                              onPress={() => {
                                deleteAccount(account.id);
                                setAccountToDelete(null);
                              }} 
                              style={styles.inlineConfirmBtn}
                            >
                              <Text style={styles.inlineConfirmText}>DELETE</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.inactiveActions}>
                            <TouchableOpacity onPress={() => { setEditingAccountId(account.id); setEditNameValue(account.name); }} style={styles.actionBtn}>
                              <Icon name="edit" size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                            {accounts.length > 1 && (
                              <TouchableOpacity onPress={() => handleDeleteRequest(account.id)} style={styles.actionBtn}>
                                <Icon name="trash" size={18} color={colors.textSecondary} />
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </TouchableOpacity>
                    </Animated.View>
                  );
                })}
              </ScrollView>
              
              <View style={styles.footer}>
                <SovereignButton
                  title={isConnecting ? "CREATING..." : "CREATE NEW ACCOUNT"}
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
    backgroundColor: colors.opacityOverlay,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.bgPrimary,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
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
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 2,
  },
  closeBtn: {
    padding: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  accountList: {
    padding: 20,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 0,
    marginBottom: 12,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  accountRowActive: {
    backgroundColor: colors.accentContainer,
    borderColor: colors.accent,
  },
  accountIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 0,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  accountIconContainerActive: {
    backgroundColor: colors.accent,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 1,
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
    borderRadius: 0,
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
  accountNameInput: {
    fontFamily: typography.fontFamily.body,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    padding: 0,
    margin: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
  },
  activeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inactiveActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionBtn: {
    padding: 4,
  },
  inlineConfirmActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  inlineConfirmBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.error,
  },
  inlineCancelText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  inlineConfirmText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontWeight: '700',
    color: colors.error,
    letterSpacing: 0.5,
  },
});
