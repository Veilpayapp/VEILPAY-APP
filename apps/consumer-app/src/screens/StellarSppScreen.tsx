/**
 * Private XLM diagnostics (Settings).
 *
 * Product send path is the main Send Payment screen (shield / transfer / unshield).
 * This hub is for bridge status, checklist, and dogfood — not the primary UX.
 *
 * Locked: app-only, native prove (no product WebView), testnet-first.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';

import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { SovereignCard } from '../components/SovereignCard';
import { SovereignButton } from '../components/SovereignButton';
import { ScreenBackButton } from '../components/ScreenBackButton';
import Toast, { useToast } from '../components/Toast';
import { useWalletStore } from '../stores/walletStore';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  deposit,
  getLocalPrivateBalance,
  getSppStatus,
  isSppEnabledForChain,
  prepareSppOp,
  transfer,
  withdraw,
  SppClientError,
  type SppPrepChecklist,
} from '../utils/stellarSpp';
import type { SppNoteRecord } from '../stores/sppNoteStore';


type Nav = NativeStackNavigationProp<RootStackParamList, 'StellarSpp'>;
type Route = RouteProp<RootStackParamList, 'StellarSpp'>;

interface Props {
  navigation: Nav;
  route: Route;
}

export function StellarSppScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const toast = useToast();
  const { address, activeChain } = useWalletStore(
    useShallow((s) => ({
      address: s.address,
      activeChain: s.activeChain,
    }))
  );

  const chainKey = activeChain?.key ?? null;
  const enabled = isSppEnabledForChain(chainKey);
  const status = getSppStatus(chainKey);

  const [amount, setAmount] = useState('1');
  const [recipient, setRecipient] = useState('');
  const [privateBalance, setPrivateBalance] = useState('0');
  const [notes, setNotes] = useState<SppNoteRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [prep, setPrep] = useState<SppPrepChecklist | null>(null);

  const refreshNotes = useCallback(async () => {
    if (!chainKey || !address) {
      setPrivateBalance('0');
      setNotes([]);
      setPrep(null);
      return;
    }
    setRefreshing(true);
    try {
      const { amount: bal, notes: list } = await getLocalPrivateBalance(chainKey, address);
      setPrivateBalance(bal);
      setNotes(list);
      try {
        setPrep(await prepareSppOp(chainKey, address));
      } catch {
        setPrep(null);
      }
    } finally {
      setRefreshing(false);
    }
  }, [chainKey, address]);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);


  const runOp = async (op: 'deposit' | 'transfer' | 'withdraw') => {
    if (!chainKey || !address) {
      toast.show('Connect a wallet first', 'error');
      return;
    }
    if (!enabled) {
      toast.show('Private XLM is only available on Stellar Testnet for now', 'error');
      return;
    }
    setBusy(true);
    try {
      if (op === 'deposit') {
        await deposit(chainKey, address, amount);
      } else if (op === 'transfer') {
        await transfer(chainKey, address, amount, {
          kind: 'address',
          stellarAddress: recipient.trim(),
        });
      } else {
        await withdraw(chainKey, address, amount, recipient.trim() || undefined);
      }
      toast.show(`${op} submitted`, 'success');
      await refreshNotes();
    } catch (e) {
      const err = e as SppClientError | Error;
      const code = 'code' in err ? (err as SppClientError).code : undefined;
      if (code === 'SPP_OPS_NOT_READY') {
        toast.show(
          'Private prove path not linked yet. Select pXLM under Privacy, then try Shield from Home.',
          'info'
        );
      } else {
        toast.show(err.message || `${op} failed`, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Private status</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SovereignCard style={styles.card}>
          <Text style={styles.cardTitle}>How to use Private XLM</Text>
          <Text style={styles.body}>
            Open Token Selector or Home → [ PRIVACY ] → select pXLM. That turns on
            private mode and finishes setup automatically. Then use Shield / Transfer
            / Unshield on Home — same Send screen as public payments. This page is
            diagnostics only.
          </Text>
        </SovereignCard>

        {!enabled ? (
          <SovereignCard style={styles.card}>
            <Text style={styles.cardTitle}>Testnet only</Text>
            <Text style={styles.body}>
              Shielded Stellar payments are enabled on Stellar Testnet. Mainnet stays
              fail-closed until audit and ceremony gates. Switch network to Stellar
              Testnet, then return here.
            </Text>
          </SovereignCard>
        ) : (
          <>
            <SovereignCard style={styles.card}>
              <Text style={styles.cardTitle}>Private balance</Text>
              <Text style={styles.balance}>
                {refreshing ? '…' : privateBalance} XLM
              </Text>
              <Text style={styles.caption}>
                Local notes only until native sync is wired. Notes are device-bound
                secrets — back up your wallet seed.
              </Text>
              {status.config ? (
                <Text style={styles.mono} numberOfLines={1}>
                  Pool {status.config.poolId.slice(0, 8)}…{status.config.poolId.slice(-6)}
                </Text>
              ) : null}
            </SovereignCard>

            <SovereignCard style={styles.card}>
              <Text style={styles.cardTitle}>Native bridge</Text>
              <Text style={styles.body}>
                version: {status.version}
                {'\n'}
                ping: {status.ping}
                {'\n'}
                poolOps: {status.native.poolOps ? 'ready' : 'not ready'} · backend:{' '}
                {status.native.backend}
              </Text>
              <Text style={styles.caption}>
                Same Rust sdk/pool path as the spp CLI. Product WebView is out of scope.
              </Text>
            </SovereignCard>

            {prep ? (
              <SovereignCard style={styles.card}>
                <Text style={styles.cardTitle}>Ready checklist</Text>
                <Text style={styles.body}>
                  chain: {prep.chainEnabled ? 'ok' : 'no'}
                  {'\n'}
                  native ping: {prep.nativePing ? 'ok' : 'no'}
                  {'\n'}
                  keys signed: {prep.keysSigned ? 'ok' : 'no'}
                  {'\n'}
                  ASP leaf: {prep.hasAspLeaf ? 'ok' : 'pending native'}
                  {'\n'}
                  ASP inserted: {prep.aspInserted ? 'ok' : 'no'}
                  {'\n'}
                  pool ops: {prep.poolOps ? 'ok' : 'not linked'}
                  {'\n'}
                  prove-ready: {prep.readyForProve ? 'yes' : 'no'}
                </Text>
                {prep.blockers.length > 0 ? (
                  <Text style={styles.caption}>
                    Blockers:{'\n'}
                    {prep.blockers.map((b) => `· ${b}`).join('\n')}
                  </Text>
                ) : null}
                {prep.asp.cliHint ? (
                  <Text style={styles.mono} selectable>
                    {prep.asp.cliHint}
                  </Text>
                ) : null}
              </SovereignCard>
            ) : null}


            <SovereignCard style={styles.card}>
              <Text style={styles.cardTitle}>Amount (XLM)</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="1.0"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="SPP amount"
              />
              <Text style={styles.cardTitle}>Recipient (transfer / optional withdraw)</Text>
              <TextInput
                style={styles.input}
                value={recipient}
                onChangeText={setRecipient}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="G… or leave blank to unshield to self"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="SPP recipient"
              />

              <View style={styles.actions}>
                <SovereignButton
                  title="Shield (deposit)"
                  onPress={() => void runOp('deposit')}
                  disabled={busy}
                  accessibilityLabel="Shield deposit into private pool"
                />
                <SovereignButton
                  title="Private transfer"
                  variant="secondary"
                  onPress={() => void runOp('transfer')}
                  disabled={busy}
                  accessibilityLabel="Private transfer"
                />
                <SovereignButton
                  title="Unshield (withdraw)"
                  variant="outline"
                  onPress={() => void runOp('withdraw')}
                  disabled={busy}
                  accessibilityLabel="Unshield withdraw"
                />
              </View>
              {busy ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
            </SovereignCard>

            <SovereignCard style={styles.card}>
              <Text style={styles.cardTitle}>Local notes ({notes.length})</Text>
              {notes.length === 0 ? (
                <Text style={styles.caption}>No local notes yet.</Text>
              ) : (
                notes.map((n) => (
                  <Text key={n.id} style={styles.noteRow}>
                    {n.spent ? 'spent' : 'unspent'} · {n.amount} XLM
                    {n.lastTxHash ? ` · ${n.lastTxHash.slice(0, 8)}…` : ''}
                  </Text>
                ))
              )}
              <SovereignButton
                title="Refresh notes"
                variant="outline"
                onPress={() => void refreshNotes()}
                disabled={refreshing}
              />
            </SovereignCard>
          </>
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

const themeStyles = (colors: {
  surfaceScreen: string;
  textPrimary: string;
  textMuted: string;
  textTertiary: string;
  bgContainer: string;
  outlineVariant: string;
  accent: string;
}) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surfaceScreen,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    headerTitle: {
      fontFamily: typography.fontFamily.headline,
      fontSize: typography.fontSize.h2,
      flex: 1,
      textAlign: 'center',
      color: colors.textPrimary,
    },
    headerSpacer: { width: 80 },
    content: {
      padding: 24,
      gap: 16,
      paddingBottom: 48,
    },
    card: {
      marginBottom: 4,
    },
    cardTitle: {
      fontFamily: typography.fontFamily.bodyBold,
      fontSize: typography.fontSize.small,
      color: colors.textPrimary,
      marginBottom: 8,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    body: {
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.body,
      color: colors.textMuted,
      lineHeight: 22,
    },
    caption: {
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.small,
      color: colors.textTertiary,
      marginTop: 8,
    },
    balance: {
      fontFamily: typography.fontFamily.headlineSovereign,
      fontSize: typography.fontSize.display,
      color: colors.accent,
    },
    mono: {
      fontFamily: typography.fontFamily.mono,
      fontSize: typography.fontSize.micro,
      color: colors.textTertiary,
      marginTop: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.bgContainer,
      color: colors.textPrimary,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 12,
      borderRadius: 0,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.body,
    },
    actions: {
      gap: 10,
      marginTop: 8,
    },
    spinner: { marginTop: 12 },
    noteRow: {
      fontFamily: typography.fontFamily.mono,
      fontSize: typography.fontSize.small,
      color: colors.textMuted,
      marginBottom: 6,
    },
  });
