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
const wearBuildGradle = read('android/wear/build.gradle');
const readme = read('README.md');
const releaseWorkflow = read('.github/workflows/build-release.yml');
const windowsReleaseWorkflow = read('.github/workflows/build-release-windows.yml');
const releaseScript = read('scripts/release-apk.sh');

const updateChecker = read('src/utils/updateChecker.ts');

const packageVersion = packageJson.version;
const appVersion = appJson.expo?.version;
const versionNameMatch = buildGradle.match(/versionName\s+"([^"]+)"/);
const versionCodeMatch = buildGradle.match(/versionCode\s+(\d+)/);
const applicationIdMatch = buildGradle.match(/applicationId\s+'([^']+)'/);
const wearVersionNameMatch = wearBuildGradle.match(/versionName\s+"([^"]+)"/);
const wearVersionCodeMatch = wearBuildGradle.match(/versionCode\s+(\d+)/);
const wearApplicationIdMatch = wearBuildGradle.match(/applicationId\s+'([^']+)'/);
const readmeStableMatch = readme.match(/Latest stable release:\s+\*\*v(\d+\.\d+\.\d+)\*\*/);
const fallbackVersionMatch = updateChecker.match(/FALLBACK_APP_VERSION = '(\d+\.\d+\.\d+)'/);

assert(/^\d+\.\d+\.\d+$/.test(packageVersion), `Invalid package.json version: ${packageVersion}`);
assert(appVersion === packageVersion, `app.json version (${appVersion}) must match package.json (${packageVersion})`);
assert(versionNameMatch, 'android/app/build.gradle is missing versionName');
assert(versionNameMatch[1] === packageVersion, `Android versionName (${versionNameMatch[1]}) must match package.json (${packageVersion})`);
assert(versionCodeMatch, 'android/app/build.gradle is missing versionCode');
assert(Number(versionCodeMatch[1]) > 0, 'Android versionCode must be a positive integer');
assert(applicationIdMatch, 'android/app/build.gradle is missing applicationId');
assert(applicationIdMatch[1] === appJson.expo?.android?.package, `Android applicationId (${applicationIdMatch[1]}) must match app.json (${appJson.expo?.android?.package})`);
assert(wearVersionNameMatch, 'android/wear/build.gradle is missing versionName');
assert(wearVersionNameMatch[1] === packageVersion, `Wear versionName (${wearVersionNameMatch[1]}) must match package.json (${packageVersion})`);
assert(wearVersionCodeMatch, 'android/wear/build.gradle is missing versionCode');
assert(wearVersionCodeMatch[1] === versionCodeMatch[1], `Wear versionCode (${wearVersionCodeMatch[1]}) must match Android versionCode (${versionCodeMatch[1]})`);
assert(wearApplicationIdMatch, 'android/wear/build.gradle is missing applicationId');
assert(wearApplicationIdMatch[1] === applicationIdMatch[1], `Wear applicationId (${wearApplicationIdMatch[1]}) must match phone applicationId (${applicationIdMatch[1]}) for Data Layer`);
assert(wearBuildGradle.includes("storeFile rootProject.file('app/debug.keystore')"), 'Wear debug builds must use the phone debug keystore for Data Layer');
assert(readmeStableMatch, 'README.md is missing Latest stable release');
assert(readmeStableMatch[1] === packageVersion, `README latest stable release (${readmeStableMatch[1]}) must match package.json (${packageVersion})`);
assert(fallbackVersionMatch, 'src/utils/updateChecker.ts is missing the FALLBACK_APP_VERSION marker');
assert(fallbackVersionMatch[1] === packageVersion, `updateChecker FALLBACK_APP_VERSION (${fallbackVersionMatch[1]}) must match package.json (${packageVersion})`);

assert(releaseWorkflow.includes('Validate APK release metadata'), 'release workflow must validate APK metadata');
assert(releaseWorkflow.includes('Create GitHub Release'), 'release workflow must create a GitHub Release');
assert(releaseWorkflow.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24'), 'release workflow must keep Node action compatibility guard');
assert(releaseWorkflow.includes('git rev-parse HEAD'), 'release workflow must record the checked out source commit');
assert(releaseWorkflow.includes('target_commitish'), 'release workflow must publish releases against the built commit');
assert(releaseWorkflow.includes(':wear:assembleRelease'), 'release workflow must build the Wear release APK');
assert(releaseWorkflow.includes('AeroStaffPro-Wear-${{ steps.meta.outputs.tag }}.apk'), 'release workflow must expose a distinct Wear APK asset');
assert(windowsReleaseWorkflow.includes('runs-on: [self-hosted, Windows, X64, aerostaff]'), 'Windows release workflow must target the local AeroStaff runner');
assert(windowsReleaseWorkflow.includes('Validate APK release metadata'), 'Windows release workflow must validate APK metadata');
assert(windowsReleaseWorkflow.includes('Create GitHub Release'), 'Windows release workflow must create a GitHub Release');
assert(windowsReleaseWorkflow.includes('publish_release'), 'Windows release workflow must support dry-run smoke tests');
assert(windowsReleaseWorkflow.includes(':wear:assembleRelease'), 'Windows release workflow must build the Wear release APK');
assert(windowsReleaseWorkflow.includes('AeroStaffPro-Wear-${{ steps.meta.outputs.tag }}.apk'), 'Windows release workflow must expose a distinct Wear APK asset');
assert(releaseScript.includes('npm run release:check'), 'scripts/release-apk.sh must run release checks first');
assert(releaseScript.includes('npm run test:smoke'), 'scripts/release-apk.sh must run smoke checks before Gradle');
assert(releaseScript.includes('./gradlew clean :app:assembleRelease :wear:assembleRelease'), 'scripts/release-apk.sh must build phone and Wear release APKs');
assert(releaseScript.includes('android/wear/build/outputs/apk/release/wear-release.apk'), 'scripts/release-apk.sh must verify the Wear APK output');

console.log(`Release check passed for phone and Wear v${packageVersion} (versionCode ${versionCodeMatch[1]}).`);
