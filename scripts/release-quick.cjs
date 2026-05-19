#!/usr/bin/env node
const {
  assertCleanWorktree,
  capture,
  fail,
  getCurrentBranch,
  getHeadSha,
  normalizeTag,
  parseRepoArg,
  readProjectMeta,
  run,
  sleep,
} = require('./release-tools.cjs');

function printHelp() {
  console.log(`Usage: node scripts/release-quick.cjs [patch|minor|major|X.Y.Z] [options]

Runs the usual AeroStaff Pro release flow:
  1. Require a clean worktree
  2. Bump version
  3. Run release checks, full tests, and typecheck
  4. Commit and push the version bump
  5. Trigger the GitHub APK release workflow
  6. Wait for the workflow and verify the published APK

Options:
  --repo owner/name   GitHub repo. Default: TargetMisser/AeroStaffPro
  --install           Install the verified APK on the connected Android device/emulator
  --local-runner      Build on the configured Windows self-hosted runner

Examples:
  npm run release:quick
  npm run release:quick -- minor
  npm run release:quick -- 2.7.0 --install
  npm run release:quick -- --local-runner`);
}

function getBumpMode(args) {
  return args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--repo') || 'patch';
}

function findWorkflowRun(repo, workflowFile, startedAtIso) {
  const startedAt = Date.parse(startedAtIso) - 15000;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = capture(
      'gh',
      [
        'run',
        'list',
        '--repo',
        repo,
        '--workflow',
        workflowFile,
        '--json',
        'databaseId,createdAt,event,status,displayTitle',
        '--limit',
        '20',
      ],
      { allowFailure: true },
    );

    if (result.status === 0) {
      const runs = JSON.parse(result.stdout || '[]');
      const match = runs.find((runInfo) => {
        return runInfo.event === 'workflow_dispatch' && Date.parse(runInfo.createdAt) >= startedAt;
      });
      if (match) return match.databaseId;
    }

    console.log(`Waiting for GitHub workflow run... (${attempt}/30)`);
    sleep(5000);
  }

  return '';
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const repo = parseRepoArg(args);
const install = args.includes('--install');
const useLocalRunner = args.includes('--local-runner');
const workflowFile = useLocalRunner ? 'build-release-windows.yml' : 'build-release.yml';
const bumpMode = getBumpMode(args);

console.log('Starting AeroStaff Pro quick release');
console.log(`Release workflow: ${workflowFile}`);
assertCleanWorktree();

const branch = getCurrentBranch();
if (branch === 'HEAD') {
  fail('Cannot release from detached HEAD.');
}

run('node', ['scripts/bump-version.cjs', bumpMode]);
const meta = readProjectMeta();
const tag = normalizeTag(meta.packageVersion);

run('npm', ['run', 'release:check']);
run('npm', ['run', 'test']);
run('npm', ['run', 'typecheck']);

run('git', ['add', 'package.json', 'package-lock.json', 'app.json', 'android/app/build.gradle', 'README.md']);
run('git', ['commit', '-m', `chore: release ${meta.packageVersion}`]);
run('git', ['push', '-u', 'origin', branch]);

const sha = getHeadSha();
const startedAt = new Date().toISOString();
run('gh', [
  'workflow',
  'run',
  workflowFile,
  '--repo',
  repo,
  '--ref',
  branch,
  '-f',
  `ref=${sha}`,
  '-f',
  `version_override=${tag}`,
]);

const runId = findWorkflowRun(repo, workflowFile, startedAt);
if (!runId) {
  fail(`GitHub workflow was triggered, but the run id was not found. Check: https://github.com/${repo}/actions/workflows/${workflowFile}`);
}

run('gh', ['run', 'watch', String(runId), '--repo', repo, '--exit-status']);

const verifyArgs = ['scripts/release-verify.cjs', tag, '--repo', repo];
if (install) verifyArgs.push('--install');
run('node', verifyArgs);

console.log(`Release ${tag} completed from ${branch}.`);
