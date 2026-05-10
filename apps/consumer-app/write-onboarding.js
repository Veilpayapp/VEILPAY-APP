const fs = require('fs');

const code = `import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../styles/design-tokens';
import { SCREENS } from '../constants/screens';
import { Logo } from '../components/Logo';

const FEATURES = [
  { id: '1', icon: '🛡️', title: 'Stealth Addresses', description: 'Generated one-time addresses for every transaction to break on-chain links.' },
  { id: '2', icon: '✨', title: 'ZK Proofs', description: 'Mathematical privacy that hides transaction amounts while ensuring total integrity.' },
  { id: '3', icon: '🌐', title: 'Multi-Chain', description: 'Seamless support for EVM, SVM, and MVM ecosystems within a single vault.' },
];

export function OnboardingScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" /> 
      
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Logo variant="manual" size="small" style={{ opacity: 0 }} />
        </View>

        <View style={styles.heroSection}>
          <Text style={styles.headline}>Private Payments,{\\n}Fully Yours</Text>
          <Text style={styles.subheadline}>SECURE THE VOID. MASTER YOUR ASSETS.</Text>
        </View>

        <View style={styles.featuresStack}>
          {FEATURES.map((item) => (
            <View key={item.id} style={styles.featureCard}>
              <View style={styles.iconContainer}>
                <Text style={styles.featureIcon}>{item.icon}</Text>
              </View>
              <View style={styles.featureTextContainer}>
                <Text style={styles.featureTitle}>{item.title}</Text>
                <Text style={styles.featureDescription}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <View style={styles.pageDots}>
            <View style={[styles.dot, styles.dotActive]} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
          
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate(SCREENS.WALLET_CONNECT)}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>GET STARTED</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate(SCREENS.WALLET_CONNECT)}
            activeOpacity={0.6}
          >
            <Text style={styles.secondaryButtonText}>RESTORE EXISTING VAULT</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 32, paddingBottom: 48, paddingTop: 0 },
  header: { height: 96, justifyContent: 'center', alignItems: 'center' },
  heroSection: { paddingBottom: 64, alignItems: 'center' },
  headline: { fontFamily: typography.fontFamily.headlineBold, fontSize: 36, lineHeight: 45, color: '#FFFFFF', textAlign: 'center', letterSpacing: -0.9, marginBottom: 16 },
  subheadline: { fontFamily: typography.fontFamily.bodyMedium, fontSize: 14, color: '#D8C3AD', textAlign: 'center', letterSpacing: 0.35, opacity: 0.7 },
  featuresStack: { gap: 24 },
  featureCard: { backgroundColor: '#1C1B1B', padding: 24, flexDirection: 'row', alignItems: 'flex-start', gap: 20, borderRadius: 16 },
  iconContainer: { backgroundColor: '#2A2A2A', padding: 12, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  featureIcon: { fontSize: 20 },
  featureTextContainer: { flex: 1, gap: 4 },
  featureTitle: { fontFamily: typography.fontFamily.headlineBold, fontSize: 18, color: '#FFFFFF', lineHeight: 28 },
  featureDescription: { fontFamily: typography.fontFamily.body, fontSize: 14, color: '#D8C3AD', lineHeight: 22.75 },
  footer: { paddingTop: 48, alignItems: 'center', gap: 32 },
  pageDots: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  dot: { width: 16, height: 4, backgroundColor: '#353534', borderRadius: 2 },
  dotActive: { width: 32, backgroundColor: '#F59E0B' },
  primaryButton: { backgroundColor: '#F59E0B', width: '100%', paddingVertical: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  primaryButtonText: { fontFamily: typography.fontFamily.headlineBold, fontSize: 14, color: '#613B00', letterSpacing: 1.4 },
  secondaryButton: { opacity: 0.8 },
  secondaryButtonText: { fontFamily: typography.fontFamily.bodyBold, fontSize: 12, color: '#FFFFFF', letterSpacing: 1.2 }
});

export default OnboardingScreen;`;

fs.writeFileSync('d:/Veilpay/apps/consumer-app/src/screens/OnboardingScreen.tsx', code, 'utf8');
console.log('Successfully wrote OnboardingScreen.tsx');
