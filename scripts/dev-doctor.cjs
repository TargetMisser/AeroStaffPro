#!/usr/bin/env node
const {
  capture,
  commandExists,
  findAndroidBuildTool,
  getCurrentBranch,
  getDirtyFiles,
  readProjectMeta,
} = require('./release-tools.cjs');

function printHelp() {
  console.log(`Usage: node scripts/dev-doctor.cjs

Checks the local AeroStaff Pro release environment without changing files.

Reports:
  - Git branch and dirty files
  - App version metadata
  - GitHub CLI auth state
  - Android build-tools availability
  - ADB device visibility`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function line(status, label, value) {
  console.log(`[${status}] ${label}${value ? `: ${value}` : ''}`);
}

function firstLine(value) {
  return String(value || '').trim().split(/\r?\n/)[0] || '';
}

console.log('AeroStaff Pro developer doctor');
console.log('');

try {
  const branch = getCurrentBranch();
  const dirtyFiles = getDirtyFiles();
  line(dirtyFiles.length ? 'warn' : 'ok', 'Git branch', branch);
  line(dirtyFiles.length ? 'warn' : 'ok', 'Dirty files', dirtyFiles.length ? `${dirtyFiles.length} file(s)` : 'none');
  dirtyFiles.slice(0, 12).forEach((file) => console.log(`  ${file}`));
  if (dirtyFiles.length > 12) console.log(`  ...and ${dirtyFiles.length - 12} more`);
} catch (error) {
  line('fail', 'Git status', error.message);
}

try {
  const meta = readProjectMeta();
  const consistent =
    meta.packageVersion === meta.expoVersion &&
    meta.packageVersion === meta.versionName &&
    Boolean(meta.versionCode);
  line(consistent ? 'ok' : 'warn', 'Version', `package=${meta.packageVersion}, app=${meta.expoVersion}, android=${meta.versionName}, code=${meta.versionCode}`);
  line('ok', 'Android package', meta.androidPackage);
} catch (error) {
  line('fail', 'Version metadata', error.message);
}

for (const command of ['node', 'npm', 'git', 'gh', 'adb']) {
  line(commandExists(command) ? 'ok' : 'warn', `${command} command`, commandExists(command) ? 'available' : 'not found in PATH');
}

if (commandExists('gh')) {
  const ghAuth = capture('gh', ['auth', 'status'], { allowFailure: true });
  line(ghAuth.status === 0 ? 'ok' : 'warn', 'GitHub auth', ghAuth.status === 0 ? 'authenticated' : 'not authenticated');
}

for (const tool of ['aapt', 'apksigner']) {
  const toolPath = findAndroidBuildTool(tool);
  line(toolPath ? 'ok' : 'warn', `Android ${tool}`, toolPath || 'not found');
}

if (commandExists('adb')) {
  const devices = capture('adb', ['devices'], { allowFailure: true });
  line(devices.status === 0 ? 'ok' : 'warn', 'ADB devices', firstLine(devices.stdout) || firstLine(devices.stderr));
  devices.stdout
    .split(/\r?\n/)
    .slice(1)
    .filter((device) => device.trim())
    .forEach((device) => console.log(`  ${device}`));
}
