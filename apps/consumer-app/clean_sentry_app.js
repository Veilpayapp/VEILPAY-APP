const fs = require('fs');
const path = require('path');

const filePaths = [
  path.join(__dirname, 'App.tsx'),
  path.join(__dirname, 'src/hooks/useOnramp.ts'),
  path.join(__dirname, 'src/hooks/useSecureScreen.tsx'),
  path.join(__dirname, 'src/components/ErrorBoundary.tsx'),
  path.join(__dirname, 'src/utils/__tests__/balanceFetcher.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/envValidation.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/gasEstimator.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/multiChainSigner.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/rpc.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/rpcPool.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/secureSigner.test.ts'),
];

for (const p of filePaths) {
  if (!fs.existsSync(p)) continue;
  let content = fs.readFileSync(p, 'utf8');

  // Remove Sentry imports
  content = content.replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.?\/.*sentry['"];?/g, '');
  content = content.replace(/import\s*\*\s*as\s*Sentry\s*from\s*['"]@sentry\/react-native['"];?/g, '');
  content = content.replace(/jest\.mock\(['"]\.\.?\/?.*sentry['"][^)]*\);?/g, '');
  
  // App.tsx specifics
  if (p.endsWith('App.tsx')) {
    content = content.replace(/\n\/\/ Initialize Sentry safely at module scope\ntry \{\n  initSentry\(\);\n\} catch \(e\) \{\n  console\.warn\('\[sentry\] Initialization failed:', e\);\n\}\n/, '');
    
    content = content.replace(/captureError\(([^,]+)(?:,\s*\{[^}]*\}\s*)?\);?/g, 'console.error($1);');
    content = content.replace(/captureMessage\(([^,]+),\s*['"]error['"]\);?/g, 'console.error($1);');
    content = content.replace(/captureMessage\(([^,]+),\s*['"]warning['"]\);?/g, 'console.warn($1);');
    content = content.replace(/captureMessage\(([^,]+)\);?/g, 'console.log($1);');
    
    content = content.replace(/setUserContext\([^)]*\);?/g, '');
    content = content.replace(/addBreadcrumb\([^)]*\);?/g, '');
  }

  // useOnramp specifics
  if (p.endsWith('useOnramp.ts') || p.endsWith('useSecureScreen.tsx')) {
    content = content.replace(/captureError\(([^,]+)(?:,\s*\{[^}]*\}\s*)?\);?/g, 'console.error($1);');
  }
  // Tests specifics
  if (p.includes('__tests__')) {
    content = content.replace(/const\s*\{\s*captureError\s*\}\s*=\s*require\(['"]\.\.\/sentry['"]\);?/g, '');
    content = content.replace(/captureErrorMock\s*=\s*require\(['"]\.\.\/sentry['"]\)\.captureError;?/g, '');
    content = content.replace(/delete\s*process\.env\.EXPO_PUBLIC_SENTRY_DSN;?/g, '');
  }

  // Clean duplicate Icon import in ErrorBoundary
  if (p.endsWith('ErrorBoundary.tsx')) {
    content = content.replace(/import \{ Icon \} from '\.\/Icon';\s*\nimport \{ Icon \} from '\.\/Icon';/g, "import { Icon } from './Icon';");
  }

  fs.writeFileSync(p, content, 'utf8');
}

console.log('Cleanup complete!');
