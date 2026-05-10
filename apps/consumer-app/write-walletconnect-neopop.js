const fs = require('fs');

const code = `import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { typography } from '../styles/design-tokens';
import { SCREENS } from '../constants/screens';
import { Logo } from '../components/Logo';
import { useWalletStore, ChainType } from '../stores/walletStore';
import { NeoPopButton, NeoPopCard } from '../components/NeoPop';

interface WalletConnectScreenProps {
  navigation: any;
}

export function WalletConnectScreen({ navigation }: WalletConnectScreenProps) { 
  const [connecting, setConnecting] = useState<string | null>(null);
  const { connect } = useWalletStore();

  const handleBack = () => {
    navigation.goBack();
  };

  const handleInternalWallet = (type: 'create' | 'import') => {
    if (type === 'create') {
      navigation.navigate(SCREENS.CREATE_WALLET);
    } else {
      navigation.navigate(SCREENS.IMPORT_WALLET);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>       
          <Text style={styles.backButtonText}>← BACK</Text>
        </TouchableOpacity>
        <Logo variant="manual" size="small" />
        <View style={{ width: 80 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headline}>CHOOSE CONNECTION METHOD</Text>

        <View style={styles.section}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => handleInternalWallet('create')} style={{ marginBottom: 20 }}>
            <NeoPopCard color="#FFFFFF" shadowColor="#F59E0B" depth={6}>
              <View style={styles.methodRow}>
                 <View style={[styles.methodIconBox, { backgroundColor: '#F59E0B' }]}>
                   <Text style={styles.methodIcon}>🔐</Text>
                 </View>
                 <View style={styles.methodTextContainer}>
                   <Text style={[styles.methodTitle, { color: '#000000' }]}>CREATE NEW WALLET</Text>
                   <Text style={[styles.methodDescription, { color: '#555555' }]}>Generate a new seed phrase. Secure, private, and yours.</Text>
                 </View>
              </View>
            </NeoPopCard>
          </TouchableOpacity>
          
          <TouchableOpacity activeOpacity={0.9} onPress={() => handleInternalWallet('import')} style={{ marginBottom: 32 }}>
            <NeoPopCard color="#111111" shadowColor="#A3A3A3" depth={6}>
              <View style={styles.methodRow}>
                 <View style={[styles.methodIconBox, { backgroundColor: '#2A2A2A', borderColor: '#353534' }]}>
                   <Text style={styles.methodIcon}>📥</Text>
                 </View>
                 <View style={styles.methodTextContainer}>
                   <Text style={[styles.methodTitle, { color: '#FFFFFF' }]}>IMPORT EXISTING</Text>
                   <Text style={[styles.methodDescription, { color: '#A3A3A3' }]}>Restore via seed phrase or private key securely.</Text>
                 </View>
              </View>
            </NeoPopCard>
          </TouchableOpacity>
        </View>

        <View style={styles.dividerWrapper}>
          <View style={styles.dividerLine} />
          <View style={styles.dividerBadge}>
            <Text style={styles.dividerText}>EXTERNAL WALLETS</Text>
          </View>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.section}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => {}} style={{ marginBottom: 16 }}>
            <NeoPopCard color="#111111" shadowColor="#4ADE80" depth={4}>
              <View style={styles.methodRow}>
                 <View style={[styles.methodIconBox, { backgroundColor: '#1A1A1A', borderColor: '#0A0A0A' }]}>
                   <Text style={styles.methodIcon}>🦊</Text>
                 </View>
                 <View style={styles.methodTextContainer}>
                   <Text style={[styles.methodTitle, { color: '#4ADE80' }]}>METAMASK</Text>
                   <Text style={[styles.methodDescription, { color: '#A3A3A3' }]}>Connect your existing MetaMask wallet.</Text>
                 </View>
              </View>
            </NeoPopCard>
          </TouchableOpacity>
          
          <TouchableOpacity activeOpacity={0.9} onPress={() => {}} style={{ marginBottom: 16 }}>
            <NeoPopCard color="#111111" shadowColor="#3B82F6" depth={4}>
              <View style={styles.methodRow}>
                 <View style={[styles.methodIconBox, { backgroundColor: '#1A1A1A', borderColor: '#0A0A0A' }]}>
                   <Text style={styles.methodIcon}>🛡️</Text>
                 </View>
                 <View style={styles.methodTextContainer}>
                   <Text style={[styles.methodTitle, { color: '#3B82F6' }]}>TRUST WALLET</Text>
                   <Text style={[styles.methodDescription, { color: '#A3A3A3' }]}>Connect your Trust Wallet securely.</Text>
                 </View>
              </View>
            </NeoPopCard>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.9} onPress={() => {}} style={{ marginBottom: 16 }}>
            <NeoPopCard color="#111111" shadowColor="#FFFFFF" depth={4}>
              <View style={styles.methodRow}>
                 <View style={[styles.methodIconBox, { backgroundColor: '#1A1A1A', borderColor: '#0A0A0A' }]}>
                   <Text style={styles.methodIcon}>🔗</Text>
                 </View>
                 <View style={styles.methodTextContainer}>
                   <Text style={[styles.methodTitle, { color: '#FFFFFF' }]}>WALLETCONNECT</Text>
                   <Text style={[styles.methodDescription, { color: '#A3A3A3' }]}>Connect with any supported external wallet.</Text>
                 </View>
              </View>
            </NeoPopCard>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    height: 64,
    borderBottomWidth: 2,
    borderBottomColor: '#1A1A1A'
  },
  backButton: { width: 80, paddingVertical: 8 },
  backButtonText: { fontFamily: typography.fontFamily.mono, color: '#A3A3A3', fontSize: 13, fontWeight: 'bold' },
  
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  headline: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 28,
    color: '#FFFFFF',
    marginBottom: 32,
    textAlign: 'left',
  },
  section: {
    marginBottom: 16,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  methodIconBox: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0A0A0A'
  },
  methodIcon: { fontSize: 24 },
  methodTextContainer: { flex: 1, gap: 4 },
  methodTitle: { fontFamily: typography.fontFamily.mono, fontSize: 16, fontWeight: 'bold' },
  methodDescription: { fontFamily: typography.fontFamily.bodyMedium, fontSize: 13, lineHeight: 18 },
  
  dividerWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 32,
    gap: 12
  },
  dividerLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#1A1A1A'
  },
  dividerBadge: {
    backgroundColor: '#0A0A0A',
    borderWidth: 2,
    borderColor: '#1A1A1A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    transform: [{ rotate: '-2deg' }]
  },
  dividerText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: '#888888',
    fontWeight: 'bold',
    letterSpacing: 1
  }
});

export default WalletConnectScreen;`;

fs.writeFileSync('d:/Veilpay/apps/consumer-app/src/screens/WalletConnectScreen.tsx', code, 'utf8');