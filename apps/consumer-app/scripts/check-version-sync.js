/**
 * check-version-sync — release gate (INFRA / version hygiene).
 *
 * Fails if version.json (version + android.versionCode) drifts from the top
 * RELEASE_NOTES entry in src/constants/changelog.ts, the single source of
 * truth for user-facing release notes. This replaced an earlier gate that
 * compared against a CHANGELOG.md which never existed in the repo (audit
 * P1-6: the old gate failed on every run).
 */
const fs = require('fs');
const path = require('path');

const versionJsonPath = path.join(__dirname, '..', 'version.json');
const changelogPath = path.join(__dirname, '..', 'src', 'constants', 'changelog.ts');

function fail(message) {
  console.error(`[check-version-sync] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(versionJsonPath)) {
  fail('version.json not found');
}

let versionData;
try {
  versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
} catch (err) {
  fail(`version.json is not valid JSON: ${err.message}`);
}
const version = versionData.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`version.json has no valid semver "version" (got ${JSON.stringify(version)})`);
}
const versionCode = versionData.android && versionData.android.versionCode;
if (!Number.isInteger(versionCode)) {
  fail(`version.json has no integer android.versionCode (got ${JSON.stringify(versionCode)})`);
}

if (!fs.existsSync(changelogPath)) {
  fail(`changelog.ts not found at ${changelogPath}`);
}

const changelog = fs.readFileSync(changelogPath, 'utf8');
// First RELEASE_NOTES entry: "version: 'X.Y.Z'," followed by "build: N,".
const match = changelog.match(/version:\s*'(\d+\.\d+\.\d+)'\s*,\s*\n\s*build:\s*(\d+)/);
if (!match) {
  fail("changelog.ts has no entry shaped like { version: 'X.Y.Z', build: N }");
}

const [, changelogVersion, changelogBuildRaw] = match;
const changelogBuild = Number(changelogBuildRaw);

if (changelogVersion !== version) {
  fail(
    `version mismatch: version.json says ${version}, but the top changelog.ts entry is ${changelogVersion}`
  );
}
if (changelogBuild !== versionCode) {
  fail(
    `build mismatch: version.json android.versionCode is ${versionCode}, but the top changelog.ts entry is build ${changelogBuild}`
  );
}

console.log(
  `[check-version-sync] OK: version ${version} / build ${changelogBuild} matches changelog.ts top entry`
);
