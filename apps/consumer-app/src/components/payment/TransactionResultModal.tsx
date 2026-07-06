import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Modal } from 'react-native';
import { PressableOpacity } from '../PressableOpacity';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  FadeIn,
  FadeOut
} from 'react-native-reanimated';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { Icon } from '../Icon';
import { SovereignButton } from '../SovereignButton';

interface TransactionResultModalProps {
  visible: boolean;
  status: 'confirmed' | 'failed';
  errorMessage?: string;
  onViewExplorer?: () => void;
  onGoHome: () => void;
}

export function TransactionResultModal({
  visible,
  status,
  errorMessage,
  onViewExplorer,
  onGoHome,
}: TransactionResultModalProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      scale.value = withSequence(
        withTiming(0.5, { duration: 0 }),
        withSpring(1, { damping: 12, stiffness: 100 })
      );
      opacity.value = withTiming(1, { duration: 300 });
    } else {
      opacity.value = withTiming(0, { duration: 200 });
      scale.value = withTiming(0.8, { duration: 200 });
    }
  }, [visible, scale, opacity]);

  const animatedIconStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    };
  });

  const animatedContentStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
      transform: [
        {
          translateY: withDelay(
            150,
            withSpring(visible ? 0 : 20, { damping: 15, stiffness: 100 })
          ),
        },
      ],
    };
  });

  if (!visible) return null;

  const isSuccess = status === 'confirmed';
  const iconColor = isSuccess ? colors.successMuted : colors.error;
  const iconName = isSuccess ? 'success' : 'error';
  const titleText = isSuccess ? 'PAYMENT SENT' : 'TRANSACTION FAILED';
  const subtitleText = isSuccess
    ? 'Your transaction has been successfully confirmed on the blockchain.'
    : errorMessage || 'There was an issue processing your transaction.';

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Animated.View style={[styles.iconContainer, animatedIconStyle]}>
            <View style={[styles.iconCircle, { backgroundColor: iconColor + '20' }]}>
              <Icon name={iconName} size={48} color={iconColor} />
            </View>
          </Animated.View>

          <Animated.View style={[styles.contentContainer, animatedContentStyle]}>
            <Text style={styles.title}>{titleText}</Text>
            <Text style={styles.subtitle}>{subtitleText}</Text>

            <View style={styles.buttonContainer}>
              {onViewExplorer && (
                <SovereignButton
                  title="VIEW ON EXPLORER"
                  onPress={onViewExplorer}
                  variant="secondary"
                  style={styles.explorerButton}
                />
              )}
              <SovereignButton
                title="RETURN TO HOME"
                onPress={onGoHome}
                variant="primary"
                style={styles.homeButton}
              />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentContainer: {
    width: '100%',
    alignItems: 'center',
  },
  title: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 24,
    color: colors.textPrimary,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: typography.fontFamily.body,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 48,
    lineHeight: 24,
  },
  buttonContainer: {
    width: '100%',
    gap: 16,
  },
  explorerButton: {
    width: '100%',
  },
  homeButton: {
    width: '100%',
  },
});
