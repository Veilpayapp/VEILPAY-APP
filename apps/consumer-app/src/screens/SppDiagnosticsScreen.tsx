import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { ScreenBackButton } from '../components/ScreenBackButton';
import { SovereignButton } from '../components/SovereignButton';
import { SovereignCard } from '../components/SovereignCard';
import Toast, { useToast } from '../components/Toast';
import { SCREENS } from '../constants/screens';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  clearSppDiagnostics,
  exportSppDiagnostics,
  getSppDiagnostics,
  sppNetworkLabelFromChainKey,
  type SppDiagnosticRecord,
} from '../utils/stellarSpp/sppDiagnostics';
import { useWalletStore } from '../stores/walletStore';
import { useShallow } from 'zustand/react/shallow';
import {
  typography,
  useStyles,
  useTheme,
  type Colors,
} from '../styles/design-tokens';

type Props = NativeStackScreenProps<
  RootStackParamList,
  typeof SCREENS.SPP_DIAGNOSTICS
>;

export function SppDiagnosticsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const toast = useToast();
  const { activeChain } = useWalletStore(
    useShallow((s) => ({ activeChain: s.activeChain }))
  );
  const activeNetworkLabel = activeChain?.isTestnet ? 'TESTNET' : activeChain?.key === 'stellar' ? 'MAINNET' : undefined;
  const [records, setRecords] = useState<SppDiagnosticRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setRecords(await getSppDiagnostics());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleShare = async () => {
    const message = await exportSppDiagnostics(activeNetworkLabel);
    await Share.share({ message, title: 'Veilpay SPP diagnostics' });
  };

  const handleClear = async () => {
    await clearSppDiagnostics();
    setRecords([]);
    toast.show('Private-payment diagnostics cleared', 'success');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>PRIVATE PAYMENT DIAGNOSTICS</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.description}>
          Release-safe SPP steps and errors. Records exclude wallet addresses,
          amounts, recipients, notes, and key material.
        </Text>

        <View style={styles.actions}>
          <SovereignButton title="REFRESH" variant="outline" onPress={refresh} />
          <SovereignButton
            title="EXPORT"
            variant="outline"
            onPress={handleShare}
            disabled={records.length === 0}
          />
          <SovereignButton
            title="CLEAR"
            variant="outline"
            onPress={handleClear}
            disabled={records.length === 0}
          />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : records.length === 0 ? (
          <Text style={styles.empty}>No SPP diagnostic records yet.</Text>
        ) : (
          records.map((record) => (
            <SovereignCard key={record.id} style={styles.record}>
              <View style={styles.recordHeader}>
                <Text style={styles.step}>{record.step}</Text>
                <Text
                  style={[
                    styles.status,
                    record.status === 'error' && { color: colors.error },
                    record.status === 'success' && { color: colors.success },
                  ]}
                >
                  {record.status.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.meta}>{record.timestamp}</Text>
              {record.chainKey ? (
                <Text style={styles.meta}>
                  Network: {sppNetworkLabelFromChainKey(record.chainKey) ?? record.chainKey}
                </Text>
              ) : null}
              {record.contractId ? (
                <Text selectable style={styles.meta}>
                  Contract: {record.contractId}
                </Text>
              ) : null}
              {record.contractFunction ? (
                <Text style={styles.meta}>
                  Function: {record.contractFunction}
                </Text>
              ) : null}
              {record.code ? (
                <Text selectable style={styles.code}>
                  {record.code}
                </Text>
              ) : null}
              {record.message ? (
                <Text selectable style={styles.message}>
                  {record.message}
                </Text>
              ) : null}
              {record.rawError && record.rawError !== record.message ? (
                <Text selectable style={styles.rawError}>
                  {record.rawError}
                </Text>
              ) : null}
              {record.txHash ? (
                <Text selectable style={styles.meta}>
                  Tx: {record.txHash}
                </Text>
              ) : null}
            </SovereignCard>
          ))
        )}
      </ScrollView>
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />
    </SafeAreaView>
  );
}

const themeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surfaceScreen },
    header: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      gap: 8,
    },
    title: {
      fontFamily: typography.fontFamily.mono,
      color: colors.textPrimary,
      fontSize: 17,
      fontWeight: '700',
    },
    content: { padding: 20, paddingTop: 4, gap: 12 },
    description: {
      fontFamily: typography.fontFamily.body,
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
    },
    actions: { gap: 8, marginBottom: 4 },
    empty: {
      fontFamily: typography.fontFamily.body,
      color: colors.textMuted,
      textAlign: 'center',
      paddingVertical: 32,
    },
    record: { gap: 6 },
    recordHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    step: {
      flex: 1,
      fontFamily: typography.fontFamily.mono,
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    status: {
      fontFamily: typography.fontFamily.mono,
      color: colors.textMuted,
      fontSize: 10,
    },
    meta: {
      fontFamily: typography.fontFamily.mono,
      color: colors.textTertiary,
      fontSize: 10,
      lineHeight: 15,
    },
    code: {
      fontFamily: typography.fontFamily.mono,
      color: colors.accent,
      fontSize: 11,
    },
    message: {
      fontFamily: typography.fontFamily.body,
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
    },
    rawError: {
      fontFamily: typography.fontFamily.mono,
      color: colors.textMuted,
      fontSize: 10,
      lineHeight: 15,
    },
  });
