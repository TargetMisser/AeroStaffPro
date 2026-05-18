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
assert(flightScreen.includes("from '../utils/flightNotificationScheduler'"), 'FlightScreen should use the shared flight notification scheduler');

const flightNotificationScheduler = read('src/utils/flightNotificationScheduler.ts');
for (const symbol of [
  'runNotificationScheduleExclusive',
  'scheduleShiftNotifications',
  'schedulePinnedNotifications',
  'cancelPreviousNotifications',
  'cancelPinnedNotifications',
]) {
  assert(flightNotificationScheduler.includes(symbol), `flight notification scheduler should expose ${symbol}`);
}

assert(flightScreen.includes("from '../components/flights/FlightFilterModal'"), 'FlightScreen should use the shared flight filter modal');
const flightFilterModal = read('src/components/flights/FlightFilterModal.tsx');
assert(flightFilterModal.includes('AirlineFilterLogo'), 'Flight filter modal should render branded airline logos');
assert(flightFilterModal.includes('getAirlineBrandColor'), 'Flight filter modal should apply airline brand colors');

assert(flightScreen.includes("from '../components/flights/FlightNotificationSettingsModal'"), 'FlightScreen should use the shared flight notification settings modal');
const flightNotificationSettingsModal = read('src/components/flights/FlightNotificationSettingsModal.tsx');
assert(flightNotificationSettingsModal.includes('MIN_NOTIF_MINUTES'), 'Flight notification settings modal should own minute bounds');
assert(flightNotificationSettingsModal.includes('onlyTrackedAirlines'), 'Flight notification settings modal should render tracked-airline settings');

assert(flightScreen.includes("from '../components/flights/FlightSourceDebugModal'"), 'FlightScreen should use the shared flight source debug modal');
const flightSourceDebugModal = read('src/components/flights/FlightSourceDebugModal.tsx');
assert(flightSourceDebugModal.includes('formatProviderDiagnostic'), 'Flight source debug modal should use shared provider diagnostic formatting');
assert(flightSourceDebugModal.includes('cacheMerged'), 'Flight source debug modal should expose cache merge details');

const flightStates = read('src/components/flights/FlightStates.tsx');
assert(flightStates.includes("from '../../utils/flightDiagnostics'"), 'Flight empty state should use shared flight diagnostics');
const flightDiagnostics = read('src/utils/flightDiagnostics.ts');
assert(flightDiagnostics.includes('getTomorrowEmptyReason'), 'flight diagnostics should explain empty tomorrow states');
assert(flightDiagnostics.includes('formatProviderDiagnostic'), 'flight diagnostics should format provider rows consistently');

const calendarScreen = read('src/screens/CalendarScreen.tsx');
assert(calendarScreen.includes("useState<CalendarViewMode>('week')"), 'Calendar screen should open on week view by default');
assert(calendarScreen.includes("(['week', 'calendar'] as const)"), 'Calendar screen should show Week before Calendar');
assert(calendarScreen.includes('enableSwipeMonths={false}'), 'Calendar month view should not switch months by swipe');

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

const appSource = read('App.tsx');
assert(appSource.includes('SafeAreaProvider'), 'App root should provide safe-area insets');
assert(appSource.includes('useSafeAreaInsets'), 'App shell should read native safe-area insets');
assert(!appSource.includes('paddingTop: StatusBar.currentHeight || 48'), 'Root view should not create a blank status-bar spacer');
assert(appSource.includes('translucent'), 'StatusBar should allow the app bar surface behind the status area');

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
