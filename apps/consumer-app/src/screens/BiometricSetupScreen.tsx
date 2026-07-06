import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar, Platform } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { SCREENS } from '../constants/screens';
import { SovereignButton } from "../components/SovereignButton";
import { useSettingsStore } from '../stores/settingsStore';
import * as LocalAuthentication from 'expo-local-authentication';
import Animated, { 
  FadeInDown, 
  useAnimatedStyle, 
  useSharedValue, 
  withRepeat, 
  withTiming, 
  withSequence,
  Easing 
} from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import Toast, { useToast } from '../components/Toast';
import { Fingerprint } from 'lucide-react-native';

type BiometricSetupScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'BiometricSetup'>;

interface BiometricSetupScreenProps {
  navigation: BiometricSetupScreenNavigationProp;
}

export function BiometricSetupScreen({ navigation }: BiometricSetupScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const toast = useToast();
  const setBiometricsEnabled = useSettingsStore((state) => state.setBiometricsEnabled);

  const [isSupported, setIsSupported] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Animation for the laser scan line
  const scanLineY = useSharedValue(-40);

  useEffect(() => {
    // Start continuous scanning animation
    scanLineY.value = withRepeat(
      withSequence(
        withTiming(120, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(-40, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    // Check hardware support
    const checkBiometrics = async () => {
      try {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        console.log(`[BiometricSetup] compatible: ${compatible}, enrolled: ${enrolled}`);
        // In DEV, force true so we can at least see the UI for testing
        setIsSupported((compatible && enrolled) || __DEV__);
      } catch (e) {
        console.warn('Biometric check failed:', e);
        setIsSupported(__DEV__);
      } finally {
        setIsChecking(false);
      }
    };
    checkBiometrics();
  }, []);

  const handleLinkBiometrics = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to link biometrics to Veilpay',
        disableDeviceFallback: true,
        cancelLabel: 'Cancel',
      });

      if (result.success) {
        setBiometricsEnabled(true);
        toast.show('Biometrics linked successfully.', 'success');
        
        // Small delay to let user see success before navigating
        setTimeout(() => {
          navigation.reset({ index: 0, routes: [{ name: SCREENS.HOME }] });
        }, 1000);
      } else {
        toast.show('Authentication failed or canceled.', 'error');
      }
    } catch (e) {
      toast.show('An error occurred during authentication.', 'error');
    }
  };

  const handleSkip = () => {
    navigation.reset({ index: 0, routes: [{ name: SCREENS.HOME }] });
  };

  const animatedScanLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scanLineY.value }],
  }));

  // If still checking hardware, just show a blank screen to prevent flicker
  if (isChecking) {
    return <View style={styles.container} />;
  }

  // If biometrics are not supported on this device, skip the screen automatically
  if (!isSupported) {
    // Avoid state update during render warning by wrapping in setTimeout
    setTimeout(() => {
      handleSkip();
    }, 0);
    return <View style={styles.container} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.content}>
        
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.graphicContainer}>
          <View style={styles.iconWrapper}>
            <Fingerprint size={100} color={colors.accent} strokeWidth={1} />
            
            {/* The laser scan line */}
            <Animated.View style={[styles.scanLine, animatedScanLineStyle]}>
              <View style={styles.scanLineGlow} />
            </Animated.View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.textContainer}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>RECOMMENDED</Text>
          </View>
          <Text style={styles.title}>BIOMETRIC LINK</Text>
          <Text style={styles.subtitle}>
            Enable Face ID or Fingerprint for frictionless access to your vault.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(500)} style={styles.actionsContainer}>
          <SovereignButton
            title="LINK BIOMETRICS"
            variant="primary"
            onPress={handleLinkBiometrics}
            style={styles.primaryButton}
          />
          
          <PressableOpacity 
            style={styles.skipButton} 
            onPress={handleSkip}
            activeOpacity={0.7}
          >
            <Text style={styles.skipButtonText}>SKIP FOR NOW</Text>
          </PressableOpacity>
        </Animated.View>

      </View>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />
    </SafeAreaView>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'space-between',
  },
  graphicContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  iconWrapper: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.bgTertiary,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accent,
    boxShadow: `0px 0px 8px ${colors.accent}`,
    zIndex: 10,
  },
  scanLineGlow: {
    position: 'absolute',
    top: -20,
    left: 0,
    right: 0,
    height: 20,
    backgroundColor: colors.accent,
    opacity: 0.15,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  badge: {
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  badgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.accent,
    letterSpacing: 2,
    fontWeight: 'bold',
  },
  title: {
    fontFamily: typography.fontFamily.headlineSovereign,
    fontSize: 36,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  actionsContainer: {
    width: '100%',
    alignItems: 'center',
  },
  primaryButton: {
    width: '100%',
    marginBottom: 24,
  },
  skipButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.textMuted,
  },
  skipButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 1,
    fontWeight: 'bold',
  },
});

export default BiometricSetupScreen;
