import React from 'react';
import { Modal, TouchableOpacity, View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { triggerLightImpactHaptic } from '../utils/haptics';
import { SovereignCard } from './SovereignCard';
import { Icon } from './Icon';
import { getNetworkIcon } from './NetworkIcons';
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";
import type { ChainConfig } from '../stores/walletStore';

interface NetworkSelectorModalProps {
  visible: boolean;
  activeChain: ChainConfig | null;
  chains: ChainConfig[];
  onSelect: (chain: ChainConfig) => void;
  onClose: () => void;
  onAddCustomNetwork?: () => void;
  title?: string;
}

export function NetworkSelectorModal({
  visible,
  activeChain,
  chains = [],
  onSelect,
  onClose,
  onAddCustomNetwork,
  title = 'SELECT NETWORK',
}: NetworkSelectorModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [searchQuery, setSearchQuery] = React.useState('');

  const { mainnets, testnets } = React.useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filtered = chains.filter(chain => 
      !query || 
      chain.name.toLowerCase().includes(query) || 
      chain.symbol.toLowerCase().includes(query) ||
      chain.type.toLowerCase().includes(query)
    );

    return {
      mainnets: filtered.filter(c => !c.isTestnet),
      testnets: filtered.filter(c => !!c.isTestnet)
    };
  }, [chains, searchQuery]);
  
  // Reset search when modal opens
  React.useEffect(() => {
    if (visible) setSearchQuery('');
  }, [visible]);
  
  return (
    <Modal 
      visible={visible} 
      transparent 
      animationType="slide" 
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity 
          style={StyleSheet.absoluteFill} 
          activeOpacity={1} 
          onPress={onClose} 
        />
        <View style={styles.content}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
            >
              <Icon name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Premium Search Bar */}
          <View style={styles.searchContainer}>
            <Icon name="search" size={18} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search networks or tokens..."
              placeholderTextColor={colors.textFaint}
              value={searchQuery}
              onChangeText={setSearchQuery}
              selectionColor={colors.accent}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Network Selection Warning */}
          <View style={styles.warningBanner}>
            <Icon name="info" size={16} color={colors.warning} />
            <Text style={styles.warningText}>
              Ensure your destination address is on the same network to avoid permanent loss of funds.
            </Text>
          </View>

          <ScrollView style={styles.listContainer} showsVerticalScrollIndicator={false}>
            {mainnets.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>[ PRODUCTION MAINNETS ]</Text>
                  <View style={styles.sectionLine} />
                </View>
                {mainnets.map((chain) => (
                  <ChainItem 
                    key={chain.key} 
                    chain={chain} 
                    selected={activeChain?.key === chain.key} 
                    onSelect={onSelect} 
                    styles={styles} 
                    colors={colors} 
                  />
                ))}
              </View>
            )}

            {testnets.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>[ DEVELOPMENT TESTNETS ]</Text>
                  <View style={styles.sectionLine} />
                </View>
                {testnets.map((chain) => (
                  <ChainItem 
                    key={chain.key} 
                    chain={chain} 
                    selected={activeChain?.key === chain.key} 
                    onSelect={onSelect} 
                    styles={styles} 
                    colors={colors} 
                  />
                ))}
              </View>
            )}

            {mainnets.length === 0 && testnets.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No results found for "{searchQuery}"</Text>
              </View>
            )}

            {onAddCustomNetwork && (
              <View style={styles.addNetworkContainer}>
                <TouchableOpacity
                  style={styles.addNetworkButton}
                  onPress={() => {
                    import('../utils/haptics').then(h => h.triggerLightImpactHaptic());
                    onAddCustomNetwork();
                  }}
                  activeOpacity={0.8}
                >
                  <Icon name="plus" size={14} color={colors.textPrimary} />
                  <Text style={styles.addNetworkText}>ADD CUSTOM NETWORK</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Sub-component for individual chain items to keep the main modal clean
function ChainItem({ chain, selected, onSelect, styles, colors }: any) {
  const getDisplayType = (chain: any) => {
    const env = chain.isTestnet ? 'TESTNET' : 'MAINNET';
    return `[ ${chain.symbol.toUpperCase()} • ${env} ]`;
  };

  return (
    <TouchableOpacity
      onPress={() => {
        triggerLightImpactHaptic();
        onSelect(chain);
      }}
      activeOpacity={0.85}
      style={styles.chainRow}
    >
      <View style={[
        styles.chainItem,
        selected && styles.chainItemActive
      ]}>
        <View style={[
          styles.chainIconContainer,
          selected && styles.chainIconContainerActive
        ]}>
          {(() => {
            const NetworkIconSVG = getNetworkIcon(chain.key);
            return <NetworkIconSVG size={38} />;
          })()}
        </View>
        <View style={styles.chainMainInfo}>
          <Text style={[
            styles.chainName, 
            selected && styles.chainNameActive
          ]}>
            {chain.name.toUpperCase()}
          </Text>
          <Text style={[
            styles.chainType, 
            selected && styles.chainTypeActive
          ]}>
            {getDisplayType(chain)}
          </Text>
        </View>
        <View style={styles.chainRightInfo}>
          <Text style={[
            styles.chainSymbol, 
            selected && styles.chainSymbolActive
          ]}>
            {chain.symbol}
          </Text>
          {selected && (
            <View style={styles.activeIndicator}>
              <Icon name="success" size={14} color={colors.bgPrimary} />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
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
    maxHeight: '80%',
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
    marginBottom: 4,
  },
  title: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
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
  searchPlaceholder: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textFaint,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 0,
    textTransform: 'uppercase',
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    fontWeight: '700',
    letterSpacing: 1,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineSubtle,
    opacity: 0.5,
  },
  closeButton: {
    padding: 4,
  },
  warningBanner: {
    flexDirection: 'row',
    backgroundColor: colors.warningBg + '15',
    padding: 12,
    borderRadius: 0,
    marginBottom: 20,
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.warningBg + '30',
  },
  warningText: {
    flex: 1,
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 11,
    color: colors.warning,
    lineHeight: 15,
  },
  listContainer: {
    gap: 12,
  },
  chainRow: {
    width: '100%',
    marginBottom: 10,
  },
  chainItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 0,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  chainItemActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chainIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  chainIconContainerActive: {
    backgroundColor: 'transparent',
  },
  chainMainInfo: {
    flex: 1,
    gap: 2,
  },
  chainName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  chainNameActive: {
    color: colors.bgPrimary,
  },
  chainType: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 9,
    color: colors.textMuted,
    letterSpacing: 1,
    fontWeight: '700',
  },
  chainTypeActive: {
    color: colors.bgPrimary,
    opacity: 0.8,
  },
  chainRightInfo: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  chainSymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: 'bold',
  },
  chainSymbolActive: {
    color: colors.bgPrimary,
  },
  activeIndicator: {
    width: 20,
    height: 20,
    borderRadius: 0,
    backgroundColor: colors.opacityButtonBackdrop,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addNetworkContainer: {
    marginTop: 12,
    paddingHorizontal: 4,
  },
  addNetworkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 0,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
    gap: 8,
  },
  addNetworkText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

export default NetworkSelectorModal;
