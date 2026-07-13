/**
 * Add a Stellar classic-asset trustline (code + issuer).
 * After success the parent should refresh token balances.
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { PressableOpacity } from './PressableOpacity';
import { Icon } from './Icon';
import { SovereignButton } from './SovereignButton';
import { typography, useTheme, useStyles } from '../styles/design-tokens';
import { establishStellarTrustline } from '../utils/stellarSigner';
import { triggerLightImpactHaptic } from '../utils/haptics';

const CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const ISSUER_RE = /^G[A-Z2-7]{55}$/;

interface StellarAddAssetModalProps {
  visible: boolean;
  chainKey: string;
  onClose: () => void;
  /** Called after a successful changeTrust with the new asset identity. */
  onSuccess: (asset: { code: string; issuer: string }) => void;
}

export function StellarAddAssetModal({
  visible,
  chainKey,
  onClose,
  onSuccess,
}: StellarAddAssetModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [code, setCode] = useState('');
  const [issuer, setIssuer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCode('');
    setIssuer('');
    setError(null);
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const assetCode = code.trim().toUpperCase();
    const assetIssuer = issuer.trim();
    setError(null);

    if (!CODE_RE.test(assetCode) || assetCode === 'XLM') {
      setError('Enter a valid asset code (1–12 letters/digits, not XLM).');
      return;
    }
    if (!ISSUER_RE.test(assetIssuer)) {
      setError('Issuer must be a Stellar public key (G…, 56 characters).');
      return;
    }

    setBusy(true);
    try {
      await establishStellarTrustline({
        chainKey,
        assetCode,
        assetIssuer,
      });
      triggerLightImpactHaptic();
      onSuccess({ code: assetCode, issuer: assetIssuer });
      reset();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add trustline';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <PressableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>ADD STELLAR ASSET</Text>
            <PressableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              disabled={busy}
              accessibilityLabel="Close"
            >
              <Icon name="close" size={20} color={colors.textMuted} />
            </PressableOpacity>
          </View>

          <Text style={styles.help}>
            Opens a trustline so this wallet can hold a classic asset (code + issuer).
            Requires a small XLM reserve (~0.5 XLM + fee). Circle USDC is listed by
            default — use this for other issuers.
          </Text>

          <Text style={styles.label}>ASSET CODE</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="e.g. USDC"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            maxLength={12}
            accessibilityLabel="Asset code"
          />

          <Text style={styles.label}>ISSUER (G…)</Text>
          <TextInput
            style={[styles.input, styles.inputIssuer]}
            value={issuer}
            onChangeText={setIssuer}
            placeholder="G…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            maxLength={56}
            accessibilityLabel="Asset issuer"
          />

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <SovereignButton
            title={busy ? 'SIGNING…' : 'ADD TRUSTLINE'}
            variant="primary"
            onPress={handleSubmit}
            disabled={busy}
            style={{ marginTop: 16 }}
            accessibilityLabel="Add trustline"
          />
          {busy ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const themeStyles = (colors: any) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    sheet: {
      backgroundColor: colors.bgSecondary,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 20,
      paddingBottom: 36,
      paddingTop: 8,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.outlineVariant,
      marginBottom: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    title: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 14,
      fontWeight: 'bold',
      letterSpacing: 1,
      color: colors.textPrimary,
    },
    closeButton: {
      padding: 8,
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    help: {
      fontFamily: typography.fontFamily.body,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
      marginBottom: 16,
    },
    label: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 11,
      letterSpacing: 1,
      color: colors.textMuted,
      marginBottom: 6,
      marginTop: 8,
    },
    input: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 15,
      color: colors.textPrimary,
      backgroundColor: colors.surfaceInput,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 48,
    },
    inputIssuer: {
      fontSize: 12,
    },
    error: {
      fontFamily: typography.fontFamily.body,
      fontSize: 13,
      color: colors.error,
      marginTop: 12,
    },
  });
