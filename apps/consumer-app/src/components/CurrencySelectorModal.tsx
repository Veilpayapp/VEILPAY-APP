import React, { useState, useMemo } from 'react';
import { Modal, View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { PressableOpacity } from './PressableOpacity';
import { triggerLightImpactHaptic } from '../utils/haptics';
import { Icon } from './Icon';
import { typography, useTheme, useStyles } from "../styles/design-tokens";
import { CURRENCIES } from "../constants/currencies";

interface CurrencySelectorModalProps {
  visible: boolean;
  activeCurrency: string;
  onSelect: (currency: string) => void;
  onClose: () => void;
}

export function CurrencySelectorModal({
  visible,
  activeCurrency,
  onSelect,
  onClose,
}: CurrencySelectorModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCurrencies = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return CURRENCIES;
    return CURRENCIES.filter(
      (c) =>
        c.id.toLowerCase().includes(query) ||
        c.name.toLowerCase().includes(query) ||
        c.symbol.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // Reset search when the modal opens — adjust during render to avoid a stale frame.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setSearchQuery('');
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <PressableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.content}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>SELECT NATIVE CURRENCY</Text>
            <PressableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={20} color={colors.textMuted} />
            </PressableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <Icon name="search" size={18} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search currencies..."
              placeholderTextColor={colors.textFaint}
              value={searchQuery}
              onChangeText={setSearchQuery}
              selectionColor={colors.accent}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <PressableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close" size={16} color={colors.textTertiary} />
              </PressableOpacity>
            )}
          </View>

          <ScrollView style={styles.listContainer} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              {filteredCurrencies.map((currency) => {
                const selected = activeCurrency === currency.id;
                return (
                  <PressableOpacity
                    key={currency.id}
                    onPress={() => {
                      triggerLightImpactHaptic();
                      onSelect(currency.id);
                    }}
                    activeOpacity={0.85}
                    style={styles.currencyRow}
                  >
                    <View style={[styles.currencyItem, selected && styles.currencyItemActive]}>
                      <View style={[styles.currencyIconContainer, selected && styles.currencyIconContainerActive]}>
                        <Text style={[styles.currencySymbol, selected && styles.currencySymbolActive]}>{currency.symbol}</Text>
                      </View>
                      <View style={styles.currencyMainInfo}>
                        <Text style={[styles.currencyName, selected && styles.currencyNameActive]}>
                          {currency.name}
                        </Text>
                        <Text style={[styles.currencyId, selected && styles.currencyIdActive]}>
                          {currency.id}
                        </Text>
                      </View>
                      <View style={styles.currencyRightInfo}>
                        {selected && (
                          <View style={styles.activeIndicator}>
                            <Icon name="success" size={14} color={colors.bgPrimary} />
                          </View>
                        )}
                      </View>
                    </View>
                  </PressableOpacity>
                );
              })}
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.opacityOverlayHeavy,
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: colors.surfaceScreen,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingHorizontal: 24,
    paddingBottom: 20,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
    borderBottomWidth: 0,
  },
  handle: {
    width: 44,
    height: 5,
    backgroundColor: colors.outlineSubtle,
    borderRadius: 0,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
    opacity: 0.8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 16,
  },
  title: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
    borderRadius: 0,
    borderWidth: 1,
    borderBottomWidth: 3,
    borderColor: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    marginBottom: 24,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 0,
    textTransform: 'uppercase',
  },
  listContainer: {
    gap: 12,
  },
  section: {
    marginBottom: 24,
    gap: 10,
  },
  currencyRow: {
    width: '100%',
    marginBottom: 10,
  },
  currencyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 0,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  currencyItemActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  currencyIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 0,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  currencyIconContainerActive: {
    backgroundColor: colors.opacityButtonBackdrop,
  },
  currencySymbol: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  currencySymbolActive: {
    color: colors.bgPrimary,
  },
  currencyMainInfo: {
    flex: 1,
    gap: 2,
  },
  currencyName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  currencyNameActive: {
    color: colors.bgPrimary,
  },
  currencyId: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 1,
    fontWeight: '700',
  },
  currencyIdActive: {
    color: colors.bgPrimary,
    opacity: 0.8,
  },
  currencyRightInfo: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  activeIndicator: {
    width: 20,
    height: 20,
    borderRadius: 0,
    backgroundColor: colors.opacityButtonBackdrop,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
