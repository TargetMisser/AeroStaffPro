#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

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
const bumpVersionSource = fs.readFileSync(path.join(root, 'scripts', 'bump-version.cjs'), 'utf8');

assert(scripts['dev:doctor'] === 'node scripts/dev-doctor.cjs', 'package.json should expose dev:doctor');
assert(scripts['release:verify'] === 'node scripts/release-verify.cjs', 'package.json should expose release:verify');
assert(scripts['release:quick'] === 'node scripts/release-quick.cjs', 'package.json should expose release:quick');
assert(
  scripts['test:release-tooling'] === 'node scripts/test-release-tooling.cjs',
  'package.json should expose test:release-tooling',
);

runHelp('dev-doctor.cjs');
runHelp('release-verify.cjs');
runHelp('release-quick.cjs');

assert(releaseQuickSource.includes("['run', 'test']"), 'release:quick should run the full npm test suite');
assert(releaseQuickSource.includes("'README.md'"), 'release:quick should commit README stable-version updates');
assert(bumpVersionSource.includes('README.md'), 'version:bump should update README stable version');
assert(
  bumpVersionSource.includes('Latest stable release'),
  'version:bump should know the README stable-version marker',
);

console.log('Release tooling test passed.');
