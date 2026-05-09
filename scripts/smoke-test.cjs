#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = JSON.parse(read('package.json'));
const scripts = packageJson.scripts || {};

assert(scripts.typecheck, 'package.json should expose typecheck');
assert(scripts['test:flight-helpers'], 'package.json should expose test:flight-helpers');
assert(scripts['test:smoke'], 'package.json should expose test:smoke');
assert(scripts['release:check'], 'package.json should expose release:check');
assert(scripts['github:branches:audit'], 'package.json should expose github:branches:audit');

const flightScreen = read('src/screens/FlightScreen.tsx');
assert(flightScreen.includes("from '../utils/flightScheduleAdapter'"), 'FlightScreen should use the shared flight adapter');
assert(flightScreen.includes("from '../utils/flightScreenCache'"), 'FlightScreen should use the shared flight screen cache');

const notifications = read('src/utils/notificationDiagnostics.ts');
assert(notifications.includes('runNotificationScheduleExclusive'), 'notification scheduling should expose a serialization helper');
assert(notifications.includes('dedupeAeroStaffScheduledNotifications'), 'notification diagnostics should expose duplicate cleanup');
assert(notifications.includes('pendingRequests'), 'notification debug snapshots should include pending request details');

const autoNotifications = read('src/utils/autoNotifications.ts');
assert(autoNotifications.includes('runNotificationScheduleExclusive'), 'startup notifications should use the scheduler lock');

const releaseWorkflow = read('.github/workflows/ci.yml');
assert(releaseWorkflow.includes('npm test'), 'CI should run the smoke test suite');

const releaseScript = read('scripts/release-apk.sh');
assert(releaseScript.includes('npm run release:check'), 'local APK release should run release checks first');

for (const file of [
  'src/components/motion/BoardReveal.tsx',
  'src/components/motion/TactilePressable.tsx',
  'src/components/motion/ValueChangeFlash.tsx',
]) {
  const source = read(file);
  assert(source.includes('useReducedMotionPreference'), `${file} should respect reduced-motion settings`);
  assert(source.includes('useNativeDriver: true'), `${file} should keep animations on the native driver`);
}

console.log('Smoke test passed.');
