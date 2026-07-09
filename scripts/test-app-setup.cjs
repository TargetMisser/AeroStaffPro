#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadTsModule(relativePath, mocks = {}) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const dirname = path.dirname(absolutePath);
  const sandbox = {
    module,
    exports: module.exports,
    require: request => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request];
      }
      if (request.startsWith('.')) {
        const resolved = path.resolve(dirname, request);
        const relative = path.relative(root, resolved).replace(/\\/g, '/');
        const tsPath = fs.existsSync(`${resolved}.ts`) ? `${relative}.ts` : relative;
        return loadTsModule(tsPath, mocks);
      }
      return require(request);
    },
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    JSON,
    Set,
    Map,
    ...(mocks.__globals ?? {}),
  };
  vm.runInNewContext(output, sandbox, { filename: absolutePath });
  return module.exports;
}

const appSetup = loadTsModule('src/utils/appSetup.ts');
assert(appSetup.ONBOARDING_SETUP_STORAGE_KEY === 'aerostaff_onboarding_completed_v1', 'onboarding completion key should be stable');
assert(appSetup.shouldShowOnboarding(null), 'missing onboarding flag should show setup');
assert(!appSetup.shouldShowOnboarding('true'), 'completed onboarding flag should not show setup');

const checklist = appSetup.buildSetupChecklist({
  hasProfile: true,
  airportLabel: 'PSA / LIRP',
  calendarPermission: 'granted',
  notificationPermission: 'undetermined',
  notificationsEnabled: false,
  providerPreference: 'auto',
  hasAeroDataBoxKey: false,
  hasFr24Key: true,
  hasAirLabsKey: false,
  pendingNotifications: 0,
  duplicateNotifications: 0,
});

assert(checklist.requiredComplete, 'profile + calendar should be enough for core setup completion');
assert(checklist.items.some(item => item.id === 'flightData' && item.status === 'ready'), 'FR24 key should make flight data ready');
assert(checklist.items.some(item => item.id === 'notifications' && item.status === 'attention'), 'disabled notification permission should be attention, not blocking');

const noCalendarChecklist = appSetup.buildSetupChecklist({
  hasProfile: true,
  airportLabel: 'PSA / LIRP',
  calendarPermission: 'denied',
  notificationPermission: 'granted',
  notificationsEnabled: true,
  providerPreference: 'staffMonitor',
  hasAeroDataBoxKey: false,
  hasFr24Key: false,
  hasAirLabsKey: false,
  pendingNotifications: 3,
  duplicateNotifications: 0,
});
assert(!noCalendarChecklist.requiredComplete, 'denied calendar should keep core setup incomplete');
assert(noCalendarChecklist.readyCount < noCalendarChecklist.totalCount, 'setup progress should expose incomplete items');

const homeStatus = loadTsModule('src/utils/homeOperationalStatus.ts');
const currentShift = homeStatus.buildHomeOperationalSummary({
  loadingShift: false,
  shiftKind: 'today',
  isWork: true,
  isRest: false,
  shiftStartMs: Date.UTC(2026, 4, 18, 8, 0),
  shiftEndMs: Date.UTC(2026, 4, 18, 13, 0),
  nowMs: Date.UTC(2026, 4, 18, 10, 30),
  hasPinnedFlight: false,
});
assert(currentShift.title === 'Turno in corso', 'current work shift should become the primary now status');
assert(currentShift.tone === 'active', 'current work shift should use active tone');

const nextShift = homeStatus.buildHomeOperationalSummary({
  loadingShift: false,
  shiftKind: 'next',
  isWork: true,
  isRest: false,
  shiftStartMs: Date.UTC(2026, 4, 19, 8, 0),
  shiftEndMs: Date.UTC(2026, 4, 19, 13, 0),
  nowMs: Date.UTC(2026, 4, 18, 22, 0),
  hasPinnedFlight: true,
});
assert(nextShift.title === 'Prossimo turno', 'next shift should surface after the current day is done');
assert(nextShift.badges.includes('Volo pinnato'), 'home summary should expose pinned flight context');

