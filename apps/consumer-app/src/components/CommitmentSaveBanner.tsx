/**
 * Persistent banner shown whenever the in-memory pending commitment
 * queue is non-empty.
 *
 * This is *not* a toast: it stays mounted until every queued
 * `CommitmentRecord` has been written to SecureStore. The copy
 * (`Funds at risk — commitment not saved`) is from the design's
 * Failure Mode Matrix and is the user's only signal that a
 * confirmed deposit's secret material may be lost.
 *
 * The banner does not offer a dismiss action: dismissing would
 * silence the only warning between the user and unrecoverable
 * funds. The retry hook (`useDepositPersistenceRecovery`) is what
 * removes the banner once SecureStore writes succeed.
 *
 * See:
 *   - requirements.md Requirement 7.7
 *   - design.md §Failure Mode Matrix
 *   - tasks.md task 7.4
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  selectHasPendingCommitments,
  usePendingCommitmentQueue,
} from '../stores/pendingCommitmentQueue';
import { useStyles, type Colors } from '../styles/design-tokens';

const TITLE = 'Funds at risk — commitment not saved';
const BODY =
  'A deposit was confirmed on-chain but its recovery secret could not be saved on this device. We will keep retrying. Do not uninstall the app or clear storage until this banner disappears.';

export function CommitmentSaveBanner(): React.ReactElement | null {
  const hasPending = usePendingCommitmentQueue(selectHasPendingCommitments);
  const pendingCount = usePendingCommitmentQueue((state) => state.pending.length);
  const styles = useStyles(themeStyles);

  if (!hasPending) {
    return null;
  }

  const accessibilityLabel = pendingCount === 1
    ? `${TITLE}. ${BODY}`
    : `${TITLE}. ${pendingCount} commitments pending. ${BODY}`;

  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={accessibilityLabel}
      testID="commitment-save-banner"
    >
      <Text style={styles.title} testID="commitment-save-banner-title">
        {TITLE}
      </Text>
      <Text style={styles.body} testID="commitment-save-banner-body">
        {BODY}
      </Text>
      {pendingCount > 1 ? (
        <Text style={styles.meta} testID="commitment-save-banner-count">
          {pendingCount} commitments queued
        </Text>
      ) : null}
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    backgroundColor: colors.errorBg,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  body: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  meta: {
    color: colors.textPrimary,
    fontSize: 11,
    marginTop: 4,
    opacity: 0.8,
  },
});
