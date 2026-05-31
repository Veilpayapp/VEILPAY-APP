import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
} from 'react-native';
import Animated, {
  FadeIn,
  SlideInDown,
  SlideOutDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme, useStyles, typography } from '../../styles/design-tokens';
import { useAddressBookStore } from '../../stores/addressBookStore';
import { SUPPORTED_CHAINS, type ChainConfig } from '../../stores/walletStore';
import { Icon } from '../Icon';
import { getNetworkIcon } from '../NetworkIcons';

interface AddressBookModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (address: string) => void;
  currentChain: string;
}

// Chain-type color map for badges
const CHAIN_TYPE_COLORS: Record<string, string> = {
  evm: '#627EEA',
  svm: '#9945FF',
  mvm: '#00D4B0',
  xlm: '#00B4D8',
};

function getChainColor(chain: ChainConfig): string {
  const keyMap: Record<string, string> = {
    ethereum: '#627EEA',
    bsc: '#F0B90B',
    polygon: '#8247E5',
    arbitrum: '#28A0F0',
    base: '#0052FF',
    solana: '#9945FF',
    'solana-devnet': '#9945FF',
    aptos: '#00D4B0',
    stellar: '#00B4D8',
    'stellar-testnet': '#00B4D8',
    sepolia: '#627EEA',
  };
  return keyMap[chain.key] ?? CHAIN_TYPE_COLORS[chain.type] ?? '#F59E0B';
}

/** Compact badge showing a network icon + name */
function ChainBadge({ chainKey, colors }: { chainKey: string; colors: any }) {
  const chain = SUPPORTED_CHAINS.find((c) => c.key === chainKey);
  if (!chain) {
    return (
      <View style={[badgeStyles.badge, { backgroundColor: colors.bgContainerHigh }]}>
        <Text style={[badgeStyles.badgeText, { color: colors.textMuted }]} numberOfLines={1}>
          {chainKey.toUpperCase()}
        </Text>
      </View>
    );
  }
  const NetworkIconSVG = getNetworkIcon(chain.key);
  const accentColor = getChainColor(chain);
  return (
    <View style={[badgeStyles.badge, { backgroundColor: accentColor + '18' }]}>
      <NetworkIconSVG size={14} />
      <Text style={[badgeStyles.badgeText, { color: accentColor }]} numberOfLines={1}>
        {chain.name.toUpperCase()}
      </Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  badgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});

/** A small chip for selecting a chain in the add form */
function ChainChip({
  chain,
  selected,
  onPress,
  colors,
}: {
  chain: ChainConfig;
  selected: boolean;
  onPress: () => void;
  colors: any;
}) {
  const NetworkIconSVG = getNetworkIcon(chain.key);
  const accentColor = getChainColor(chain);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        chipStyles.chip,
        {
          backgroundColor: selected ? accentColor + '22' : colors.bgContainer,
          borderColor: selected ? accentColor : colors.outlineSubtle,
        },
      ]}
    >
      <NetworkIconSVG size={18} />
      <Text
        style={[
          chipStyles.chipText,
          { color: selected ? accentColor : colors.textMuted },
        ]}
        numberOfLines={1}
      >
        {chain.name}
      </Text>
      {selected && (
        <View style={[chipStyles.dot, { backgroundColor: accentColor }]} />
      )}
    </TouchableOpacity>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginLeft: 2,
  },
});

