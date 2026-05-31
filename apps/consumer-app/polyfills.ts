import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Polyfill global Buffer for crypto and Solana libraries
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
