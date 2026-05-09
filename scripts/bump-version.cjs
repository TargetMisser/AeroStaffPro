#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requested = process.argv[2];
const requestedCode = process.argv[3] ? Number(process.argv[3]) : null;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), value);
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function writeJson(relativePath, value) {
  write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function bumpSemver(version, mode) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  assert(match, `Invalid semver version: ${version}`);
  const [, majorRaw, minorRaw, patchRaw] = match;
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (mode === 'major') return `${major + 1}.0.0`;
  if (mode === 'minor') return `${major}.${minor + 1}.0`;
  if (mode === 'patch') return `${major}.${minor}.${patch + 1}`;
  return mode;
}

if (!requested) {
  console.error('Usage: node scripts/bump-version.cjs <patch|minor|major|x.y.z> [versionCode]');
  process.exit(1);
}

const packageJson = readJson('package.json');
const nextVersion = bumpSemver(packageJson.version, requested);
assert(/^\d+\.\d+\.\d+$/.test(nextVersion), `Invalid requested version: ${nextVersion}`);

const buildGradlePath = 'android/app/build.gradle';
const buildGradle = read(buildGradlePath);
const versionCodeMatch = buildGradle.match(/versionCode\s+(\d+)/);
assert(versionCodeMatch, 'android/app/build.gradle is missing versionCode');
const nextVersionCode = requestedCode ?? Number(versionCodeMatch[1]) + 1;
assert(Number.isInteger(nextVersionCode) && nextVersionCode > 0, `Invalid versionCode: ${nextVersionCode}`);

packageJson.version = nextVersion;
writeJson('package.json', packageJson);

const packageLock = readJson('package-lock.json');
packageLock.version = nextVersion;
if (packageLock.packages?.['']) {
  packageLock.packages[''].version = nextVersion;
}
writeJson('package-lock.json', packageLock);

const appJson = readJson('app.json');
appJson.expo.version = nextVersion;
writeJson('app.json', appJson);

write(
  buildGradlePath,
  buildGradle
    .replace(/versionCode\s+\d+/, `versionCode ${nextVersionCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${nextVersion}"`),
);

console.log(`Bumped AeroStaff Pro to v${nextVersion} (versionCode ${nextVersionCode}).`);