export function AddressBookModal({
  visible,
  onClose,
  onSelect,
  currentChain,
}: AddressBookModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { addresses, addAddress, removeAddress } = useAddressBookStore();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [selectedChainKey, setSelectedChainKey] = useState(currentChain || 'ethereum');
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Separate mainnets and testnets for the chain picker
  const mainnetChains = SUPPORTED_CHAINS.filter((c) => !c.isTestnet);
  const testnetChains = SUPPORTED_CHAINS.filter((c) => !!c.isTestnet);

  // Filter addresses: show all by default; search filters across all chains
  const filteredAddresses = addresses.filter((a) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.address.toLowerCase().includes(q) ||
      a.chain.toLowerCase().includes(q)
    );
  });

  const handleSave = useCallback(() => {
    if (newName.trim() && newAddress.trim()) {
      addAddress(newName.trim(), newAddress.trim(), selectedChainKey);
      setIsAdding(false);
      setNewName('');
      setNewAddress('');
      setSelectedChainKey(currentChain || 'ethereum');
    }
  }, [newName, newAddress, selectedChainKey, addAddress, currentChain]);

  const handleCancelAdd = useCallback(() => {
    setIsAdding(false);
    setNewName('');
    setNewAddress('');
    setSelectedChainKey(currentChain || 'ethereum');
  }, [currentChain]);

  const handleOpenAdd = useCallback(() => {
    setSelectedChainKey(currentChain || 'ethereum');
    setIsAdding(true);
  }, [currentChain]);

  const handleDelete = useCallback(
    (id: string) => {
      setDeletingId(id);
      setTimeout(() => {
        removeAddress(id);
        setDeletingId(null);
      }, 220);
    },
    [removeAddress]
  );

  if (!visible) return null;

  const canSave = newName.trim().length > 0 && newAddress.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(280)}
        exiting={FadeOut.duration(240)}
        style={styles.backdrop}
      >
        {/* Dismiss tap area */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />

        <Animated.View
          entering={SlideInDown.springify().damping(28).stiffness(90).mass(0.9)}
          exiting={SlideOutDown.springify().damping(28).stiffness(110).duration(240)}
          style={styles.sheet}
        >
          {/* Handle pill */}
          <View style={styles.handle} />

          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconWrap}>
                <Icon name="wallet" size={16} color={colors.accent} />
              </View>
              <Text style={styles.title}>Address Book</Text>
            </View>
            {!isAdding && (
              <TouchableOpacity onPress={handleOpenAdd} style={styles.addBtn} activeOpacity={0.7}>
                <View style={styles.addBtnInner}>
                  <Icon name="plus" size={16} color={colors.bgPrimary} />
                  <Text style={styles.addBtnText}>ADD</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Divider ── */}
          <View style={styles.divider} />

          {/* ── ADD FORM ── */}
          {isAdding ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.addContainer}
            >
              {/* Name */}
              <Text style={styles.fieldLabel}>CONTACT NAME</Text>
              <TextInput
                style={[styles.input, { borderColor: newName ? colors.accent + '60' : colors.outlineSubtle }]}
                placeholder="e.g. Alice's Vault"
                placeholderTextColor={colors.textFaint}
                value={newName}
                onChangeText={setNewName}
                autoFocus
                selectionColor={colors.accent}
              />

              {/* Address */}
              <Text style={styles.fieldLabel}>WALLET ADDRESS</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.monoInput,
                  { borderColor: newAddress ? colors.accent + '60' : colors.outlineSubtle },
                ]}
                placeholder="Enter wallet address"
                placeholderTextColor={colors.textFaint}
                value={newAddress}
                onChangeText={setNewAddress}
                autoCapitalize="none"
                autoCorrect={false}
                selectionColor={colors.accent}
              />

              {/* Chain / Network Picker */}
              <Text style={styles.fieldLabel}>NETWORK</Text>

              <Text style={styles.chainGroupLabel}>MAINNETS</Text>
              <View style={styles.chipRow}>
                {mainnetChains.map((chain) => (
                  <ChainChip
                    key={chain.key}
                    chain={chain}
                    selected={selectedChainKey === chain.key}
                    onPress={() => setSelectedChainKey(chain.key)}
                    colors={colors}
                  />
                ))}
              </View>

              <Text style={styles.chainGroupLabel}>TESTNETS</Text>
              <View style={styles.chipRow}>
                {testnetChains.map((chain) => (
                  <ChainChip
                    key={chain.key}
                    chain={chain}
                    selected={selectedChainKey === chain.key}
                    onPress={() => setSelectedChainKey(chain.key)}
                    colors={colors}
                  />
                ))}
              </View>

              {/* Action row */}
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={handleCancelAdd} activeOpacity={0.7}>
                  <Text style={[styles.cancelText, { color: colors.textMuted }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: canSave ? colors.accent : colors.bgContainerHigh }]}
                  onPress={handleSave}
                  disabled={!canSave}
                  activeOpacity={0.8}
                >
                  <Icon name="wallet" size={14} color={canSave ? colors.bgPrimary : colors.textFaint} />
                  <Text style={[styles.saveText, { color: canSave ? colors.bgPrimary : colors.textFaint }]}>
                    Save Contact
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            <>
              {/* ── Search bar ── */}
              {addresses.length > 0 && (
                <View style={styles.searchRow}>
                  <Icon name="search" size={16} color={colors.textTertiary} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search by name, address, or network…"
                    placeholderTextColor={colors.textFaint}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCorrect={false}
                    selectionColor={colors.accent}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Icon name="close" size={14} color={colors.textFaint} />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* ── Empty state ── */}
              {filteredAddresses.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <View style={styles.emptyIconWrap}>
                    <Icon name="wallet" size={28} color={colors.textFaint} />
                  </View>
                  <Text style={styles.emptyTitle}>
                    {searchQuery ? 'No matches found' : 'No contacts yet'}
                  </Text>
                  <Text style={styles.emptySubtext}>
                    {searchQuery
                      ? 'Try a different search term'
                      : 'Tap ADD to save a wallet address for quick access.'}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={filteredAddresses}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => {
                    const isDeleting = deletingId === item.id;
                    return (
                      <Animated.View
                        style={[styles.card, isDeleting && { opacity: 0.4 }]}
                      >
                        {/* Left: chain color accent bar */}
                        <ChainAccentBar chainKey={item.chain} />

                        {/* Card body */}
                        <TouchableOpacity
                          style={styles.cardContent}
                          activeOpacity={0.75}
                          onPress={() => {
                            onSelect(item.address);
                            onClose();
                          }}
                        >
                          <Text style={styles.cardName}>{item.name}</Text>
                          <Text style={styles.cardAddress} numberOfLines={1} ellipsizeMode="middle">
                            {item.address}
                          </Text>
                          <ChainBadge chainKey={item.chain} colors={colors} />
                        </TouchableOpacity>

                        {/* Delete button */}
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => handleDelete(item.id)}
                          disabled={isDeleting}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Icon name="trash" size={18} color={colors.errorMuted} />
                        </TouchableOpacity>
                      </Animated.View>
                    );
                  }}
                />
              )}
            </>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/** Thin vertical accent strip coloured by chain */
