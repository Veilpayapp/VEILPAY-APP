/* istanbul ignore file */
/**
 * Veilpay QR Scanner Screen
 * Camera-based QR code scanner for payment addresses
 * Matches Stitch design with the current hybrid structural styling
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated, Linking, Platform } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { CameraView, CameraType, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { SCREENS } from '../constants/screens';
import Toast, { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { validateAddress, ChainType } from '../stores/walletStore';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';type QRScannerScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'QRScanner'>;const { width, height } = Dimensions.get('window');
const SCAN_AREA_SIZE = width * 0.7;

interface QRScannerScreenRouteParams {
  onScan?: (data: string) => void;
  mode?: 'send' | 'connect';
}

interface QRScannerScreenProps {
  navigation: QRScannerScreenNavigationProp;
  route: {
    params?: QRScannerScreenRouteParams;
  };
}

export function QRScannerScreen({ navigation, route }: QRScannerScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const toast = useToast();
  const scanLineAnimRef = useRef<Animated.Value | null>(null);
  if (scanLineAnimRef.current === null) scanLineAnimRef.current = new Animated.Value(0);
  const scanLineAnim = scanLineAnimRef.current;

  const mode = route?.params?.mode || 'send';
  const onScan = route?.params?.onScan;

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.QR_SCANNER_VIEWED, {
      mode,
    });
  }, [mode]);

  // Animate scan line
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),      ])
    );
    animation.start();
    return () => animation.stop();  }, []);

  const handleBarCodeScanned = (result: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);

    const { data } = result;

    // Try to validate as different chain types
    const chainTypes: ChainType[] = ['evm', 'svm', 'mvm', 'xlm'];
    let validatedAddress: string | null = null;
    let detectedChainType: ChainType | null = null;

    // Check for Ethereum URI format first (e.g., ethereum:0x...)
    const ethUriMatch = data.match(/^ethereum:(0x[a-fA-F0-9]{40})/);
    if (ethUriMatch) {
      const address = ethUriMatch[1];
      if (validateAddress(address, 'evm')) {
        validatedAddress = address;
        detectedChainType = 'evm';
      }
    }

    // If not a URI, try each chain type
    if (!validatedAddress) {
      for (const chainType of chainTypes) {
        if (validateAddress(data.trim(), chainType)) {
          validatedAddress = data.trim();
          detectedChainType = chainType;
          break;
        }
      }
    }

    if (validatedAddress && detectedChainType) {
      trackEvent(ANALYTICS_EVENTS.QR_SCAN_SUCCESS, {
        mode,
        chain_type: detectedChainType,
      });

      if (onScan) {
        onScan(validatedAddress);
        navigation.goBack();
      } else {
        // Navigate to send payment with the address
        // Note: chainType detection is handled by SendPaymentScreen's validation
        navigation.navigate(SCREENS.SEND_PAYMENT, {
          address: validatedAddress,
        });
      }
      toast.show(`${detectedChainType.toUpperCase()} address scanned successfully!`, 'success');
    } else {
      trackEvent(ANALYTICS_EVENTS.QR_SCAN_FAILED, {
        mode,
        reason: 'invalid_qr_payload',
      });
      toast.show('Invalid QR code. Please scan a valid wallet address.', 'error');
      // Allow rescanning after a delay
      setTimeout(() => setScanned(false), 2000);
    }
  };

  const handleOpenSettings = () => {
    trackEvent(ANALYTICS_EVENTS.QR_SCANNER_OPEN_SETTINGS_PRESSED, {
      mode,
      platform: Platform.OS,
    });

    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };  // Permission not granted
  if (!permission) {
    return (
      <View style={styles.container}>        <Text style={styles.loadingText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.permissionContainer}>
          <Icon name="camera" size={48} color={colors.accent} />
          <Text style={styles.permissionTitle}>CAMERA ACCESS REQUIRED</Text>
          <Text style={styles.permissionText}>
            Veilpay needs camera access to scan QR codes for wallet addresses and payment requests.
          </Text>
          <PressableOpacity
            style={styles.permissionButton}
            onPress={() => {
              trackEvent(ANALYTICS_EVENTS.QR_SCANNER_PERMISSION_REQUESTED, {
                mode,
              });
              void requestPermission();
            }}
            accessibilityRole="button"
            accessibilityLabel="Grant camera permission"
            accessibilityHint="Requests camera access for QR scanning"
          >
            <Text style={styles.permissionButtonText}>GRANT PERMISSION</Text>
          </PressableOpacity>
          <PressableOpacity
            style={styles.settingsButton}
            onPress={handleOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Open app settings"
            accessibilityHint="Opens device settings to manage permissions"
          >
            <Text style={styles.settingsButtonText}>Open Settings</Text>
          </PressableOpacity>
        </View>
      </View>
    );
  }

  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCAN_AREA_SIZE - 4],
  });

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={flashOn}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
      >
        {/* Header overlay */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <PressableOpacity
            style={styles.closeButton}
            onPress={() => {
              trackEvent(ANALYTICS_EVENTS.QR_SCANNER_CLOSE_PRESSED, {
                mode,
              });
              navigation.goBack();
            }}
            accessibilityRole="button"
            accessibilityLabel="Close QR scanner"
            accessibilityHint="Returns to the previous screen"
          >
            <Icon name="close" size={24} color={colors.textPrimary} />
          </PressableOpacity>
          <Text style={styles.headerTitle}>SCAN QR CODE</Text>
          <PressableOpacity
            style={styles.flashButton}
            onPress={() => {
              const nextFlashState = !flashOn;
              setFlashOn(nextFlashState);
              trackEvent(ANALYTICS_EVENTS.QR_SCANNER_FLASH_TOGGLED, {
                mode,
                flash_on: nextFlashState,
              });
            }}
            accessibilityRole="button"
            accessibilityLabel={flashOn ? 'Turn flash off' : 'Turn flash on'}
            accessibilityHint="Toggles camera flash while scanning"
          >
            <Icon name={flashOn ? 'flash' : 'flash-off'} size={24} color={colors.textPrimary} />
          </PressableOpacity>
        </View>

        {/* Scan area overlay */}
        <View style={styles.scanContainer}>
          <View style={styles.scanArea}>
            {/* Corner brackets */}
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />

            {/* Animated scan line */}
            <Animated.View
              style={[
                styles.scanLine,
                { transform: [{ translateY: scanLineTranslateY }] },
              ]}
            />
          </View>
        </View>

        {/* Instructions */}
        <View style={[styles.instructions, { paddingBottom: insets.bottom + 100 }]}>
          <Text style={styles.instructionText}>
            Point your camera at a wallet address QR code
          </Text>
          <Text style={styles.instructionSubtext}>
            Supports Ethereum, Solana, Aptos, and Stellar addresses
          </Text>
        </View>
      </CameraView>

      {/* Toast */}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  camera: {
    flex: 1,
  },
  loadingText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
    backgroundColor: 'rgba(10, 10, 10, 0.7)',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  closeIcon: {
    fontSize: 20,
    color: colors.textPrimary,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  flashButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  flashIcon: {
    fontSize: 20,
  },
  scanContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanArea: {
    width: SCAN_AREA_SIZE,
    height: SCAN_AREA_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: colors.accent,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accent,
    boxShadow: `0px 0px 8px ${colors.accent}`,
  },
  instructions: {
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 10, 0.7)',
  },
  instructionText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  instructionSubtext: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  permissionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
  permissionText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 0,
    marginBottom: 16,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textOnPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  settingsButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
});

