/**
 * Private XLM status (Settings).
 *
 * Product send path is the main Send Payment screen (shield / transfer / unshield).
 * This hub is for account readiness, private balance, and recovery actions.
 *
 * Locked: app-only, native prove (no product WebView), testnet-first.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  TextInput,
  ActivityIndicator,
  Alert,
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
import {
  deposit,
  getLocalPrivateBalance,
  getSppStatus,
  isSppEnabledForChain,
  prepareSppOp,
  transfer,
  withdraw,
  ensureSppAccountReady,
  insertAspMembershipLeaf,
  SppClientError,
  type SppPrepChecklist,
} from '../utils/stellarSpp';
import type { SppNoteRecord } from '../stores/sppNoteStore';
import { getSppAccount } from '../stores/sppAccountStore';

/**
 * DATA-001 / SPP-001: Shielded balances are stored on THIS DEVICE ONLY —
 * until chain-backed note recovery ships, reinstalling the app, clearing
 * state, or losing the device can make shielded funds inaccessible even
 * though the pool still holds them.
 *
 * The exact wording MUST stay aligned between the always-visible banner
 * and the shield-action confirmation dialog. Keep both referencing these
 * constants — see review suggestion #12.
 *
 * This screen is NOT registered in AppNavigator (any build). Product path
 * is background ASP + pXLM selection / Send. File kept for unit tests and
 * rare manual mounts only.
 */
const SHIELD_FUND_LOSS_WARNING_TITLE = '⚠ TESTNET ONLY — DO NOT SHIELD REAL FUNDS';
const SHIELD_FUND_LOSS_WARNING_BODY =
  'Your private balance is stored on this device. If you reinstall the ' +
  'app, clear app data, switch devices, or lose your phone, you may not ' +
  'be able to recover shielded funds — even with your seed phrase. ' +
  'Recovery from chain is not available in this build. Only shield ' +
  'testnet XLM you can afford to lose.';
const SHIELD_CONFIRM_TITLE = 'Shield funds — read first';
const SHIELD_CONFIRM_BODY =
  'Shielded XLM is tracked on THIS DEVICE ONLY. Recovery from your ' +
  'seed phrase is NOT available in this build. If you lose access to ' +
  'this device or clear app data, you may not be able to unshield ' +
  'these funds. Only shield testnet XLM you can afford to lose.';

