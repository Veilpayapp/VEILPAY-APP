/* istanbul ignore file */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";
import { HybridInput } from '../components/HybridInput';
import { SovereignButton } from '../components/SovereignButton';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { Icon } from '../components/Icon';
import { useWalletStore, type ChainConfig, type ChainType } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type AddCustomNetworkNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  typeof SCREENS.ADD_CUSTOM_NETWORK
>;

interface AddCustomNetworkScreenProps {
  navigation: AddCustomNetworkNavigationProp;
}export function AddCustomNetworkScreen({ navigation }: AddCustomNetworkScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const addCustomChain = useWalletStore((s: { addCustomChain: (chain: ChainConfig) => void }) => s.addCustomChain);

  const [name, setName] = useState('');
  const [chainId, setChainId] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [explorerUrl, setExplorerUrl] = useState('');
  const [symbol, setSymbol] = useState('');
  const [isTestnet, setIsTestnet] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateRpc = useCallback(async (): Promise<boolean> => {
    if (!rpcUrl.trim()) {
      setError('RPC URL is required');
      return false;
    }

    try {
      new URL(rpcUrl);
    } catch {
      setError('Invalid RPC URL format');
      return false;
    }

    setIsValidating(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_chainId',
          params: [],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        setError(`RPC returned status ${response.status}`);
        return false;
      }

      const data = await response.json() as { result?: string; error?: { message?: string } };

      if (data.error) {
        setError(`RPC error: ${data.error.message}`);
        return false;
      }

      const reportedChainId = data.result ? parseInt(data.result, 16) : NaN;

      if (!Number.isNaN(reportedChainId) && chainId) {
        const enteredChainId = parseInt(chainId, 10);
        if (!Number.isNaN(enteredChainId) && reportedChainId !== enteredChainId) {
          setError(
            `Chain ID mismatch: RPC reports ${reportedChainId} but you entered ${enteredChainId}`
          );
          return false;
        }
      }

      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('RPC validation timed out (8s)');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to validate RPC');
      }
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [rpcUrl, chainId]);

  const handleSave = useCallback(async () => {
    setError(null);

    if (!name.trim()) {
      setError('Network name is required');
      return;
    }

    if (!chainId.trim()) {
      setError('Chain ID is required');
      return;
    }

    if (!symbol.trim()) {
      setError('Token symbol is required');
      return;
    }

    const parsedChainId = parseInt(chainId, 10);
    if (Number.isNaN(parsedChainId) || parsedChainId <= 0) {
      setError('Chain ID must be a positive integer');
      return;
    }

    const rpcValid = await validateRpc();
    if (!rpcValid) {
      return;
    }

    const chainKey = `custom-${parsedChainId}`;

    const existingChains = useWalletStore.getState().allChains();
    const existingChain = existingChains.find((c: ChainConfig) => c.key === chainKey);

    if (existingChain) {
      setError(`A network with Chain ID ${parsedChainId} already exists`);
      return;
    }

    const newChain: ChainConfig = {
      id: parsedChainId,
      key: chainKey,
      name: name.trim(),
      type: 'evm' as ChainType,
      symbol: symbol.trim().toUpperCase(),
      rpcUrl: rpcUrl.trim(),
      explorerUrl: explorerUrl.trim() || '',
      isTestnet,
      nativeToken: {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        decimals: 18,
      },
    };

    addCustomChain(newChain);

    Alert.alert(
      'Network Added',
      `${name.trim()} has been added to your networks.`,      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );  }, [name, chainId, rpcUrl, explorerUrl, symbol, validateRpc, addCustomChain, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.flex}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'android' ? 'height' : 'padding'}
        >
      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>ADD NETWORK</Text>
        <View style={{ width: 80 }} />
      </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <HybridInput
            label="Network Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Avalanche C-Chain"
            autoCapitalize="words"
          />

          <HybridInput
            label="Chain ID"
            value={chainId}
            onChangeText={setChainId}
            placeholder="e.g. 43114"
            keyboardType="number-pad"
          />

          <HybridInput
            label="RPC URL"
            value={rpcUrl}
            onChangeText={setRpcUrl}
            placeholder="https://api.avax.network/ext/bc/C/rpc"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <HybridInput
            label="Block Explorer URL (optional)"
            value={explorerUrl}
            onChangeText={setExplorerUrl}
            placeholder="https://snowtrace.io"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <HybridInput
            label="Native Token Symbol"
            value={symbol}
            onChangeText={setSymbol}
            placeholder="e.g. AVAX"
            autoCapitalize="characters"
            maxLength={10}
          />

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Testnet</Text>
            <Switch
              value={isTestnet}
              onValueChange={setIsTestnet}
              trackColor={{ false: colors.bgContainerHigh, true: colors.accentMuted }}
              thumbColor={isTestnet ? colors.accent : colors.textTertiary}
            />
          </View>

          {isTestnet && (
            <View style={styles.testnetBadge}>
              <Icon name="info" size={14} color={colors.accent} />
              <Text style={styles.testnetNote}>
                Testnet networks use fake tokens and are for development only.
              </Text>
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Icon name="error" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <SovereignButton
            title={isValidating ? 'Validating RPC...' : 'Add Network'}
            onPress={handleSave}
            disabled={isValidating || !name || !chainId || !rpcUrl || !symbol}
            variant="primary"
          />
        </View>
      </KeyboardAvoidingView>
      </Animated.View>
    </SafeAreaView>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    height: 64,
    // No-Line Rule: Removed borderBottomWidth and borderBottomColor
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  toggleLabel: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.body,
    color: colors.textSecondary,
  },
  testnetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accentContainer,
    borderRadius: 8,
    padding: 12,
  },
  testnetNote: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.small,
    color: colors.accentLight,
    flex: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.errorSurface,
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.small,
    color: colors.error,
    flex: 1,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 32,
  },
});
