const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const defaultRepo = process.env.AEROSTAFF_GITHUB_REPO || 'TargetMisser/AeroStaffPro';
const defaultReleaseCertSha256 =
  process.env.AEROSTAFF_RELEASE_CERT_SHA256 ||
  'bc7843ba089c2aebcd39f3179a55c2fda20e529787b819ccf2f59ab99630bfd8';

function fail(message) {
  throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function formatCommand(command, args = []) {
  return [command, ...args].join(' ');
}

function shouldUseCmd(command) {
  if (process.platform !== 'win32') return false;
  return !path.isAbsolute(command) || /\.(bat|cmd)$/i.test(command);
}

function quoteWindowsArg(value) {
  const raw = String(value);
  if (raw.length === 0) return '""';
  if (!/[\s"&|<>^]/.test(raw)) return raw;
  return `"${raw.replace(/(["^&|<>])/g, '^$1')}"`;
}

function run(command, args = [], options = {}) {
  const capture = options.capture === true;
  const useCmd = options.shell ?? shouldUseCmd(command);
  const spawnCommand = useCmd ? process.env.ComSpec || 'cmd.exe' : command;
  const spawnArgs = useCmd
    ? ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArg).join(' ')]
    : args;

  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    shell: false,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : options.stdio || 'inherit',
  });

  if (result.error) {
    if (options.allowFailure) return result;
    fail(`Command failed to start: ${formatCommand(command, args)}\n${result.error.message}`);
  }

  if (result.status !== 0 && !options.allowFailure) {
    const details = capture ? `\n${result.stdout || ''}${result.stderr || ''}`.trimEnd() : '';
    fail(`Command failed (${result.status}): ${formatCommand(command, args)}${details ? `\n${details}` : ''}`);
  }

  return result;
}

function capture(command, args = [], options = {}) {
  return run(command, args, { ...options, capture: true });
}

function commandExists(command) {
  const checker =
    process.platform === 'win32'
      ? ['where.exe', [command]]
      : ['sh', ['-lc', `command -v ${JSON.stringify(command)}`]];
  const result = run(checker[0], checker[1], { capture: true, allowFailure: true });
  return !result.error && result.status === 0;
}

function readProjectMeta() {
  const packageJson = readJson('package.json');
  const appJson = readJson('app.json');
  const buildGradle = read('android/app/build.gradle');
  const versionName = buildGradle.match(/versionName\s+"([^"]+)"/)?.[1] || '';
  const versionCode = buildGradle.match(/versionCode\s+(\d+)/)?.[1] || '';

  return {
    packageVersion: packageJson.version,
    expoVersion: appJson.expo?.version || '',
    androidPackage: appJson.expo?.android?.package || 'com.aerostaffpro.app',
    versionName,
    versionCode,
  };
}

function normalizeTag(value) {
  const raw = value || readProjectMeta().packageVersion;
  return raw.startsWith('v') ? raw : `v${raw}`;
}

function tagToVersion(tag) {
  return tag.replace(/^v/, '');
}

function getDownloadsDir() {
  return path.join(os.homedir(), 'Downloads');
}

function findAndroidSdkRoot() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk') : '',
    path.join(os.homedir(), 'Android', 'Sdk'),
    '/opt/android-sdk',
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'build-tools'))) || '';
}

function compareVersionDesc(a, b) {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
}

function findAndroidBuildTool(toolName) {
  const sdkRoot = findAndroidSdkRoot();
  if (!sdkRoot) return '';

  const buildToolsDir = path.join(sdkRoot, 'build-tools');
  const versions = fs
    .readdirSync(buildToolsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDesc);

  const names =
    process.platform === 'win32'
      ? [`${toolName}.exe`, `${toolName}.bat`, toolName]
      : [toolName];

  for (const version of versions) {
    for (const name of names) {
      const candidate = path.join(buildToolsDir, version, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return '';
}

function parseBadging(badging) {
  const packageMatch = badging.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);
  const labelMatch = badging.match(/application-label:'([^']+)'/);
  if (!packageMatch) {
    fail('Could not parse APK badging output.');
  }

  return {
    packageName: packageMatch[1],
    versionCode: packageMatch[2],
    versionName: packageMatch[3],
    label: labelMatch?.[1] || '',
  };
}

function parseCertSha256(apksignerOutput) {
  return apksignerOutput.match(/certificate SHA-256 digest:\s*([a-fA-F0-9]+)/)?.[1]?.toLowerCase() || '';
}

function downloadReleaseApk(tag, repo = defaultRepo) {
  const safeTag = tag.replace(/[^\w.-]/g, '-');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aerostaff-${safeTag}-`));

  run('gh', ['release', 'download', tag, '--repo', repo, '--pattern', '*.apk', '--dir', dir, '--clobber']);

  const apkFiles = fs.readdirSync(dir).filter((file) => file.toLowerCase().endsWith('.apk'));
  if (apkFiles.length !== 1) {
    fail(`Expected exactly one APK in ${dir}, found ${apkFiles.length}.`);
  }

  return path.join(dir, apkFiles[0]);
}

function getCurrentBranch() {
  return capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
}

function getHeadSha() {
  return capture('git', ['rev-parse', 'HEAD']).stdout.trim();
}

function getDirtyFiles() {
  return capture('git', ['status', '--porcelain']).stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function assertCleanWorktree() {
  const dirtyFiles = getDirtyFiles();
  if (dirtyFiles.length > 0) {
    fail(`Worktree is not clean:\n${dirtyFiles.join('\n')}`);
  }
}

function parseRepoArg(args) {
  const repoIndex = args.indexOf('--repo');
  if (repoIndex === -1) return defaultRepo;
  const repo = args[repoIndex + 1];
  if (!repo) fail('--repo requires an owner/name value.');
  return repo;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

module.exports = {
  assertCleanWorktree,
  capture,
  commandExists,
  defaultReleaseCertSha256,
  defaultRepo,
  downloadReleaseApk,
  fail,
  findAndroidBuildTool,
  getCurrentBranch,
  getDirtyFiles,
  getDownloadsDir,
  getHeadSha,
  normalizeTag,
  parseBadging,
  parseCertSha256,
  parseRepoArg,
  readProjectMeta,
  root,
  run,
  sleep,
  tagToVersion,
};
