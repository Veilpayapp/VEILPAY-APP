const fs = require('fs');

const code = `import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../styles/design-tokens';
import { SCREENS } from '../constants/screens';
import { Logo } from '../components/Logo';

const FEATURES = [
  { id: '1', icon: '🛡️', title: 'STEALTH ADDRESS', description: 'Generated one-time addresses for every transaction to break on-chain links.' },
  { id: '2', icon: '✨', title: 'ZK PROOFS', description: 'Mathematical privacy guarantees while ensuring total integrity limits.' },
  { id: '3', icon: '🌐', title: 'MULTI-CHAIN', description: 'Seamless support for EVM, SVM, and MVM ecosystems within a single vault.' },
];

export function OnboardingScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" /> 
      
      <View style={styles.scrollContent}>
        <View style={styles.header}>
          <Logo variant="manual" size="small" />
        </View>

        <View style={styles.heroSection}>
          <Text style={styles.headline}>PRIVATE PAYMENTS,{\\n}FULLY YOURS.</Text>
          <View style={styles.badgeContainer}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>SECURE THE VOID.</Text>
            </View>
          </View>
        </View>

        <View style={styles.featuresStack}>
          {FEATURES.map((item) => (
            <View key={item.id} style={styles.featureCardWrap}>
              <View style={styles.featureCard}>
                <View style={styles.iconContainer}>
                  <Text style={styles.featureIcon}>{item.icon}</Text>
                </View>
                <View style={styles.featureTextContainer}>
                  <Text style={styles.featureTitle}>{item.title}</Text>
                  <Text style={styles.featureDescription}>{item.description}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.primaryButtonWrap}
            onPress={() => navigation.navigate(SCREENS.WALLET_CONNECT)}
            activeOpacity={0.9}
          >
            <View style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>GET STARTED</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate(SCREENS.WALLET_CONNECT)}
            activeOpacity={0.6}
          >
            <Text style={styles.secondaryButtonText}>RESTORE EXISTING VAULT</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  scrollContent: { flex: 1, paddingHorizontal: 24, paddingBottom: 48, paddingTop: 12, justifyContent: 'space-between' },
  header: { height: 64, justifyContent: 'center', alignItems: 'center' },
  
  heroSection: { alignItems: 'center', paddingTop: 12 },
  headline: { fontFamily: typography.fontFamily.headlineBold, fontSize: 32, lineHeight: 40, color: '#FFFFFF', textAlign: 'center', textTransform: 'uppercase', marginBottom: 16 },
  
  badgeContainer: {
    shadowColor: '#F59E0B',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 0,
    transform: [{ rotate: '-2deg' }],
    backgroundColor: '#000',
  },
  badge: { 
    backgroundColor: '#FFFFFF', 
    paddingHorizontal: 16, 
    paddingVertical: 6, 
    borderWidth: 2, 
    borderColor: '#0A0A0A', 
  },
  badgeText: { fontFamily: typography.fontFamily.mono, fontSize: 13, color: '#000000', fontWeight: 'bold', letterSpacing: 1 },
  
  featuresStack: { gap: 20, marginBottom: 24, marginTop: 24 },
  
  featureCardWrap: {
    shadowColor: '#F59E0B',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 0,
    backgroundColor: '#000',
  },
  featureCard: { 
    backgroundColor: '#111111', 
    padding: 20, 
    flexDirection: 'row', 
    alignItems: 'flex-start', 
    gap: 16,
    borderWidth: 2,
    borderColor: '#353534',
  },
  
  iconContainer: { 
    backgroundColor: '#0A0A0A', 
    width: 48, 
    height: 48, 
    alignItems: 'center', 
    justifyContent: 'center', 
    borderWidth: 2, 
    borderColor: '#353534', 
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  featureIcon: { fontSize: 20 },
  
  featureTextContainer: { flex: 1, gap: 6 },
  featureTitle: { fontFamily: typography.fontFamily.mono, fontSize: 16, color: '#F59E0B', fontWeight: 'bold' },
  featureDescription: { fontFamily: typography.fontFamily.bodyMedium, fontSize: 14, color: '#A3A3A3', lineHeight: 20 },
  
  footer: { paddingTop: 16, alignItems: 'center', gap: 24 },
  
  primaryButtonWrap: {
    width: '100%',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 0,
    backgroundColor: '#000',
  },
  primaryButton: { 
    backgroundColor: '#FFFFFF', 
    borderWidth: 2, 
    borderColor: '#0A0A0A',
    width: '100%', 
    paddingVertical: 18, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  primaryButtonText: { fontFamily: typography.fontFamily.mono, fontSize: 16, color: '#000000', fontWeight: 'bold', letterSpacing: 1.5 },
  
  secondaryButton: { 
    borderBottomWidth: 1, 
    borderColor: '#A3A3A3',
    paddingBottom: 2
  },
  secondaryButtonText: { fontFamily: typography.fontFamily.mono, fontSize: 13, color: '#A3A3A3', letterSpacing: 1, fontWeight: 'bold' }
});

export default OnboardingScreen;`;

fs.writeFileSync('d:/Veilpay/apps/consumer-app/src/screens/OnboardingScreen.tsx', code, 'utf8');
console.log('Successfully applied neopop to OnboardingScreen.tsx');