function ChainAccentBar({ chainKey }: { chainKey: string }) {
  const chain = SUPPORTED_CHAINS.find((c) => c.key === chainKey);
  const color = chain ? getChainColor(chain) : '#F59E0B';
  return <View style={[accentBarStyles.bar, { backgroundColor: color }]} />;
}

const accentBarStyles = StyleSheet.create({
  bar: {
    width: 3,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    alignSelf: 'stretch',
  },
});

const themeStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.72)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.bgSecondary,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      minHeight: '50%',
      maxHeight: '88%',
      paddingHorizontal: 20,
      paddingBottom: 32,
      paddingTop: 12,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: colors.outlineSubtle,
    },
    handle: {
      width: 44,
      height: 4,
      backgroundColor: colors.outlineVariant,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 20,
    },

    // ── Header ──────────────────────────────
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: colors.accentContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 20,
      color: colors.textPrimary,
      letterSpacing: -0.3,
    },
    addBtn: {
      borderRadius: 10,
      overflow: 'hidden',
    },
    addBtnInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
    },
    addBtnText: {
      fontFamily: 'Inter_700Bold',
      fontSize: 12,
      color: colors.bgPrimary,
      letterSpacing: 0.8,
    },
    divider: {
      height: 1,
      backgroundColor: colors.outlineSubtle,
      marginBottom: 16,
    },

    // ── Search ───────────────────────────────
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgContainer,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.outlineSubtle,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 10,
      marginBottom: 16,
    },
    searchInput: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textPrimary,
      paddingVertical: 0,
    },

    // ── Empty state ──────────────────────────
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 56,
    },
    emptyIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 20,
      backgroundColor: colors.bgContainer,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.outlineSubtle,
    },
    emptyTitle: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 17,
      color: colors.textPrimary,
      marginBottom: 8,
    },
    emptySubtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 24,
    },

    // ── Contact list ─────────────────────────
    listContent: {
      paddingBottom: 24,
      gap: 10,
    },
    card: {
      flexDirection: 'row',
      backgroundColor: colors.bgContainer,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.outlineSubtle,
      overflow: 'hidden',
    },
    cardContent: {
      flex: 1,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    cardName: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 4,
    },
    cardAddress: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 12,
      color: colors.textSecondary,
    },
    deleteBtn: {
      paddingHorizontal: 16,
      justifyContent: 'center',
      alignItems: 'center',
      borderLeftWidth: 1,
      borderLeftColor: colors.outlineSubtle,
    },

    // ── Add Form ─────────────────────────────
    addContainer: {
      paddingTop: 4,
      paddingBottom: 24,
    },
    fieldLabel: {
      fontFamily: 'Inter_700Bold',
      fontSize: 10,
      color: colors.textMuted,
      letterSpacing: 1.2,
      marginBottom: 8,
      marginTop: 4,
    },
    input: {
      backgroundColor: colors.bgContainer,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.outlineSubtle,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: colors.textPrimary,
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      marginBottom: 20,
    },
    monoInput: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 13,
    },
    chainGroupLabel: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 9,
      color: colors.textFaint,
      letterSpacing: 1.2,
      marginBottom: 8,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginBottom: 12,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 12,
    },
    cancelBtn: {
      paddingVertical: 12,
      paddingHorizontal: 20,
    },
    cancelText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
    },
    saveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 22,
      borderRadius: 100,
    },
    saveText: {
      fontFamily: 'Inter_700Bold',
      fontSize: 14,
    },
  });
