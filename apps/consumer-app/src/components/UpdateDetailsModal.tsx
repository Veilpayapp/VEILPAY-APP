import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableWithoutFeedback,
} from 'react-native';
import { useTheme, useStyles, typography, type Colors } from '../styles/design-tokens';
import { SovereignButton } from './SovereignButton';
import { Icon } from './Icon';
import { RELEASE_NOTES, type ReleaseNote } from '../constants/changelog';

interface UpdateDetailsModalProps {
  visible: boolean;
  /** Dismiss the modal. */
  onClose: () => void;
  /**
   * Release notes to display, newest first. Defaults to the full changelog
   * (`RELEASE_NOTES`) so callers usually just pass `visible`/`onClose`.
   */
  releases?: ReleaseNote[];
}

/**
 * "What's New" / update details modal. Presentational — it renders the release
 * notes from `src/constants/changelog.ts` so users can see exactly what each
 * update delivered. Opened from Settings → About → Version, and reusable
 * anywhere else it makes sense (e.g. right after an OTA update applies).
 *
 * Shares the branded, structural look of `UpdatePromptModal` (bordered card,
 * radius 0, mono headings).
 */
export function UpdateDetailsModal({
  visible,
  onClose,
  releases = RELEASE_NOTES,
}: UpdateDetailsModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContent}>
              <View style={styles.iconContainer}>
                <Icon name="flash" size={28} color={colors.accent} />
              </View>

              <Text style={styles.title}>What's New</Text>
              <Text style={styles.subtitle}>
                The latest fixes and improvements in Veilpay.
              </Text>

              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {releases.map((release, index) => (
                  <View
                    key={`${release.version}-${release.build}`}
                    style={[styles.releaseBlock, index > 0 && styles.releaseBlockDivider]}
                  >
                    <View style={styles.releaseHeaderRow}>
                      <Text style={styles.releaseVersion}>
                        v{release.version}{' '}
                        <Text style={styles.releaseBuild}>(Build {release.build})</Text>
                      </Text>
                      <Text style={styles.releaseDate}>{release.date}</Text>
                    </View>

                    {release.highlights.map((line, i) => (
                      <View key={i} style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.bulletText}>{line}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>

              <SovereignButton
                title="GOT IT"
                variant="primary"
                onPress={onClose}
                style={styles.button}
                accessibilityLabel="Close what's new"
              />
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 0,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 0,
    backgroundColor: colors.accent + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.accent + '40',
  },
  title: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  scroll: {
    width: '100%',
    marginBottom: 20,
  },
  scrollContent: {
    paddingBottom: 4,
  },
  releaseBlock: {
    width: '100%',
  },
  releaseBlockDivider: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: colors.outlineSubtle,
  },
  releaseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  releaseVersion: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  releaseBuild: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'normal',
    color: colors.textMuted,
  },
  releaseDate: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textFaint,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingRight: 4,
  },
  bulletDot: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.accent,
    marginRight: 8,
    lineHeight: 20,
  },
  bulletText: {
    flex: 1,
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  button: {
    width: '100%',
  },
});
