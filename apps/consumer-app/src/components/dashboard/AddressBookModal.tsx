import React, { useState, useCallback } from 'react';
import { View, Text, Modal, StyleSheet, FlatList, TextInput, ScrollView } from 'react-native';
import { PressableOpacity } from '../PressableOpacity';
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
    stellar: '#00B4D8',
    'stellar-testnet': '#00B4D8',
    sepolia: '#627EEA',
  };
  return keyMap[chain.key] ?? CHAIN_TYPE_COLORS[chain.type] ?? '#F59E0B';
}

function ChainBlock({ chainKey, colors }: { chainKey: string; colors: any }) {
  const chain = SUPPORTED_CHAINS.find((c) => c.key === chainKey);
  const color = chain ? getChainColor(chain) : colors.textPrimary;
  const env = chain ? (chain.isTestnet ? 'TESTNET' : 'MAINNET') : 'UNKNOWN';
  const NetworkIconSVG = getNetworkIcon(chainKey);
  return (
    <View style={[styles.chainBlock, { borderColor: color }]}>
      <View style={{ opacity: 1 }}><NetworkIconSVG size={14} /></View>
      <Text style={[styles.chainBlockText, { color }]} numberOfLines={1}>
        [ {chain ? `${chain.symbol.toUpperCase()} • ${env}` : `${chainKey.toUpperCase()} • ${env}`} ]
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chainBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0,
  },
  chainBlockText: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
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
    <PressableOpacity
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
    </PressableOpacity>
  );
}

const DELETING_ROW_STYLE = { opacity: 0.4 } as const;
const DELETE_BTN_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

interface LedgerRowProps {
  item: { id: string; name: string; address: string; chain: string };
  isDeleting: boolean;
  colors: any;
  styles: any;
  onSelect: (address: string) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

function LedgerRow({ item, isDeleting, colors, styles, onSelect, onClose, onDelete }: LedgerRowProps) {
  const handlePress = useCallback(() => {
    onSelect(item.address);
    onClose();
  }, [onSelect, onClose, item.address]);

  const handleDeletePress = useCallback(() => {
    onDelete(item.id);
  }, [onDelete, item.id]);

  return (
    <Animated.View style={[styles.ledgerRow, isDeleting && DELETING_ROW_STYLE]}>
      <PressableOpacity style={styles.ledgerContent} activeOpacity={0.7} onPress={handlePress}>
        <View style={styles.ledgerHeader}>
          <Text style={styles.ledgerName}>{item.name.toUpperCase()}</Text>
          <ChainBlock chainKey={item.chain} colors={colors} />
        </View>

        <View style={styles.ledgerFooter}>
          <Text style={styles.ledgerAddress} numberOfLines={1} ellipsizeMode="middle">
            {item.address}
          </Text>
        </View>
      </PressableOpacity>

      <PressableOpacity
        style={styles.ledgerDeleteBtn}
        onPress={handleDeletePress}
        disabled={isDeleting}
        hitSlop={DELETE_BTN_HIT_SLOP}
      >
        <Text style={styles.ledgerDeleteText}>✕</Text>
      </PressableOpacity>
    </Animated.View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 0,
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
    borderRadius: 0,
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

  const renderLedgerRow = useCallback(
    ({ item }: { item: (typeof filteredAddresses)[number] }) => (
      <LedgerRow
        item={item}
        isDeleting={deletingId === item.id}
        colors={colors}
        styles={styles}
        onSelect={onSelect}
        onClose={onClose}
        onDelete={handleDelete}
      />
    ),
    [deletingId, colors, styles, onSelect, onClose, handleDelete]
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
        <PressableOpacity
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
              <PressableOpacity onPress={handleOpenAdd} style={styles.addBtn} activeOpacity={0.7}>
                <View style={styles.addBtnInner}>
                  <Icon name="plus" size={16} color={colors.bgPrimary} />
                  <Text style={styles.addBtnText}>ADD</Text>
                </View>
              </PressableOpacity>
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
                <PressableOpacity style={styles.cancelBtn} onPress={handleCancelAdd} activeOpacity={0.7}>
                  <Text style={[styles.cancelText, { color: colors.textMuted }]}>Cancel</Text>
                </PressableOpacity>
                <PressableOpacity
                  style={[styles.saveBtn, { backgroundColor: canSave ? colors.accent : colors.bgContainerHigh }]}
                  onPress={handleSave}
                  disabled={!canSave}
                  activeOpacity={0.8}
                >
                  <Icon name="wallet" size={14} color={canSave ? colors.bgPrimary : colors.textFaint} />
                  <Text style={[styles.saveText, { color: canSave ? colors.bgPrimary : colors.textFaint }]}>
                    Save Contact
                  </Text>
                </PressableOpacity>
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
                    placeholder="SEARCH LEDGER..."
                    placeholderTextColor={colors.textFaint}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCorrect={false}
                    selectionColor={colors.accent}
                  />
                  {searchQuery.length > 0 && (
                    <PressableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Icon name="close" size={14} color={colors.textFaint} />
                    </PressableOpacity>
                  )}
                </View>
              )}

              {filteredAddresses.length === 0 ? (
                <View style={styles.emptyLedger}>
                  <Text style={styles.emptyLedgerArt}>[ / / / / / / / / ]</Text>
                  <Text style={styles.emptyLedgerTitle}>
                    {searchQuery ? '0 MATCHES' : 'EMPTY LEDGER'}
                  </Text>
                  <Text style={styles.emptyLedgerSub}>
                    {searchQuery ? 'SYS.SEARCH_FAILED' : 'AWAITING_INPUT...'}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={filteredAddresses}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  extraData={deletingId}
                  renderItem={renderLedgerRow}
                />
              )}
            </>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// Removed ChainAccentBar and accentBarStyles

const themeStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.opacityOverlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.bgSecondary,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
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
      borderRadius: 0,
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
      borderRadius: 0,
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
      borderRadius: 0,
      overflow: 'hidden',
    },
    addBtnInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 0,
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

    // ── Empty state ──────────────────────────
    emptyLedger: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderStyle: 'dashed',
      marginTop: 10,
    },
    emptyLedgerArt: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 24,
      color: colors.outlineVariant,
      letterSpacing: 4,
      marginBottom: 20,
    },
    emptyLedgerTitle: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 16,
      color: colors.textPrimary,
      fontWeight: '700',
      letterSpacing: 2,
      marginBottom: 8,
    },
    emptyLedgerSub: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 12,
      color: colors.textTertiary,
      letterSpacing: 1,
    },

    // ── Contact list (Ledger Blocks) ─────────
    listContent: {
      paddingBottom: 24,
      gap: 12,
    },
    ledgerRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.bgPrimary,
      borderRadius: 0,
    },
    ledgerContent: {
      flex: 1,
      padding: 16,
    },
    ledgerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    ledgerName: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 14,
      color: colors.textPrimary,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    ledgerFooter: {
      backgroundColor: colors.bgTertiary,
      paddingHorizontal: 8,
      paddingVertical: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    ledgerAddress: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 11,
      color: colors.textSecondary,
    },
    ledgerDeleteBtn: {
      width: 48,
      borderLeftWidth: 1,
      borderLeftColor: colors.outlineVariant,
      backgroundColor: colors.errorBg,
      justifyContent: 'center',
      alignItems: 'center',
    },
    ledgerDeleteText: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 18,
      color: colors.error,
      fontWeight: 'bold',
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
      borderRadius: 0,
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
      borderRadius: 0,
    },
    saveText: {
      fontFamily: 'Inter_700Bold',
      fontSize: 14,
    },
  });