const health = homeStatus.buildHomeHealthChips({
  providerLabel: 'FlightRadar24 API + Cache giornaliera',
  providerFetchedAt: Date.UTC(2026, 4, 18, 12, 0),
  notificationsEnabled: true,
  pendingNotifications: 4,
  duplicateNotifications: 0,
  airportCode: 'PSA',
  nowMs: Date.UTC(2026, 4, 18, 12, 5),
});
assert(health.some(chip => chip.id === 'flights' && chip.tone === 'ready'), 'fresh provider data should render as ready');
assert(health.some(chip => chip.id === 'notifications' && chip.value === '4 attive'), 'notification chip should expose scheduled count');

const flightRefreshPolicy = loadTsModule('src/utils/flightRefreshPolicy.ts');
assert(flightRefreshPolicy.FLIGHT_AUTO_REFRESH_INTERVAL_MS === 120_000, 'flight auto refresh should stay at two minutes');
assert(
  flightRefreshPolicy.FLIGHT_CRITICAL_REFRESH_TIMEOUT_MS === 8_000,
  'critical flight refresh should have an eight-second hard deadline',
);
assert(flightRefreshPolicy.shouldRefreshFlightsOnAppActive({
  isFocused: true,
  airportLoading: false,
  lastRefreshAttemptAt: 0,
  nowMs: Date.UTC(2026, 4, 19, 8, 0),
}), 'flight screen should refresh on app foreground when no previous refresh is known');
assert(flightRefreshPolicy.shouldRefreshFlightsOnAppActive({
  isFocused: true,
  airportLoading: false,
  lastRefreshAttemptAt: Date.UTC(2026, 4, 19, 7, 50),
  nowMs: Date.UTC(2026, 4, 19, 8, 0),
}), 'flight screen should refresh on app foreground when data is stale');
assert(!flightRefreshPolicy.shouldRefreshFlightsOnAppActive({
  isFocused: true,
  airportLoading: false,
  lastRefreshAttemptAt: Date.UTC(2026, 4, 19, 7, 59, 40),
  nowMs: Date.UTC(2026, 4, 19, 8, 0),
}), 'flight screen should not double-refresh immediately after a recent refresh');
assert(!flightRefreshPolicy.shouldRefreshFlightsOnAppActive({
  isFocused: false,
  airportLoading: false,
  lastRefreshAttemptAt: Date.UTC(2026, 4, 19, 7, 0),
  nowMs: Date.UTC(2026, 4, 19, 8, 0),
}), 'flight screen should not refresh on foreground while the tab is not focused');
assert(!flightRefreshPolicy.shouldRefreshFlightsOnAppActive({
  isFocused: true,
  airportLoading: true,
  lastRefreshAttemptAt: Date.UTC(2026, 4, 19, 7, 0),
  nowMs: Date.UTC(2026, 4, 19, 8, 0),
}), 'flight screen should not refresh on foreground while airport context is loading');

// ─── OCR Shift Parser Tests ───────────────────────────────────────────────────
const ocrShiftParser = loadTsModule('src/utils/ocrShiftParser.ts');

// Test that OCR date tokens with typical noise (O, o, Q, I, l, |) are normalized and parsed correctly
const noisyOcrResult1 = ocrShiftParser.parseOcrShiftText('Giovedì l2/O8/2O26 RIPOSO', 2026);
assert(noisyOcrResult1.shifts.length === 1, 'should parse exactly one shift for noisy date');
assert(noisyOcrResult1.shifts[0].date === '2026-08-12', 'should parse date with OCR errors');
assert(noisyOcrResult1.shifts[0].type === 'rest', 'should identify RIPOSO rest shift');

// Test that alphabetical characters in non-date/non-time words are NOT corrupted
const noisyOcrResult2 = ocrShiftParser.parseOcrShiftText('Venerdì 13/08/2026 RIPOSO a Roma', 2026);
assert(noisyOcrResult2.shifts.length === 1, 'should parse exactly one shift');
assert(noisyOcrResult2.shifts[0].date === '2026-08-13', 'should parse correct date');
assert(noisyOcrResult2.shifts[0].type === 'rest', 'should identify RIPOSO even with trailing text');

// Test that work shifts with noisy times (e.g., l2:3O-18:45) parse and normalize correctly
const noisyOcrResult3 = ocrShiftParser.parseOcrShiftText('Sabato 14/08/2026 l2:3O-18:45', 2026);
assert(noisyOcrResult3.shifts.length === 1, 'should parse shift with noisy times');
assert(noisyOcrResult3.shifts[0].type === 'work', 'should identify work shift');
assert(noisyOcrResult3.shifts[0].startTime === '12:30', 'should normalize start time');
assert(noisyOcrResult3.shifts[0].endTime === '18:45', 'should normalize end time');

