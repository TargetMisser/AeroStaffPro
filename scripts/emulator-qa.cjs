#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PACKAGE_NAME = 'com.aerostaffpro.app';
const DEFAULT_AVD = process.env.AEROSTAFF_AVD || 'Medium_Phone_API_36.1';
const DEFAULT_OUT_DIR = path.join('tmp', 'emulator-qa');

function parseArgs(argv) {
  const args = {
    avd: DEFAULT_AVD,
    outDir: DEFAULT_OUT_DIR,
    installRelease: null,
    installApk: null,
    noStart: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--avd') args.avd = argv[++i];
    else if (arg === '--out') args.outDir = argv[++i];
    else if (arg === '--install-release') args.installRelease = argv[++i];
    else if (arg === '--install-apk') args.installApk = argv[++i];
    else if (arg === '--no-start') args.noStart = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`
AeroStaff Pro emulator QA

Usage:
  npm run qa:emulator
  npm run qa:emulator -- --install-release v2.6.66
  npm run qa:emulator -- --install-apk C:\\path\\AeroStaffPro.apk

Options:
  --avd NAME             AVD to start when no device is connected. Default: ${DEFAULT_AVD}
  --install-release TAG  Verify, copy and install a GitHub release APK before QA.
  --install-apk PATH     Install a local APK before QA.
  --out DIR              Output directory for screenshots, UI dumps and logs.
  --no-start             Do not start an emulator automatically.
`);
}

function run(command, args = [], options = {}) {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: needsShell,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr ? `\n${result.stderr}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}${stderr}`);
  }
  return result.stdout || '';
}

function adb(args, options = {}) {
  return run('adb', args, { capture: true, ...options });
}

function connectedDevices() {
  const output = adb(['devices'], { allowFailure: true });
  return output
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);
}

function emulatorPath() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const candidates = [
    fromEnv ? path.join(fromEnv, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator') : null,
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'emulator', 'emulator.exe')
      : null,
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || 'emulator';
}

function startEmulator(avd) {
  const child = spawn(emulatorPath(), [
    '-avd',
    avd,
    '-no-snapshot-load',
    '-no-window',
    '-gpu',
    'swiftshader_indirect',
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureDevice({ avd, noStart }) {
  if (connectedDevices().length > 0) return;
  if (noStart) throw new Error('No connected ADB device and --no-start was passed');

  console.log(`No ADB device found. Starting emulator: ${avd}`);
  startEmulator(avd);
  run('adb', ['wait-for-device']);

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    const boot = adb(['shell', 'getprop', 'sys.boot_completed'], { allowFailure: true }).trim();
    if (boot === '1') return;
    await sleep(3000);
  }

  throw new Error('Emulator did not finish booting within 4 minutes');
}

function installRelease(tag) {
  console.log(`Installing GitHub release ${tag}`);
  run(process.execPath, [path.join('scripts', 'release-verify.cjs'), tag, '--install']);
}

function installApk(apkPath) {
  console.log(`Installing APK ${apkPath}`);
  run('adb', ['install', '-r', apkPath]);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function dumpUi(outDir, name) {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/window.xml'], { allowFailure: true });
  const xml = adb(['exec-out', 'cat', '/sdcard/window.xml'], { allowFailure: true });
  const filePath = path.join(outDir, `${name}.xml`);
  writeFile(filePath, xml);
  return xml;
}

function screenshot(outDir, name) {
  const result = spawnSync('adb', ['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
  if (result.status !== 0) throw new Error(`adb screencap failed with exit ${result.status}`);
  const filePath = path.join(outDir, `${name}.png`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, result.stdout);
  return filePath;
}

function parseBounds(value) {
  const match = String(value).match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const [, left, top, right, bottom] = match.map(Number);
  return {
    x: Math.round((left + right) / 2),
    y: Math.round((top + bottom) / 2),
  };
}

function findNodeCenter(xml, predicate) {
  const nodeRegex = /<node\b[^>]*>/g;
  let match;
  while ((match = nodeRegex.exec(xml))) {
    const node = match[0];
    if (!predicate(node)) continue;
    const bounds = node.match(/bounds="([^"]+)"/)?.[1];
    const center = parseBounds(bounds);
    if (center) return center;
  }
  return null;
}

function tap(center) {
  if (!center) return false;
  adb(['shell', 'input', 'tap', String(center.x), String(center.y)]);
  return true;
}

async function grantCalendarIfPrompt(outDir) {
  const xml = dumpUi(outDir, 'permission-check');
  if (!/access your calendar/i.test(xml)) return false;
  const allow = findNodeCenter(xml, node =>
    /permission_allow_button/.test(node) || /text="Allow"/.test(node) || /text="Consenti"/.test(node)
  );
  tap(allow);
  await sleep(5000);
  return true;
}

function extractText(xml) {
  return [...xml.matchAll(/text="([^"]+)"/g)]
    .map(match => match[1])
    .filter(Boolean);
}

function findInvertedTimeRanges(textValues) {
  const issues = [];
  for (const value of textValues) {
    const normalized = value.replace(/–|-/g, '-');
    const match = normalized.match(/\b(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\b/);
    if (!match) continue;
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    if (start > end) {
      issues.push(value);
    }
  }
  return issues;
}

function filteredLogcat(outDir) {
  const output = adb(['logcat', '-d', '-t', '1800', '-v', 'time'], { allowFailure: true });
  const filtered = output
    .split(/\r?\n/)
    .filter(line => /AndroidRuntime|FATAL|ReactNative|AeroStaff|TypeError|ReferenceError|NO_FLIGHT|flightProviders|Exception/.test(line))
    .join(os.EOL);
  const filePath = path.join(outDir, 'logcat-filtered.txt');
  writeFile(filePath, filtered);
  return { filePath, filtered };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  await ensureDevice(args);

  if (args.installRelease) installRelease(args.installRelease);
  if (args.installApk) installApk(args.installApk);

  adb(['logcat', '-c'], { allowFailure: true });
  adb(['shell', 'monkey', '-p', PACKAGE_NAME, '-c', 'android.intent.category.LAUNCHER', '1'], { allowFailure: true });
  await sleep(8000);
  const grantedCalendar = await grantCalendarIfPrompt(args.outDir);
  if (grantedCalendar) console.log('Granted calendar permission prompt');

  screenshot(args.outDir, 'home');
  const homeXml = dumpUi(args.outDir, 'home');
  const flightsTab = findNodeCenter(homeXml, node => /content-desc="[^"]*Voli/.test(node) || /text="Voli"/.test(node));
  if (!tap(flightsTab)) {
    throw new Error('Could not find Voli tab in UI dump');
  }

  await sleep(25000);
  screenshot(args.outDir, 'flights');
  const flightsXml = dumpUi(args.outDir, 'flights');
  const textValues = extractText(flightsXml);
  const invertedRanges = findInvertedTimeRanges(textValues);
  const log = filteredLogcat(args.outDir);

  console.log(`QA output: ${path.resolve(args.outDir)}`);
  console.log(`Visible text nodes: ${textValues.length}`);
  console.log(`Filtered log lines: ${log.filtered ? log.filtered.split(/\r?\n/).filter(Boolean).length : 0}`);
  if (invertedRanges.length > 0) {
    console.error(`Inverted time ranges detected: ${invertedRanges.join(', ')}`);
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
