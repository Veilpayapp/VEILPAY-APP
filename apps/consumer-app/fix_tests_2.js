const fs = require('fs');
const path = require('path');

const filePaths = [
  path.join(__dirname, 'src/utils/__tests__/balanceFetcher.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/gasEstimator.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/rpcPool.test.ts'),
  path.join(__dirname, 'src/utils/__tests__/secureSigner.test.ts'),
];

for (const p of filePaths) {
  if (!fs.existsSync(p)) continue;
  let content = fs.readFileSync(p, 'utf8');

  content = content.replace(/jest\.mock\('\.\.\/sentry',\s*\(\)\n\n/g, '');
  content = content.replace(/jest\.mock\('\.\.\/sentry',\s*\(\)\s*\n/g, '');

  fs.writeFileSync(p, content, 'utf8');
}
console.log('Fixed tests 2!');