// ─── Update Checker Version Fallback Tests ───────────────────────────────────
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const asyncStorageMock = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

// Without a native build version (web, tests) APP_VERSION must fall back to
// the tooling-maintained constant, which must match package.json.
const updateCheckerNoNative = loadTsModule('src/utils/updateChecker.ts', {
  'expo-application': { nativeApplicationVersion: null },
  '@react-native-async-storage/async-storage': asyncStorageMock,
});
assert(
  updateCheckerNoNative.FALLBACK_APP_VERSION === packageVersion,
  `FALLBACK_APP_VERSION (${updateCheckerNoNative.FALLBACK_APP_VERSION}) should match package.json version (${packageVersion})`,
);
assert(
  updateCheckerNoNative.APP_VERSION === packageVersion,
  'APP_VERSION should fall back to the package.json version when the native version is unavailable',
);

// With a native build version available, it must win over the fallback.
const updateCheckerNative = loadTsModule('src/utils/updateChecker.ts', {
  'expo-application': { nativeApplicationVersion: '9.9.9' },
  '@react-native-async-storage/async-storage': asyncStorageMock,
});
assert(
  updateCheckerNative.APP_VERSION === '9.9.9',
  'APP_VERSION should prefer the native application version when available',
);

// ─── Widget background refresh source guard ──────────────────────────────────
// The widget's periodic (background) update must pull flights from the real
// provider (StaffMonitor), not the FR24 public endpoint that returns 403 — a
// regression there silently breaks the automatic morning refresh.
const widgetHandlerSource = fs.readFileSync(path.join(root, 'src/widgets/widgetTaskHandler.tsx'), 'utf8');
assert(
  widgetHandlerSource.includes('staffMonitorProvider'),
  'widget background refresh must source flights from the live provider (StaffMonitor)',
);
assert(
  /staffMonitorProvider\.fetch/.test(widgetHandlerSource),
  'widget background refresh must call staffMonitorProvider.fetch for supported airports',
);

const flightScreenSource = fs.readFileSync(path.join(root, 'src/screens/FlightScreen.tsx'), 'utf8');
assert(
  /applyLiveOriginDepartures\(\s*mergedArrs,\s*aircraft,\s*airportInfo\.latitude,\s*airportInfo\.longitude,\s*undefined,\s*adsbController\.signal,\s*\)/.test(flightScreenSource),
  'FlightScreen must pass its ADS-B deadline signal to origin-route lookups',
);
assert(
  !flightScreenSource.includes('inboundArrivals'),
  'flight gate windows must not move with inbound-aircraft delays',
);
assert(
  flightScreenSource.includes('const reconciliation = reconcilePinnedFlight(pinned, pool, Date.now() / 1000);'),
  'FlightScreen must reconcile the fresh pin before evaluating expiry',
);
assert(
  flightScreenSource.includes('AsyncStorage.setItem(PINNED_FLIGHT_KEY, JSON.stringify(refreshedPinned))')
    && flightScreenSource.includes('schedulePinnedNotifications(refreshedPinned, tab, locale, notifSettingsRef.current)')
    && flightScreenSource.includes('sendPinnedFlightToWatch(refreshedPinned)'),
  'FlightScreen must persist, reschedule, and sync the refreshed pinned flight',
);

