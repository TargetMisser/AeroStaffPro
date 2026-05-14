#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  capture,
  defaultReleaseCertSha256,
  downloadReleaseApk,
  fail,
  findAndroidBuildTool,
  getDownloadsDir,
  normalizeTag,
  parseBadging,
  parseCertSha256,
  parseRepoArg,
  readProjectMeta,
  run,
  tagToVersion,
} = require('./release-tools.cjs');

function printHelp() {
  console.log(`Usage: node scripts/release-verify.cjs [vX.Y.Z] [options]

Downloads and verifies a GitHub release APK.

Options:
  --repo owner/name             GitHub repo. Default: TargetMisser/AeroStaffPro
  --install                     Install the verified APK on the connected Android device/emulator
  --no-copy                     Do not copy the APK to the local Downloads folder
  --expected-cert-sha256 hash   Override the expected release signing certificate fingerprint

Examples:
  npm run release:verify -- v2.6.63
  npm run release:verify -- v2.6.63 --install`);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value.`);
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} mismatch. Expected ${expected}, got ${actual}.`);
  }
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const tagArg = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--repo' && args[args.indexOf(arg) - 1] !== '--expected-cert-sha256');
const tag = normalizeTag(tagArg);
const repo = parseRepoArg(args);
const install = args.includes('--install');
const shouldCopy = !args.includes('--no-copy');
const expectedCert = (readOption(args, '--expected-cert-sha256') || defaultReleaseCertSha256).toLowerCase();
const expectedVersion = tagToVersion(tag);
const meta = readProjectMeta();
const aapt = findAndroidBuildTool('aapt');
const apksigner = findAndroidBuildTool('apksigner');

if (!aapt) fail('Android build-tools aapt not found. Install Android SDK build-tools first.');
if (!apksigner) fail('Android build-tools apksigner not found. Install Android SDK build-tools first.');

console.log(`Verifying ${repo} ${tag}`);

const apkPath = downloadReleaseApk(tag, repo);
console.log(`Downloaded APK: ${apkPath}`);

const badging = capture(aapt, ['dump', 'badging', apkPath]).stdout;
const apkInfo = parseBadging(badging);
assertEqual(apkInfo.packageName, meta.androidPackage, 'Package name');
assertEqual(apkInfo.versionName, expectedVersion, 'Version name');

console.log(`APK metadata: ${apkInfo.packageName} v${apkInfo.versionName} (${apkInfo.versionCode}) ${apkInfo.label || ''}`.trim());

const certOutput = capture(apksigner, ['verify', '--print-certs', apkPath]).stdout;
const certSha256 = parseCertSha256(certOutput);
if (!certSha256) fail('Could not read APK signing certificate SHA-256 digest.');
assertEqual(certSha256, expectedCert, 'Signing certificate SHA-256');
console.log(`Signing certificate SHA-256: ${certSha256}`);

if (shouldCopy) {
  const destination = path.join(getDownloadsDir(), `AeroStaffPro-${tag}.apk`);
  fs.copyFileSync(apkPath, destination);
  console.log(`Copied APK to: ${destination}`);
}

if (install) {
  run('adb', ['install', '-r', apkPath]);
  const packageInfo = capture('adb', ['shell', 'dumpsys', 'package', meta.androidPackage], { allowFailure: true }).stdout;
  const installedLines = packageInfo
    .split(/\r?\n/)
    .filter((line) => /versionCode|versionName/.test(line))
    .slice(0, 4)
    .map((line) => line.trim());
  if (installedLines.length) {
    console.log('Installed package:');
    installedLines.forEach((line) => console.log(`  ${line}`));
  }
}

console.log(`Release ${tag} verification completed.`);
