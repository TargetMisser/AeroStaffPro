#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectMergedManifest } = require('./android-qa.cjs');
const { evaluateAudit } = require('./dependency-policy.cjs');
const { inspectExport } = require('./verify-production-bundle.cjs');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aerostaff-qa-tooling-test-'));
try {
  const bundleRelative = '_expo/static/js/android/index-test.hbc';
  const bundlePath = path.join(temp, ...bundleRelative.split('/'));
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, Buffer.from('clean production bundle'));
  const assets = [
    { path: 'assets/font-one', ext: 'ttf' },
    { path: 'assets/font-two', ext: 'ttf' },
    { path: 'assets/pdf-lib', ext: 'pdfjs' },
    { path: 'assets/pdf-worker', ext: 'pdfjs' },
  ];
  fs.writeFileSync(path.join(temp, 'metadata.json'), JSON.stringify({
    fileMetadata: { android: { bundle: bundleRelative, assets } },
  }));
  const cleanExport = inspectExport(temp);
  assert(cleanExport.fontCount === 2 && cleanExport.pdfRuntimeCount === 2, 'bundle verifier should accept the production asset policy');

  fs.writeFileSync(bundlePath, Buffer.from('bundle with @storybook'));
  let rejectedStorybook = false;
  try {
    inspectExport(temp);
  } catch (error) {
    rejectedStorybook = /@storybook/.test(error.message);
  }
  assert(rejectedStorybook, 'bundle verifier should reject Storybook in production');

  const cleanAudit = evaluateAudit({ metadata: { vulnerabilities: { high: 12, critical: 0, total: 12 } } });
  assert(cleanAudit.ok, 'default dependency policy should report existing high advisories without blocking release');
  const criticalAudit = evaluateAudit({ metadata: { vulnerabilities: { high: 0, critical: 1, total: 1 } } });
  assert(!criticalAudit.ok, 'dependency policy should reject critical advisories');
  const strictAudit = evaluateAudit({ metadata: { vulnerabilities: { high: 1, critical: 0, total: 1 } } }, { strict: true });
  assert(!strictAudit.ok, 'strict dependency policy should reject high advisories');

  const safeManifest = '<application android:allowBackup="false" android:usesCleartextTraffic="false"><provider android:name="com.reactnativeandroidwidget.RNWidgetImageProvider" android:authorities="com.aerostaffpro.app.rnwidget.imageprovider" android:exported="true" /></application>';
  assert(inspectMergedManifest(safeManifest).length === 0, 'Android manifest policy should accept hardened settings');
  const missingWidgetProvider = '<application android:allowBackup="false" android:usesCleartextTraffic="false" />';
  assert(inspectMergedManifest(missingWidgetProvider).includes('missing RNWidgetImageProvider'), 'Android manifest policy should reject a release without the widget image provider');
  const unsafeManifest = '<uses-permission android:name="android.permission.CAMERA"/><application android:allowBackup="true" android:usesCleartextTraffic="true" />';
  assert(inspectMergedManifest(unsafeManifest).length >= 3, 'Android manifest policy should reject restored dangerous settings');

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const script of ['qa:bundle', 'qa:dependencies', 'qa:android', 'qa:release', 'qa:full']) {
    assert(packageJson.scripts?.[script], `package.json should expose ${script}`);
  }
  const releaseQuick = fs.readFileSync(path.join(root, 'scripts', 'release-quick.cjs'), 'utf8');
  assert(releaseQuick.includes("['run', 'qa:release']"), 'release:quick should run the automated release QA preflight');
  const androidQa = fs.readFileSync(path.join(root, 'scripts', 'android-qa.cjs'), 'utf8');
  assert(androidQa.includes("RELEASE_STORE_FILE: 'debug.keystore'"), 'Android QA should use only the diagnostic debug keystore for manifest resolution');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('QA tooling tests passed.');
