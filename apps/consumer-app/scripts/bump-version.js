const fs = require('fs');
const path = require('path');

const versionJsonPath = path.join(__dirname, '..', 'version.json');

try {
  // Read version.json
  const rawData = fs.readFileSync(versionJsonPath, 'utf8');
  const versionData = JSON.parse(rawData);

  // Bump version
  const currentVersion = versionData.version;
  if (!currentVersion) {
    throw new Error('Could not find "version" in version.json');
  }
  const versionParts = currentVersion.split('.');
  if (versionParts.length === 3) {
    const patch = parseInt(versionParts[2], 10);
    versionParts[2] = (patch + 1).toString();
    versionData.version = versionParts.join('.');
  } else {
    console.warn(`Version string "${currentVersion}" does not follow standard semver (x.y.z). Skipping patch bump.`);
  }

  // Bump iOS buildNumber
  if (versionData.ios && versionData.ios.buildNumber !== undefined) {
    const currentIosBuildStr = versionData.ios.buildNumber;
    const currentIosBuild = parseInt(currentIosBuildStr, 10);
    if (!isNaN(currentIosBuild)) {
      versionData.ios.buildNumber = (currentIosBuild + 1).toString();
    } else {
      console.warn(`iOS buildNumber "${currentIosBuildStr}" is not an integer. Skipping.`);
    }
  } else {
    console.warn('Could not find "ios.buildNumber" in version.json');
  }

  // Bump Android versionCode
  if (versionData.android && versionData.android.versionCode !== undefined) {
    const currentAndroidCode = versionData.android.versionCode;
    if (typeof currentAndroidCode === 'number') {
      versionData.android.versionCode = currentAndroidCode + 1;
    } else {
      console.warn(`Android versionCode "${currentAndroidCode}" is not a number. Skipping.`);
    }
  } else {
    console.warn('Could not find "android.versionCode" in version.json');
  }

  // Write back to version.json with 2 spaces indentation
  fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');

  console.log(`Successfully bumped version:`);
  console.log(`  Version: ${currentVersion} -> ${versionData.version}`);
  if (versionData.ios) {
    console.log(`  iOS buildNumber: ${versionData.ios.buildNumber}`);
  }
  if (versionData.android) {
    console.log(`  Android versionCode: ${versionData.android.versionCode}`);
  }

} catch (error) {
  console.error('Failed to bump version:', error.message);
  process.exit(1);
}
