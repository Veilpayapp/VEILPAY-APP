const fs = require('fs');

const code = `import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { typography } from '../styles/design-tokens';
import { SCREENS } from '../constants/screens';
import { Logo } from '../components/Logo';
import { NeoPopButton, NeoPopCard } from '../components/NeoPop';

const FEATURES = [
  { id: '1', icon: '🛡️', title: 'STEALTH ADDRESS', description: 'Generated one-time addresses for every transaction to break on-chain links.' },
  { id: '2', icon: '✨', title: 'ZK PROOFS', description: 'Mathematical privacy guarantees while ensuring total integrity limits.' },
  { id: '3', icon: '🌐', title: 'MULTI-CHAIN', description: 'Seamless support for EVM, SVM, and MVM ecosystems within a single vault.' },
];

export function OnboardingScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" /> 
      
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Logo variant="manual" size="small" />
        </View>

        <View style={styles.heroSection}>
          <Text style={styles.headline}>PRIVATE PAYMENTS,{\\n}FULLY YOURS.</Text>
          
          <View style={styles.badgeWrapper}>
            <View style={styles.badgeShadow} />
            <View style={styles.badgeSurface}>
              <Text style={styles.badgeText}>SECURE THE VOID.</Text>
            </View>
          </View>
        </View>

        <View style={styles.featuresStack}>
          {FEATURES.map((item) => (
            <NeoPopCard key={item.id} shadowColor="#F59E0B" color="#111111" depth={6} style={{ marginBottom: 16 }}>
               <View style={styles.featureRow}>
                 <View style={styles.iconBox}>
                   <View style={styles.iconBoxShadow} />
                   <View style={styles.iconBoxSurface}>
                     <Text style={styles.featureIcon}>{item.icon}</Text>
                   </View>
                 </View>
                 <View style={styles.featureTextContainer}>
                   <Text style={styles.featureTitle}>{item.title}</Text>
                   <Text style={styles.featureDescription}>{item.description}</Text>
                 </View>
               </View>
            </NeoPopCard>
          ))}
        </View>

        <View style={styles.footer}>
          <NeoPopButton 
            title="GET STARTED" 
            shadowColor="#F59E0B" 
            color="#FFFFFF" 
            textColor="#000000" 
            depth={6}
            onPress={() => navigation.navigate(SCREENS.WALLET_CONNECT)} 
          />

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
  container: { flex: 1, backgroundColor: '#050505' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 48, paddingTop: 12 },
  header: { height: 64, justifyContent: 'center', alignItems: 'center' },
  
  heroSection: { alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
  headline: { fontFamily: typography.fontFamily.headlineBold, fontSize: 32, lineHeight: 40, color: '#FFFFFF', textAlign: 'center', textTransform: 'uppercase', marginBottom: 24 },
  
  badgeWrapper: {
    position: 'relative',
    transform: [{ rotate: '-3deg' }],
  },
  badgeShadow: {
    position: 'absolute',
    top: 4, left: 4, right: 0, bottom: 0,
    backgroundColor: '#F59E0B',
    borderWidth: 2, borderColor: '#0A0A0A'
  },
  badgeSurface: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: '#0A0A0A'
  },
  badgeText: { fontFamily: typography.fontFamily.mono, fontSize: 13, color: '#000000', fontWeight: 'bold', letterSpacing: 1 },
  
  featuresStack: { gap: 8, marginTop: 16, marginBottom: 24 },
  
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  
  iconBox: { position: 'relative', width: 48, height: 48 },
  iconBoxShadow: { position: 'absolute', top: 3, left: 3, right: 0, bottom: 0, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#0A0A0A' },
  iconBoxSurface: { width: '100%', height: '100%', backgroundColor: '#050505', borderWidth: 2, borderColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center' },
  featureIcon: { fontSize: 20 },
  
  featureTextContainer: { flex: 1, gap: 6 },
  featureTitle: { fontFamily: typography.fontFamily.mono, fontSize: 16, color: '#F59E0B', fontWeight: 'bold' },
  featureDescription: { fontFamily: typography.fontFamily.bodyMedium, fontSize: 14, color: '#A3A3A3', lineHeight: 20 },
  
  footer: { paddingTop: 16, alignItems: 'center', gap: 32 },
  
  secondaryButton: { 
    borderBottomWidth: 2, 
    borderColor: '#A3A3A3',
    paddingBottom: 2,
    marginTop: 8
  },
  secondaryButtonText: { fontFamily: typography.fontFamily.mono, fontSize: 14, color: '#A3A3A3', letterSpacing: 1, fontWeight: 'bold' }
});

export default OnboardingScreen;`;

fs.writeFileSync('d:/Veilpay/apps/consumer-app/src/screens/OnboardingScreen.tsx', code, 'utf8');