type Nav = NativeStackNavigationProp<Record<string, object | undefined>>;
type Route = RouteProp<Record<string, object | undefined>, string>;

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
  const [aspBusy, setAspBusy] = useState(false);
  const [aspDetail, setAspDetail] = useState<string | null>(null);
  const proveReady = Boolean(prep?.readyForProve);
  /** One auto insert attempt per mount when leaf is ready (avoid effect loops). */
  const aspAutoAttempted = useRef(false);

  const refreshNotes = useCallback(async () => {
    if (!chainKey || !address) {
      setPrivateBalance('0');
      setNotes([]);
      setPrep(null);
      setAspDetail(null);
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
      const acc = await getSppAccount(chainKey, address).catch(() => null);
      if (acc?.aspLeafDecimal) {
        setAspDetail(
          acc.aspInserted
            ? `Account registered${acc.aspInsertTxHash ? ` · ${acc.aspInsertTxHash.slice(0, 12)}…` : ''}`
            : 'Account ready to register'
        );
      } else {
        setAspDetail(null);
      }
    } finally {
      setRefreshing(false);
    }
  }, [chainKey, address]);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

  // Auto-complete account membership registration once the local leaf is ready.
  useEffect(() => {
    if (!enabled || !chainKey || !address || !prep) return;
    if (!prep.hasAspLeaf || prep.aspInserted) return;
    if (aspAutoAttempted.current || aspBusy) return;
    aspAutoAttempted.current = true;
    let cancelled = false;
    void (async () => {
      setAspBusy(true);
      try {
        const ready = await ensureSppAccountReady(chainKey, address);
        if (cancelled) return;
        if (ready.aspReady) {
          toast.show('Private account registered', 'success');
          await refreshNotes();
        }
      } catch {
        /* user can tap Register manually */
      } finally {
        if (!cancelled) setAspBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when leaf appears
  }, [enabled, chainKey, address, prep?.hasAspLeaf, prep?.aspInserted]);

  const runAspRegister = async () => {
    if (!chainKey || !address) {
      toast.show('Connect a wallet first', 'error');
      return;
    }
    setAspBusy(true);
    try {
      // Full ensure: re-derive if needed, then insert_leaf.
      const ready = await ensureSppAccountReady(chainKey, address);
      if (ready.aspReady) {
        toast.show(ready.message || 'Private account ready', 'success');
        await refreshNotes();
        return;
      }
      if (ready.hasLeaf && ready.account.aspLeafDecimal) {
        const inserted = await insertAspMembershipLeaf(
          chainKey,
          address,
          ready.account.aspLeafDecimal
        );
        toast.show(
          `Private account registered · ${inserted.txHash.slice(0, 10)}…`,
          'success'
        );
        await refreshNotes();
        return;
      }
      toast.show(ready.message || 'Could not complete private account setup', 'info');
      await refreshNotes();
    } catch (e) {
      const err = e as Error;
      toast.show(err.message || 'Private account registration failed', 'error');
    } finally {
      setAspBusy(false);
    }
  };

  const runOp = async (op: 'deposit' | 'transfer' | 'withdraw') => {
    if (!chainKey || !address) {
      toast.show('Connect a wallet first', 'error');
      return;
    }
    if (!enabled) {
      toast.show('Private XLM is only available on Stellar Testnet for now', 'error');
      return;
    }
    if (!proveReady) {
      const blocker = prep?.blockers[0];
      toast.show(blocker || 'Private payments are still getting ready', 'info');
      await refreshNotes();
      return;
    }

    // DATA-001: confirm shield actions so the user acknowledges that the
    // shielded balance is device-bound and not recoverable from seed alone.
    if (op === 'deposit') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          SHIELD_CONFIRM_TITLE,
          SHIELD_CONFIRM_BODY,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'I understand, shield', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: true }
        );
      });
      if (!confirmed) return;
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
          'Private transfers are not available in this app version yet. Account setup is still available.',
          'info'
        );
      } else if (code === 'SPP_ASP_SIM_FAILED' || code === 'SPP_ASP_SUBMIT_FAILED') {
        toast.show(err.message || 'Private account registration failed — check testnet funds and try again', 'error');
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
            Open Token Selector or Home → Privacy → select pXLM. That turns on
            private mode and finishes setup automatically. Then use Shield, Transfer,
            or Unshield from Home — the same Send screen as public payments.
          </Text>
        </SovereignCard>

        {/*
          DATA-001 / SPP-001 safety banner.
          pXLM shielded balances are tracked by SecureStore note records on
          THIS DEVICE ONLY. There is no chain-backed recovery scanner yet, so
          reinstalling the app, clearing app state, or losing the device can
          make shielded funds inaccessible even though the pool still holds
          them. Until deterministic note recovery ships, this surface is
          testnet-only and users MUST NOT shield real funds.
        */}
        <SovereignCard style={StyleSheet.flatten([styles.card, styles.warningCard])}>
          <Text style={styles.warningTitle}>{SHIELD_FUND_LOSS_WARNING_TITLE}</Text>
          <Text style={styles.warningBody}>{SHIELD_FUND_LOSS_WARNING_BODY}</Text>
        </SovereignCard>

        {!enabled ? (
          <SovereignCard style={styles.card}>
            <Text style={styles.cardTitle}>Testnet only</Text>
            <Text style={styles.body}>
              Shielded Stellar payments are available on Stellar Testnet in this
              preview. Switch network to Stellar Testnet, then return here.
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
                Your private balance is tracked on this device. Back up your wallet
                seed before changing phones or reinstalling the app.
              </Text>
            </SovereignCard>

            <SovereignCard style={styles.card}>
              <Text style={styles.cardTitle}>Private payments</Text>
              <Text style={styles.body}>
                {status.native.poolOps
                  ? 'Ready for shielded transfers on this device.'
                  : 'Account setup is available. Shielded transfers unlock in the next app update.'}
              </Text>
              <Text style={styles.caption}>
                Private payment proofs are created locally and never fall back to a public send.
              </Text>
            </SovereignCard>

            {prep ? (
              <SovereignCard style={styles.card}>
                <Text style={styles.cardTitle}>Setup status</Text>
                <Text style={styles.body}>
                  Network: {prep.chainEnabled ? 'Ready' : 'Switch to Stellar Testnet'}
                  {'\n'}
                  Device keys: {prep.keysSigned ? 'Ready' : 'Action needed'}
                  {'\n'}
                  Account membership: {prep.aspInserted ? 'Registered' : prep.hasAspLeaf ? 'Ready to register' : 'Preparing'}
                  {'\n'}
                  Private transfers: {prep.readyForProve ? 'Ready' : 'Waiting for setup'}
                </Text>
                {aspDetail ? (
                  <Text style={styles.mono} selectable numberOfLines={2}>
                    {aspDetail}
                  </Text>
                ) : null}
                {prep.blockers.length > 0 ? (
                  <Text style={styles.caption}>
                    Still needed:{'\n'}
                    {prep.blockers.map((b) => `· ${b}`).join('\n')}
                  </Text>
                ) : null}
                {!prep.aspInserted && prep.keysSigned ? (
                  <View style={styles.actions}>
                    <SovereignButton
                      title={aspBusy ? 'Registering account…' : 'Register private account'}
                      onPress={() => void runAspRegister()}
                      disabled={aspBusy || busy}
                      accessibilityLabel="Register private account on chain"
                    />
                  </View>
                ) : null}
                {prep.aspInserted && !prep.poolOps ? (
                  <Text style={styles.caption}>
                     Account membership is registered. Shield, Transfer, and Unshield
                     will unlock in the next app update. Until then, private payments
                     stay safely disabled and never send publicly.
                  </Text>
                ) : null}
                {prep.aspInserted && prep.poolOps ? (
                  <Text style={styles.caption}>
                    Private payments are ready. Shield, Transfer, and Unshield create
                    proofs locally on this device.
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
                accessibilityLabel="Private payment amount"
              />
              <Text style={styles.cardTitle}>Recipient</Text>
              <TextInput
                style={styles.input}
                value={recipient}
                onChangeText={setRecipient}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="G… or leave blank to unshield to self"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="Private payment recipient"
              />

              <View style={styles.actions}>
                <SovereignButton
                  title="Shield"
                  onPress={() => void runOp('deposit')}
                  disabled={busy || !proveReady}
                  accessibilityLabel="Shield deposit into private pool"
                />
                <SovereignButton
                  title="Private transfer"
                  variant="secondary"
                  onPress={() => void runOp('transfer')}
                  disabled={busy || !proveReady}
                  accessibilityLabel="Private transfer"
                />
                <SovereignButton
                  title="Unshield"
                  variant="outline"
                  onPress={() => void runOp('withdraw')}
                  disabled={busy || !proveReady}
                  accessibilityLabel="Unshield withdraw"
                />
              </View>
              {!proveReady ? (
                <Text style={styles.caption}>
                  Shield, Transfer, and Unshield unlock after setup is complete.
                </Text>
              ) : null}
              {busy ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
            </SovereignCard>

            <SovereignCard style={styles.card}>
              <Text style={styles.cardTitle}>Private records ({notes.length})</Text>
              {notes.length === 0 ? (
                <Text style={styles.caption}>No private records yet.</Text>
              ) : (
                notes.map((n) => (
                  <Text key={n.id} style={styles.noteRow}>
                    {n.spent ? 'spent' : 'unspent'} · {n.amount} XLM
                    {n.lastTxHash ? ` · ${n.lastTxHash.slice(0, 8)}…` : ''}
                  </Text>
                ))
              )}
              <SovereignButton
                title="Refresh records"
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
  warning?: string;
  warningBg?: string;
}) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surfaceScreen,
    },
    warningCard: {
      borderColor: colors.warning ?? '#f59e0b',
      borderWidth: 1,
      backgroundColor: colors.warningBg ?? 'rgba(245, 158, 11, 0.08)',
    },
    warningTitle: {
      fontFamily: typography.fontFamily.bodyBold,
      fontSize: typography.fontSize.small,
      color: colors.warning ?? '#f59e0b',
      marginBottom: 8,
      letterSpacing: 0.5,
    },
    warningBody: {
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.small,
      color: colors.textMuted,
      lineHeight: 20,
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
