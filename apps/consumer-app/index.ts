import './polyfills';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';

import App from './App';

// Hold the branded native splash (logo on #0A0A0B) up as EARLY as possible —
// before the JS bundle even finishes evaluating — so it stays visible across
// bundle load + font load + store hydration. App.tsx calls
// SplashScreen.hideAsync() only once React has painted its first frame, which
// hands off seamlessly to the animated BootSplash. Without this, the native
// splash auto-hides the instant the RN root view attaches, exposing the bare
// grey window background for a beat.
// Wrapped in try/catch (not just .catch) so that if this JS is ever delivered
// over OTA to a build whose native expo-splash-screen module is absent, the
// synchronous UnavailabilityError can't crash startup — the splash simply
// behaves as before.
try {
  SplashScreen.preventAutoHideAsync().catch(() => {
    // Pre-empting auto-hide can reject if the splash already hid — non-fatal.
  });
} catch {
  // Native splash module unavailable — non-fatal.
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
