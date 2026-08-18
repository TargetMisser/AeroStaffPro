#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { fail, root, run } = require('./release-tools.cjs');

const FORBIDDEN_MANIFEST_MARKERS = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'com.canhub.cropper.CropImageActivity',
  'android:allowBackup="true"',
  'android:usesCleartextTraffic="true"',
];

function printHelp() {
  console.log(`Usage: node scripts/android-qa.cjs

Runs Android lint, resolves the release manifest, and rejects permissions,
exported transitive components, backup, or cleartext settings removed by the
security hardening.`);
}

function inspectMergedManifest(source) {
  const violations = FORBIDDEN_MANIFEST_MARKERS.filter(marker => source.includes(marker));
  if (!/android:allowBackup="false"/.test(source)) violations.push('missing android:allowBackup="false"');
  if (!/android:usesCleartextTraffic="false"/.test(source)) violations.push('missing android:usesCleartextTraffic="false"');
  const widgetImageProvider = source.match(/<provider\b[^>]*android:name="com\.reactnativeandroidwidget\.RNWidgetImageProvider"[^>]*>/)?.[0];
  if (!widgetImageProvider) {
    violations.push('missing RNWidgetImageProvider');
  } else {
    if (!widgetImageProvider.includes('android:authorities="com.aerostaffpro.app.rnwidget.imageprovider"')) {
      violations.push('invalid RNWidgetImageProvider authority');
    }
    if (!widgetImageProvider.includes('android:exported="true"')) {
      violations.push('RNWidgetImageProvider must be exported for launcher access');
    }
  }
  return violations;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  if (args.length > 0) fail(`Unknown option: ${args[0]}`);

  const androidDir = path.join(root, 'android');
  const gradle = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const gradleArgs = [':app:lintDebug', ':app:processReleaseMainManifest', '--console=plain'];
  if (process.platform === 'win32') gradleArgs.push('-Pandroid.overridePathCheck=true');
  // Gradle evaluates release signing even for the non-packaging manifest task.
  // Supply the tracked debug keystore only to unblock this diagnostic task;
  // publishable APKs are still built with the GitHub release-signing secrets.
  run(gradle, gradleArgs, {
    cwd: androidDir,
    env: {
      RELEASE_STORE_FILE: 'debug.keystore',
      RELEASE_STORE_PASSWORD: 'android',
      RELEASE_KEY_ALIAS: 'androiddebugkey',
      RELEASE_KEY_PASSWORD: 'android',
    },
  });

  const manifestPath = path.join(
    androidDir,
    'app',
    'build',
    'intermediates',
    'merged_manifest',
    'release',
    'processReleaseMainManifest',
    'AndroidManifest.xml',
  );
  if (!fs.existsSync(manifestPath)) fail(`Merged release manifest is missing: ${manifestPath}`);
  const violations = inspectMergedManifest(fs.readFileSync(manifestPath, 'utf8'));
  if (violations.length > 0) fail(`Merged release manifest violates security policy: ${violations.join(', ')}`);
  console.log('Android lint and merged release manifest policy passed.');
}

if (require.main === module) main();

module.exports = { FORBIDDEN_MANIFEST_MARKERS, inspectMergedManifest };
