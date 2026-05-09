#!/usr/bin/env node
const { execFileSync } = require('child_process');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function safeGit(args) {
  try {
    return git(args);
  } catch {
    return '';
  }
}

function daysAgo(unixSeconds) {
  return Math.floor((Date.now() / 1000 - Number(unixSeconds)) / 86400);
}

const defaultBranchRef = safeGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  .replace(/^origin\//, '') || 'main';
const protectedNames = new Set(['HEAD', defaultBranchRef, 'main', 'dev', 'develop']);
const mergedOutput = safeGit(['branch', '-r', '--merged', `origin/${defaultBranchRef}`]);
const merged = new Set(
  mergedOutput
    .split(/\r?\n/)
    .map(line => line.replace(/^[\s*]+/, '').replace(/^origin\//, '').trim())
    .filter(Boolean),
);

const refs = git([
  'for-each-ref',
  'refs/remotes/origin',
  '--format=%(refname:short)|%(committerdate:unix)|%(authorname)|%(subject)',
])
  .split(/\r?\n/)
  .filter(Boolean)
  .map(line => {
    const [ref, unix, author, ...subjectParts] = line.split('|');
    const name = ref.replace(/^origin\//, '');
    const ageDays = daysAgo(unix);
    return {
      name,
      ageDays,
      author,
      subject: subjectParts.join('|'),
      merged: merged.has(name),
      protected: protectedNames.has(name),
    };
  })
  .filter(branch => branch.name !== 'HEAD')
  .sort((left, right) => right.ageDays - left.ageDays);

const stale = refs.filter(branch => !branch.protected && branch.ageDays >= 60);
const mergedStale = stale.filter(branch => branch.merged);

console.log(`Remote branch audit for origin/${defaultBranchRef}`);
console.log(`Total branches: ${refs.length}`);
console.log(`Stale branches (>=60 days): ${stale.length}`);
console.log(`Merged stale branches: ${mergedStale.length}`);
console.log('');
console.log('Dry-run candidates:');

for (const branch of mergedStale.slice(0, 80)) {
  console.log(`- ${branch.name} | ${branch.ageDays}d | ${branch.author} | ${branch.subject}`);
}

if (mergedStale.length === 0) {
  console.log('- none');
}

console.log('');
console.log('No branch was deleted. Review this list before running any remote cleanup.');
