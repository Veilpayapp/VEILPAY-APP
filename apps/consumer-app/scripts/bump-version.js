const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(__dirname, '..', 'app.json');

try {
  // Read app.json
  const rawData = fs.readFileSync(appJsonPath, 'utf8');
  const appData = JSON.parse(rawData);

  if (!appData.expo) {
    throw new Error('Could not find "expo" object in app.json');
  }

  // Bump version
  const currentVersion = appData.expo.version;
  if (!currentVersion) {
    throw new Error('Could not find "expo.version" in app.json');
  }
  const versionParts = currentVersion.split('.');
  if (versionParts.length === 3) {
    const patch = parseInt(versionParts[2], 10);
    versionParts[2] = (patch + 1).toString();
    appData.expo.version = versionParts.join('.');
  } else {
    console.warn(`Version string "${currentVersion}" does not follow standard semver (x.y.z). Skipping patch bump.`);
  }

  // Bump iOS buildNumber
  if (appData.expo.ios && appData.expo.ios.buildNumber !== undefined) {
    const currentIosBuildStr = appData.expo.ios.buildNumber;
    const currentIosBuild = parseInt(currentIosBuildStr, 10);
    if (!isNaN(currentIosBuild)) {
      appData.expo.ios.buildNumber = (currentIosBuild + 1).toString();
    } else {
      console.warn(`iOS buildNumber "${currentIosBuildStr}" is not an integer. Skipping.`);
    }
  } else {
    console.warn('Could not find "expo.ios.buildNumber" in app.json');
  }

  // Bump Android versionCode
  if (appData.expo.android && appData.expo.android.versionCode !== undefined) {
    const currentAndroidCode = appData.expo.android.versionCode;
    if (typeof currentAndroidCode === 'number') {
      appData.expo.android.versionCode = currentAndroidCode + 1;
    } else {
      console.warn(`Android versionCode "${currentAndroidCode}" is not a number. Skipping.`);
    }
  } else {
    console.warn('Could not find "expo.android.versionCode" in app.json');
  }

  // Write back to app.json with 2 spaces indentation
  fs.writeFileSync(appJsonPath, JSON.stringify(appData, null, 2) + '\n', 'utf8');

  console.log(`Successfully bumped version:`);
  console.log(`  Version: ${currentVersion} -> ${appData.expo.version}`);
  if (appData.expo.ios) {
    console.log(`  iOS buildNumber: ${appData.expo.ios.buildNumber}`);
  }
  if (appData.expo.android) {
    console.log(`  Android versionCode: ${appData.expo.android.versionCode}`);
  }

} catch (error) {
  console.error('Failed to bump version:', error.message);
  process.exit(1);
}
