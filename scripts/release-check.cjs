#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = readJson('package.json');
const appJson = readJson('app.json');
const buildGradle = read('android/app/build.gradle');
const readme = read('README.md');
const releaseWorkflow = read('.github/workflows/build-release.yml');
const windowsReleaseWorkflow = read('.github/workflows/build-release-windows.yml');
const releaseScript = read('scripts/release-apk.sh');

const packageVersion = packageJson.version;
const appVersion = appJson.expo?.version;
const versionNameMatch = buildGradle.match(/versionName\s+"([^"]+)"/);
const versionCodeMatch = buildGradle.match(/versionCode\s+(\d+)/);
const readmeStableMatch = readme.match(/Latest stable release:\s+\*\*v(\d+\.\d+\.\d+)\*\*/);

assert(/^\d+\.\d+\.\d+$/.test(packageVersion), `Invalid package.json version: ${packageVersion}`);
assert(appVersion === packageVersion, `app.json version (${appVersion}) must match package.json (${packageVersion})`);
assert(versionNameMatch, 'android/app/build.gradle is missing versionName');
assert(versionNameMatch[1] === packageVersion, `Android versionName (${versionNameMatch[1]}) must match package.json (${packageVersion})`);
assert(versionCodeMatch, 'android/app/build.gradle is missing versionCode');
assert(Number(versionCodeMatch[1]) > 0, 'Android versionCode must be a positive integer');
assert(readmeStableMatch, 'README.md is missing Latest stable release');
assert(readmeStableMatch[1] === packageVersion, `README latest stable release (${readmeStableMatch[1]}) must match package.json (${packageVersion})`);

assert(releaseWorkflow.includes('Validate APK release metadata'), 'release workflow must validate APK metadata');
assert(releaseWorkflow.includes('Create GitHub Release'), 'release workflow must create a GitHub Release');
assert(releaseWorkflow.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24'), 'release workflow must keep Node action compatibility guard');
assert(releaseWorkflow.includes('git rev-parse HEAD'), 'release workflow must record the checked out source commit');
assert(releaseWorkflow.includes('target_commitish'), 'release workflow must publish releases against the built commit');
assert(windowsReleaseWorkflow.includes('runs-on: [self-hosted, Windows, X64, aerostaff]'), 'Windows release workflow must target the local AeroStaff runner');
assert(windowsReleaseWorkflow.includes('Validate APK release metadata'), 'Windows release workflow must validate APK metadata');
assert(windowsReleaseWorkflow.includes('Create GitHub Release'), 'Windows release workflow must create a GitHub Release');
assert(releaseScript.includes('npm run release:check'), 'scripts/release-apk.sh must run release checks first');
assert(releaseScript.includes('npm run test:smoke'), 'scripts/release-apk.sh must run smoke checks before Gradle');
assert(releaseScript.includes('./gradlew clean assembleRelease'), 'scripts/release-apk.sh must build the release APK');

console.log(`Release check passed for v${packageVersion} (versionCode ${versionCodeMatch[1]}).`);