const pinnedFlightLifecycle = loadTsModule('src/utils/pinnedFlightLifecycle.ts');
const pinnedStd = 1_000_000;
const pinnedEtd = pinnedStd + 90 * 60;
const stalePinnedFlight = {
  _pinTab: 'departures',
  _pinnedAt: 123,
  flight: {
    identification: { number: { default: 'FR1234' } },
    time: { scheduled: { departure: pinnedStd }, estimated: {}, real: {} },
  },
};
const refreshedFlight = {
  flight: {
    identification: { number: { default: 'FR1234' } },
    time: { scheduled: { departure: pinnedStd }, estimated: { departure: pinnedEtd }, real: {} },
  },
};
const refreshedPinnedFlight = pinnedFlightLifecycle.reconcilePinnedFlight(
  stalePinnedFlight,
  [refreshedFlight],
  pinnedStd + 10 * 60,
);
assert(refreshedPinnedFlight.kind === 'keep', 'a delayed pinned flight must not expire at its original STD');
assert(
  refreshedPinnedFlight.item.flight.time.estimated.departure === pinnedEtd
    && refreshedPinnedFlight.item._pinTab === 'departures'
    && refreshedPinnedFlight.item._pinnedAt === 123,
  'pinned refresh must retain the live ETD and pin metadata',
);
assert(
  pinnedFlightLifecycle.reconcilePinnedFlight(stalePinnedFlight, [refreshedFlight], pinnedEtd + 1).kind === 'clear',
  'a pinned flight must expire after its live departure time',
);

const opsSource = fs.readFileSync(path.join(root, 'src/utils/airlineOps.ts'), 'utf8');
assert(
  !opsSource.includes('inboundArrivalTs'),
  'gate-window helper must remain anchored to the scheduled departure',
);

for (const relativePath of [
  'src/modules/WearDataSender.ts',
  'android/wear/src/main/java/com/aerostaffpro/wear/data/FlightData.kt',
  'android/wear/src/main/java/com/aerostaffpro/wear/ui/FlightTimeline.kt',
  'android/wear/src/main/java/com/aerostaffpro/wear/notification/WatchNotificationService.kt',
  'android/wear/src/main/java/com/aerostaffpro/wear/complication/FlightComplicationService.kt',
  'android/wear/src/main/java/com/aerostaffpro/wear/tile/FlightTileService.kt',
]) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  assert(!source.includes('inboundArrival'), `${relativePath} must keep gate timing fixed to the scheduled departure`);
}

const autoNotificationsSource = fs.readFileSync(path.join(root, 'src/utils/autoNotifications.ts'), 'utf8');
const pinnedNotificationsSource = fs.readFileSync(path.join(root, 'src/utils/flightNotificationScheduler.ts'), 'utf8');
assert(!autoNotificationsSource.includes("getScheduledFlightTs(item, 'departure') ?? etdTs"), 'automatic check-in/gate notifications must not fall back to delayed departure time');
assert(!pinnedNotificationsSource.includes("getScheduledFlightTs(item, 'departure') ?? etdTs"), 'pinned check-in/gate notifications must not fall back to delayed departure time');

const homeScreenSource = fs.readFileSync(path.join(root, 'src/screens/HomeScreen.tsx'), 'utf8');
assert(
  homeScreenSource.includes("const displayTs = tab === 'arrivals' ? getBestArrivalTs(item) : getBestDepartureTs(item);"),
  'the pinned Home flight must show the live departure/arrival time while operations stay scheduled',
);
assert(
  homeScreenSource.includes("? getBestArrivalTs(pinned)") && homeScreenSource.includes(": getBestDepartureTs(pinned);"),
  'a delayed pinned flight must remain visible past its scheduled time until its live time passes',
);
const wearTileSource = fs.readFileSync(path.join(root, 'android/wear/src/main/java/com/aerostaffpro/wear/tile/FlightTileService.kt'), 'utf8');
assert(
  wearTileSource.includes('flight.realDeparture ?: flight.estimatedTime ?: flight.scheduledTime'),
  'the Wear tile must show a delayed departure time without moving operational milestones',
);
assert(
  wearTileSource.includes('"Gate Close" to (dep - ops.gateClose * 60)')
    && wearTileSource.includes('"DEP" to displayDeparture'),
  'the Wear tile must keep Gate on STD and use the live departure only for DEP',
);

const shiftTimelineSource = fs.readFileSync(path.join(root, 'src/components/ShiftTimeline.tsx'), 'utf8');
assert(
  /const departureTs = f\.time\?\.real\?\.departure \?\? f\.time\?\.estimated\?\.departure \?\? scheduledDepartureTs;/.test(shiftTimelineSource),
  'ShiftTimeline must show real or estimated departure before STD',
);
assert(
  /const ciOpenTs = flight\.scheduledDepartureTs - flight\.ops\.checkInOpen \* 60;[\s\S]*const gateCloseTs = flight\.scheduledDepartureTs - flight\.ops\.gateClose \* 60;/.test(shiftTimelineSource),
  'ShiftTimeline check-in and gate windows must stay anchored to STD',
);
assert(
  shiftTimelineSource.includes('const depLeft = xPercent(flight.departureTs);'),
  'ShiftTimeline departure marker must use the live departure',
);

