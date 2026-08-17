#!/usr/bin/env node
const { fail, run } = require('./release-tools.cjs');

function printHelp() {
  console.log(`Usage: node scripts/qa-release.cjs [--with-android] [--strict-audit]

Runs the complete repeatable release preflight: metadata checks, regression
tests, TypeScript, production bundle inspection, dependency policy, and
optionally native Android lint/manifest checks.

  --with-android  Include Gradle lint and merged-manifest verification.
  --strict-audit  Fail on high as well as critical npm advisories.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const allowed = new Set(['--with-android', '--strict-audit']);
  const unknown = args.find(arg => !allowed.has(arg));
  if (unknown) fail(`Unknown option: ${unknown}`);

  run('npm', ['run', 'release:check']);
  run('npm', ['run', 'test']);
  run('npm', ['run', 'typecheck']);
  run('npm', ['run', 'qa:bundle']);
  const dependencyArgs = ['run', 'qa:dependencies'];
  if (args.includes('--strict-audit')) dependencyArgs.push('--', '--strict');
  run('npm', dependencyArgs);
  if (args.includes('--with-android')) run('npm', ['run', 'qa:android']);
  console.log('AeroStaff Pro release QA passed.');
}

if (require.main === module) main();

module.exports = { main };
