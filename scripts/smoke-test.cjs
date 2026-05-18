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
assert(scripts['test:app-setup'], 'package.json should expose test:app-setup');
assert(scripts['test:smoke'], 'package.json should expose test:smoke');
assert(scripts['release:check'], 'package.json should expose release:check');
assert(scripts['github:branches:audit'], 'package.json should expose github:branches:audit');

const dependencies = packageJson.dependencies || {};
assert(dependencies['react-native-reanimated'], 'package.json should include react-native-reanimated for motion prototypes');
assert(dependencies['react-native-gesture-handler'], 'package.json should include react-native-gesture-handler for motion prototypes');
assert(dependencies['react-native-worklets'], 'package.json should include react-native-worklets for Reanimated 4 worklets');

const babelConfig = read('babel.config.js');
assert(babelConfig.includes('babel-preset-expo'), 'babel config should keep Expo preset');
assert(babelConfig.includes('react-native-worklets/plugin'), 'babel config should enable the Worklets plugin for Reanimated 4');

const flightScreen = read('src/screens/FlightScreen.tsx');
assert(flightScreen.includes("from '../utils/flightScheduleAdapter'"), 'FlightScreen should use the shared flight adapter');
assert(flightScreen.includes("from '../utils/flightScreenCache'"), 'FlightScreen should use the shared flight screen cache');
assert(flightScreen.includes("from '../utils/flightNotificationScheduler'"), 'FlightScreen should use the shared flight notification scheduler');
assert(flightScreen.includes('getFlightAirportDisplay'), 'FlightScreen should render decoded airport code/name labels');
assert(flightScreen.includes('headerAirportName'), 'FlightScreen should style decoded airport names separately from IATA codes');

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
assert(appSource.includes('GestureHandlerRootView'), 'App root should be wrapped in GestureHandlerRootView');
assert(appSource.includes("from './src/screens/OnboardingScreen'"), 'App should expose the guided setup screen');
assert(appSource.includes('ONBOARDING_SETUP_STORAGE_KEY'), 'App should use the shared onboarding completion key');
assert(appSource.includes('useSafeAreaInsets'), 'App shell should read native safe-area insets');
assert(!appSource.includes('paddingTop: StatusBar.currentHeight || 48'), 'Root view should not create a blank status-bar spacer');
assert(appSource.includes('translucent'), 'StatusBar should allow the app bar surface behind the status area');

const motionSource = read('src/utils/motion.ts');
for (const symbol of [
  'motionRecipeDurations',
  'motionRecipeEasing',
  'motionRecipeSprings',
  'motionPatternIds',
]) {
  assert(motionSource.includes(symbol), `motion tokens should expose ${symbol}`);
}

const cinematicMotionBoard = read('src/dev/CinematicMotionBoard.tsx');
for (const patternId of [
  'footer-nav',
  'drawer-reveal',
  'flight-card-live-update',
  'cache-loading',
  'press-feedback',
  'editorial-empty-state',
]) {
  assert(cinematicMotionBoard.includes(patternId), `Cinematic motion board should include ${patternId}`);
}

const cinematicStory = read('.storybook/stories/cinematic-motion-board.stories.tsx');
assert(cinematicStory.includes('CinematicMotionBoard'), 'Storybook should expose the Cinematic Motion Board');

const onboardingSource = read('src/screens/OnboardingScreen.tsx');
assert(onboardingSource.includes('buildSetupChecklist'), 'Onboarding screen should use shared setup checklist logic');
assert(onboardingSource.includes('requestCalendarPermissionsAsync'), 'Onboarding should guide calendar permission setup');
assert(onboardingSource.includes('requestPermissionsAsync'), 'Onboarding should guide notification permission setup');

const homeScreen = read('src/screens/HomeScreen.tsx');
assert(homeScreen.includes("from '../utils/homeOperationalStatus'"), 'Home should use shared operational status helpers');
assert(homeScreen.includes('buildHomeOperationalSummary'), 'Home should render an operational now/next summary');
assert(homeScreen.includes('buildHomeHealthChips'), 'Home should render lightweight app health chips');

const settingsScreen = read('src/screens/SettingsScreen.tsx');
assert(settingsScreen.includes('onOpenOnboarding'), 'Settings should expose guided setup again after first launch');
assert(settingsScreen.includes('Setup guidato'), 'Settings should render a guided setup entry point');

const designLab = read('src/screens/DesignLabScreen.tsx');
assert(designLab.includes('CinematicMotionBoard'), 'Design Lab should embed the Cinematic Motion Board prototype');

const appTabBar = read('src/components/AppTabBar.tsx');
assert(appTabBar.includes('motionRecipeSprings'), 'App tab bar should use centralized motion recipe springs');
assert(appTabBar.includes('motionRecipeDurations'), 'App tab bar should use centralized motion recipe durations');
assert(appTabBar.includes('useReducedMotionPreference'), 'App tab bar should respect reduced-motion settings');
assert(appTabBar.includes('withMotionTokens'), 'App tab bar should label the real footer motion integration');

const drawerMenu = read('src/components/DrawerMenu.tsx');
assert(drawerMenu.includes('panelTranslateX'), 'Drawer menu should animate with transform translateX');
assert(drawerMenu.includes('panelScale'), 'Drawer menu should add depth scale during reveal');
assert(!drawerMenu.includes('{ left: slideAnim }'), 'Drawer menu should not animate layout left');
assert(drawerMenu.includes('useNativeDriver: true'), 'Drawer menu reveal should stay on the native driver');
assert(drawerMenu.includes('useReducedMotionPreference'), 'Drawer menu should respect reduced-motion settings');

const motionAudit = read('docs/motion-inspiration-audit.md');
for (const marker of [
  'Inspiration Matrix',
  'React Native Reanimated',
  'gorhom/react-native-animated-tabbar',
  'Material Motion',
  'Apple HIG Motion',
]) {
  assert(motionAudit.includes(marker), `motion audit should include ${marker}`);
}

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