const wearTimelineSource = fs.readFileSync(path.join(root, 'android/wear/src/main/java/com/aerostaffpro/wear/ui/FlightTimeline.kt'), 'utf8');
assert(
  /val displayDep = flight\.realDeparture \?: flight\.estimatedTime \?: dep/.test(wearTimelineSource),
  'Wear FlightTimeline must derive a live departure time',
);
assert(
  /RawEvent\("CI Open", dep - ops\.checkInOpen \* 60,[\s\S]*RawEvent\("Gate Close", dep - ops\.gateClose \* 60,[\s\S]*RawEvent\("DEP", displayDep,/.test(wearTimelineSource),
  'Wear FlightTimeline must keep CI and Gate on STD while DEP stays live',
);
assert(
  /dep - ops\.gateClose \* 60,\s*displayDep\s*\)/.test(wearTimelineSource),
  'Wear FlightTimeline countdown must use the live DEP time',
);

const wearComplicationSource = fs.readFileSync(path.join(root, 'android/wear/src/main/java/com/aerostaffpro/wear/complication/FlightComplicationService.kt'), 'utf8');
const watchNotificationSource = fs.readFileSync(path.join(root, 'android/wear/src/main/java/com/aerostaffpro/wear/notification/WatchNotificationService.kt'), 'utf8');
assert(
  wearComplicationSource.includes('Ev("DEP", displayDeparture)')
    && watchNotificationSource.includes('Milestone("DEP", displayDeparture)'),
  'Wear complication and ongoing notification must count down to the live departure',
);

// ─── Shift Calendar Night-Shift Replacement Tests ────────────────────────────
// The Android implementation of expo-calendar getEventsAsync only returns
// events FULLY CONTAINED in the query window (BEGIN >= start AND END <= end).
// The mock reproduces that semantic so a regression to exact-day queries
// makes night shifts (and UTC-stored all-day rests) invisible again.
(async () => {
  const storedEvents = [
    { // night shift: starts June 10th 22:00, ends June 11th 06:00
      id: 'night-10',
      title: 'Lavoro',
      startDate: new Date(2026, 5, 10, 22, 0).toISOString(),
      endDate: new Date(2026, 5, 11, 6, 0).toISOString(),
    },
    { // previous-day night shift: starts June 9th 22:00, ends June 10th 06:00
      id: 'night-09',
      title: 'Lavoro',
      startDate: new Date(2026, 5, 9, 22, 0).toISOString(),
      endDate: new Date(2026, 5, 10, 6, 0).toISOString(),
    },
    { // unrelated personal event on the same day must never be touched
      id: 'personal-10',
      title: 'Dentista',
      startDate: new Date(2026, 5, 10, 10, 0).toISOString(),
      endDate: new Date(2026, 5, 10, 11, 0).toISOString(),
    },
  ];
  const deletedIds = [];
  const calendarMock = {
    getEventsAsync: async (_calendarIds, start, end) => storedEvents.filter(event =>
      new Date(event.startDate).getTime() >= new Date(start).getTime()
      && new Date(event.endDate).getTime() <= new Date(end).getTime(),
    ),
    deleteEventAsync: async id => { deletedIds.push(id); },
    createEventAsync: async () => 'created-id',
  };
  const shiftCalendar = loadTsModule('src/utils/shiftCalendar.ts', {
    'expo-calendar': calendarMock,
    'react-native': { Platform: { OS: 'android' } },
  });

  await shiftCalendar.replaceShiftForDate({
    calendarId: '1',
    date: '2026-06-10',
    type: 'rest',
  });

  assert(
    deletedIds.includes('night-10'),
    'replacing a day must delete a night shift that starts on that day even though it ends past midnight',
  );
  assert(
    !deletedIds.includes('night-09'),
    'replacing a day must not delete the previous day\'s night shift that ends that morning',
  );
  assert(
    !deletedIds.includes('personal-10'),
    'replacing a day must never delete non-shift calendar events',
  );

  console.log('App setup tests passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
