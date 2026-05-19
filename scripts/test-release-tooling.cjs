#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const releaseTools = require('./release-tools.cjs');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function runHelp(scriptName) {
  const scriptPath = path.join(root, 'scripts', scriptName);
  assert(fs.existsSync(scriptPath), `${scriptName} should exist`);

  const result = spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert(result.status === 0, `${scriptName} --help should exit 0`);
  assert(result.stdout.includes('Usage:'), `${scriptName} --help should print Usage`);
}

const packageJson = readJson('package.json');
const scripts = packageJson.scripts || {};
const releaseQuickSource = fs.readFileSync(path.join(root, 'scripts', 'release-quick.cjs'), 'utf8');
const windowsReleaseWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-release-windows.yml'), 'utf8');
const bumpVersionSource = fs.readFileSync(path.join(root, 'scripts', 'bump-version.cjs'), 'utf8');
const emulatorQaSource = fs.readFileSync(path.join(root, 'scripts', 'emulator-qa.cjs'), 'utf8');

assert(scripts['dev:doctor'] === 'node scripts/dev-doctor.cjs', 'package.json should expose dev:doctor');
assert(scripts['release:verify'] === 'node scripts/release-verify.cjs', 'package.json should expose release:verify');
assert(scripts['release:quick'] === 'node scripts/release-quick.cjs', 'package.json should expose release:quick');
assert(scripts['runner:setup'] === 'powershell -ExecutionPolicy Bypass -File scripts/setup-local-runner.ps1', 'package.json should expose runner:setup');
assert(
  scripts['test:release-tooling'] === 'node scripts/test-release-tooling.cjs',
  'package.json should expose test:release-tooling',
);

runHelp('dev-doctor.cjs');
runHelp('release-verify.cjs');
runHelp('release-quick.cjs');

assert(emulatorQaSource.includes('dismissBlockingOverlays'), 'emulator QA should dismiss blocking update/system overlays');
assert(emulatorQaSource.includes('Viewing full screen'), 'emulator QA should handle Android immersive-mode education overlay');
assert(emulatorQaSource.includes('Aggiornamento disponibile'), 'emulator QA should handle in-app update modal before navigation');

assert(releaseQuickSource.includes("['run', 'test']"), 'release:quick should run the full npm test suite');
assert(releaseQuickSource.includes("'README.md'"), 'release:quick should commit README stable-version updates');
assert(releaseQuickSource.includes("'--ref'"), 'release:quick should dispatch the GitHub workflow from the current branch');
assert(releaseQuickSource.includes('--local-runner'), 'release:quick should expose the local runner option');
assert(releaseQuickSource.includes('build-release-windows.yml'), 'release:quick should support the Windows local runner workflow');
assert(windowsReleaseWorkflow.includes('runs-on: [self-hosted, Windows, X64, aerostaff]'), 'Windows workflow should target the AeroStaff self-hosted runner');
assert(windowsReleaseWorkflow.includes('Resolve Android SDK'), 'Windows workflow should use the local Android SDK');
assert(bumpVersionSource.includes('README.md'), 'version:bump should update README stable version');
assert(
  bumpVersionSource.includes('Latest stable release'),
  'version:bump should know the README stable-version marker',
);

const tempGitRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'aerostaff-release-tooling-git-'));
releaseTools.run('git', ['init'], { cwd: tempGitRepo, capture: true });
releaseTools.run('git', [
  '-c',
  'user.email=aerostaff@example.invalid',
  '-c',
  'user.name=AeroStaff Tooling',
  'commit',
  '--allow-empty',
  '-m',
  'chore: release command quoting test',
], { cwd: tempGitRepo, capture: true });
const gitSubject = releaseTools.capture('git', ['log', '-1', '--format=%s'], { cwd: tempGitRepo }).stdout.trim();
assert(gitSubject === 'chore: release command quoting test', 'release tooling should preserve git commit messages with spaces');

const npmVersion = releaseTools.capture('npm', ['--version']).stdout.trim();
assert(/^\d+\.\d+\.\d+/.test(npmVersion), 'release tooling should run npm commands through Windows .cmd shims');

console.log('Release tooling test passed.');
