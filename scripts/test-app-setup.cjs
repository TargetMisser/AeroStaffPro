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
    URL,
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
const shiftInput = {
  loadingShift: false, shiftKind: 'today', isWork: true, isRest: false,
  shiftStartMs: new Date(2026, 4, 18, 8).getTime(),
  shiftEndMs: new Date(2026, 4, 18, 13).getTime(),
  nowMs: new Date(2026, 4, 18, 10, 30).getTime(),
};
const currentShift = homeStatus.buildHomeOperationalSummary(shiftInput);
assert(currentShift.title === '08:00 – 13:00', 'the single shift card should lead with the complete time range');
assert(currentShift.tone === 'active' && currentShift.detail === 'Finisce tra 2 h 30 min', 'active shifts should show time remaining');
const upcoming = homeStatus.buildHomeOperationalSummary({ ...shiftInput, nowMs: shiftInput.shiftStartMs - 45 * 60_000 });
assert(upcoming.tone === 'next' && upcoming.detail === 'Inizia tra 45 min', 'a later shift today must not appear in progress');
assert(homeStatus.buildHomeOperationalSummary({ ...shiftInput, nowMs: shiftInput.shiftStartMs }).tone === 'active', 'shift starts at its exact start boundary');
const ended = homeStatus.buildHomeOperationalSummary({ ...shiftInput, nowMs: shiftInput.shiftEndMs });
assert(ended.tone === 'ended' && ended.detail === 'Turno concluso', 'shift ends at its exact end boundary without a negative countdown');
const night = homeStatus.buildHomeOperationalSummary({
  ...shiftInput,
  shiftStartMs: new Date(2026, 4, 18, 22).getTime(), shiftEndMs: new Date(2026, 4, 19, 6).getTime(),
  nowMs: new Date(2026, 4, 19, 2).getTime(),
});
assert(night.tone === 'active' && night.detail === 'Finisce tra 4 h', 'overnight shifts must use full dates for remaining time');
const nextShift = homeStatus.buildHomeOperationalSummary({ ...shiftInput, shiftKind: 'next', nowMs: shiftInput.shiftStartMs - 12 * 3_600_000 });
assert(nextShift.kicker === 'Turno di domani' && nextShift.detail === 'Inizia tra 12 h', 'tomorrow shifts should retain their day label');
assert(homeStatus.buildHomeOperationalSummary({ ...shiftInput, locale: 'en-GB' }).detail === 'Ends in 2 h 30 min', 'shift countdown should follow the app language');
assert(homeStatus.buildHomeOperationalSummary({ ...shiftInput, isWork: false, isRest: true, shiftKind: 'rest' }).tone === 'rest', 'rest days should retain a single rest summary');
assert(homeStatus.buildHomeOperationalSummary({ ...shiftInput, isWork: false, shiftKind: 'none' }).tone === 'empty', 'missing shifts should have an empty summary');
assert(homeStatus.buildHomeOperationalSummary({ ...shiftInput, shiftEndMs: NaN }).tone === 'empty', 'invalid shift times must not render a countdown');

const healthyHome = {
  calendarPermission: 'granted', calendarAvailable: true,
  notificationsEnabled: true, notificationPermissionGranted: true, duplicateNotifications: 0,
  hasRelevantFlights: true, flightStatusLoaded: true,
  providerFetchedAt: shiftInput.nowMs - 5 * 60_000, nowMs: shiftInput.nowMs,
};
assert(homeStatus.buildHomeAttention(healthyHome) === null, 'a healthy Home should show no status panels or warnings');
assert(homeStatus.buildHomeAttention({ ...healthyHome, notificationsEnabled: false, notificationPermissionGranted: false }) === null, 'deliberately disabled notifications should not nag the user');
assert(homeStatus.buildHomeAttention({ ...healthyHome, hasRelevantFlights: false, providerFetchedAt: null }) === null, 'missing flights outside a shift should not clutter Home');
assert(homeStatus.buildHomeAttention({ ...healthyHome, flightStatusLoaded: false, providerFetchedAt: null }) === null, 'unknown flight status should not flash a false missing-data warning');
const stale = homeStatus.buildHomeAttention({ ...healthyHome, providerFetchedAt: shiftInput.nowMs - 21 * 60_000 });
assert(stale.action === 'flights', 'stale shift data should offer to open Flights');
assert(homeStatus.buildHomeAttention({ ...healthyHome, providerFetchedAt: null }).action === 'flights', 'a shift with no loaded flights should offer to open Flights');
assert(homeStatus.buildHomeAttention({ ...healthyHome, notificationPermissionGranted: false }).action === 'notification-permission', 'blocked enabled notifications should offer the permission action');
assert(homeStatus.buildHomeAttention({ ...healthyHome, duplicateNotifications: 2 }).action === 'notification-settings', 'duplicate alerts should link to the notification review');
assert(homeStatus.buildHomeAttention({ ...healthyHome, calendarAvailable: false }).action === 'calendar-setup', 'missing calendars should link to setup');
const denied = homeStatus.buildHomeAttention({ ...healthyHome, calendarPermission: 'denied', providerFetchedAt: null, notificationPermissionGranted: false });
assert(denied.action === 'calendar-permission', 'calendar access takes priority over other issues so only one actionable warning is shown');

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

const appSource = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.ts'), 'utf8');
const metroSource = fs.readFileSync(path.join(root, 'metro.config.js'), 'utf8');
assert(
  indexSource.includes("from './src/runtimeEntry'")
    && !indexSource.includes("require('./.storybook')")
    && metroSource.includes("path.resolve(__dirname, '.storybook/index.ts')")
    && metroSource.includes("moduleName === './src/runtimeEntry'"),
  'production and Storybook must use separate Metro dependency graphs',
);
assert(
  /activeTab\s*!==\s*['"]Shifts['"]\)\s*\{\s*goToTab\(0\);\s*return true;\s*\}/.test(appSource),
  'Android back from a secondary tab should navigate home instead of exiting the app',
);
assert(
  appSource.includes("tab.id === 'TravelDoc'")
    && appSource.includes("activeTab === 'TravelDoc'")
    && appSource.includes('Math.abs(i - activeTabIndex) <= 1'),
  'TravelDoc should unmount on exit and distant tabs should be released from memory',
);
assert(!appSource.includes('DesignLabScreen'), 'Design Lab must not be imported into the production app bundle');

const onboardingSource = fs.readFileSync(path.join(root, 'src/screens/OnboardingScreen.tsx'), 'utf8');
assert(
  onboardingSource.includes('checklist.requiredComplete ? completeSetup : skipSetupForNow')
    && !/const skipSetupForNow[\s\S]*AsyncStorage\.setItem\(ONBOARDING_SETUP_STORAGE_KEY/.test(onboardingSource),
  'skipping incomplete onboarding must dismiss only this run without persisting completion',
);

const lazyHomeScreenSource = fs.readFileSync(path.join(root, 'src/screens/HomeScreen.tsx'), 'utf8');
assert(
  !/tesseract|ImagePicker|engineHtml|runPendingOcr|ocrEngineActive/.test(lazyHomeScreenSource),
  'the retired OCR flow and its remote executable runtime must not ship in HomeScreen',
);

const runtimeDiagnosticsSource = fs.readFileSync(
  path.join(root, 'android/app/src/main/java/com/aerostaffpro/app/runtime/RuntimeDiagnostics.kt'),
  'utf8',
);
assert(
  runtimeDiagnosticsSource.includes('PUBLIC_LOG_FILE_NAME = "AeroStaffPro-runtime-events.txt"'),
  'the public runtime log should use a stable .txt display name that MediaStore can find again',
);

const flightScreenSource = fs.readFileSync(path.join(root, 'src/screens/FlightScreen.tsx'), 'utf8');
const fr24ApiSource = fs.readFileSync(path.join(root, 'src/utils/fr24api.ts'), 'utf8');
assert(
  flightScreenSource.includes('buildUnifiedFlightList(')
    && flightScreenSource.includes("const useStaffMonitorRegistrationHints = airportCode === 'PSA' && activeDay === 'today'")
    && flightScreenSource.includes('const visibleStaffMonitorDepartures = useStaffMonitorRegistrationHints')
    && flightScreenSource.includes(': EMPTY_STAFF_MONITOR_FLIGHTS')
    && flightScreenSource.includes('useStaffMonitorRegistrationHints ? staffMonitorArrs : []')
    && flightScreenSource.includes('useStaffMonitorRegistrationHints ? staffMonitorDeps : []')
    && flightScreenSource.includes('smPool={visibleStaffMonitorDepartures}')
    && flightScreenSource.includes('linkedArrival={entry.linkedArrival}')
    && !flightScreenSource.includes('setActiveTab('),
  'FlightScreen must render one outbound card per rotation and use StaffMonitor registration and gate data only for PSA today',
);
assert(
  flightScreenSource.includes('TURNAROUND_MATCH_WINDOW_SECONDS')
    && flightScreenSource.includes('TURNAROUND_MATCH_WINDOW_SECONDS * 1000')
    && flightScreenSource.includes('filterActiveUnifiedFlights(currentDayRotationData)')
    && fr24ApiSource.includes('function pruneActiveDayFlights(')
    && fr24ApiSource.includes('pruneExpiredFlights(items, direction, nowMs / 1000, TURNAROUND_MATCH_WINDOW_SECONDS)')
    && fr24ApiSource.includes('TURNAROUND_MATCH_WINDOW_SECONDS * 1000'),
  'screen and provider cache must retain arrivals and their unseen timestamps for the full turnaround window',
);
assert(
  flightScreenSource.includes("pinned?._pinTab === 'arrivals'")
    && flightScreenSource.includes('try { await AsyncStorage.removeItem(PINNED_FLIGHT_KEY); } catch {}')
    && flightScreenSource.includes("cancelPinnedNotifications('legacy arrival pin removed', false)")
    && flightScreenSource.includes('await dismissPinnedFlightNotification()'),
  'startup must remove legacy arrival pins and clean both scheduled and ongoing pinned notifications',
);
assert(
  flightScreenSource.includes('const time = ts ? new Date(ts * 1000)')
    && !flightScreenSource.includes('const bestTs = isArrival ? getBestArrivalTs(item) : getBestDepartureTs(item)')
    && flightScreenSource.includes("t('flightLinkedArrival')")
    && flightScreenSource.includes("t('flightLinkedArrivalPending')"),
  'card headers must stay on scheduled time while the linked arrival remains a contextual detail',
);
assert(
  flightScreenSource.includes('const arrivalLinkItem = getFlightradar24ArrivalTarget(item, linkedArrival, direction)')
    && flightScreenSource.includes('openFlightradar24Arrival(arrivalLinkItem, airportCode)')
    && flightScreenSource.includes("resolveFlightradar24IdForFlight(airportCode, arrivalItem, 'arrival')")
    && flightScreenSource.includes('buildFlightradar24FlightPageUrl(flightNumber, fr24Id)')
    && flightScreenSource.includes("buildFlightradar24AirportBoardUrl(airportCode, 'arrival')")
    && flightScreenSource.includes('openFlightradar24AirportArrivals(airportCode)')
    && flightScreenSource.includes('disabled={!canOpenArrivalLink}')
    && flightScreenSource.includes("t('flightAirportArrivalsFr24')")
    && !flightScreenSource.includes('openFlightradar24Flight(item, direction, airportCode)')
    && flightScreenSource.includes('enrichFlightScheduleWithFr24Ids(requestAirportCode, mergedArrs, mergedDeps)')
    && flightScreenSource.includes("direction === 'arrival' ? 'arrivals' : 'departures'"),
  'unified rows must open only the linked inbound flight page while the dedicated button owns the airport arrivals board',
);
assert(
  flightScreenSource.includes("t('flightScheduledDeparture')")
    && flightScreenSource.includes("t('flightEstimatedDeparture')")
    && flightScreenSource.includes("t('flightCheckin')")
    && flightScreenSource.includes("t('flightGate')")
    && flightScreenSource.includes('? item.flight?.time?.estimated?.departure')
    && !flightScreenSource.includes('item.flight?.time?.estimated?.departure ?? scheduledDepartureTs')
    && flightScreenSource.includes("Number.isFinite(value) ? fmtTs(value) : '--:--'"),
  'departure cards must always render scheduled, estimated, check-in, and gate fields with honest missing-value fallbacks',
);
assert(
  flightScreenSource.includes('departureCard: { minHeight: isOperations ? 300 : 330 }')
    && flightScreenSource.includes('!isArrival && s.departureCard')
    && flightScreenSource.includes('minHeight: isOperations ? 62 : 68')
    && flightScreenSource.includes('departureTimesRow: { marginBottom: 10 }'),
  'flight cards must remain large enough for both departure detail rows without clipping',
);
assert(
  flightScreenSource.includes('const [expanded, setExpanded] = useState(false)')
    && flightScreenSource.includes('const compactMode = !expanded')
    && flightScreenSource.includes('onPress={() => setExpanded(current => !current)}')
    && flightScreenSource.includes("t(expanded ? 'flightCollapseDetails' : 'flightExpandDetails')")
    && flightScreenSource.includes('compactMode ? (')
    && flightScreenSource.includes('event.stopPropagation()')
    && flightScreenSource.includes('>FR24</Text>')
    && !flightScreenSource.includes('FLIGHT_COMPACT_MODE_KEY'),
  'flight rows must start compact, expand on card press, and keep FR24 behind a separate button',
);
assert(
  flightScreenSource.includes('filterFlightsByAirlines(mergedDeps, wAllowedAirlines)'),
  'the foreground widget writer must treat an empty airline selection as no flights',
);
assert(
  flightScreenSource.includes('airportCodeRef.current === requestAirportCode')
    && flightScreenSource.includes('setAllArrivalsFull([])')
    && flightScreenSource.includes('setAllDeparturesFull([])'),
  'FlightScreen must clear cross-airport snapshots and reject late responses from the previous airport',
);
assert(
  flightScreenSource.includes('isFlightServiceMatch(pinnedFlight, item, direction)')
    && flightScreenSource.includes("isFlightServiceMatch(pinnedFlight, linkedArrival, 'arrival')")
    && flightScreenSource.includes("isFlightServiceMatch(pinnedDeparture, item, 'departure')")
    && widgetHandlerSource.includes("isFlightServiceMatch(pinnedDeparture, item, 'departure')"),
  'app and widget pin highlighting must use the full provider-tolerant service identity',
);
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
  flightScreenSource.includes('updateStorageForCurrentRequest('),
  'FlightScreen must persist the refreshed pinned flight through a token-aware storage transaction',
);
assert(
  flightScreenSource.includes('schedulePinnedNotifications(')
    && flightScreenSource.includes('isCurrentRequest,'),
  'FlightScreen must reschedule the refreshed pin with the originating request token',
);
assert(
  flightScreenSource.includes('runEffectsForCurrentRequest(isCurrentRequest')
    && flightScreenSource.includes('restoreStorageValueIfUnchanged('),
  'global pin effects must stop between awaits and roll back their storage write when an airport request becomes stale',
);
assert(
  flightScreenSource.includes('const yesterdayStart = new Date(todayStart)')
    && flightScreenSource.includes('if (!isOwnedShiftEvent(e)) continue;')
    && flightScreenSource.includes('s <= nowSec && en > nowSec'),
  'FlightScreen must recognize an owned overnight shift that started yesterday',
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

const pinnedServiceTs = Math.floor(new Date(2026, 6, 10, 10, 0, 0).getTime() / 1000);
const nextDayServiceTs = Math.floor(new Date(2026, 6, 11, 10, 0, 0).getTime() / 1000);
const aliasedPinnedFlight = {
  _pinTab: 'departures',
  flight: {
    identification: { number: { default: 'FR 4321' } },
    airport: { destination: { code: { iata: 'STN' } } },
    time: { scheduled: { departure: pinnedServiceTs }, estimated: {}, real: {} },
  },
};
const wrongNextDayRotation = {
  marker: 'tomorrow',
  flight: {
    identification: { number: { default: 'RYR4321' } },
    airport: { destination: { name: 'London Stansted' } },
    time: { scheduled: { departure: nextDayServiceTs }, estimated: {}, real: {} },
  },
};
const matchingAliasedRotation = {
  marker: 'today',
  flight: {
    identification: { number: { default: 'RYR4321' } },
    airport: { destination: { name: 'London Stansted' } },
    time: { scheduled: { departure: pinnedServiceTs }, estimated: { departure: pinnedServiceTs + 600 }, real: {} },
  },
};
const aliasedReconciliation = pinnedFlightLifecycle.reconcilePinnedFlight(
  aliasedPinnedFlight,
  [wrongNextDayRotation, matchingAliasedRotation],
  pinnedServiceTs - 60,
);
assert(
  aliasedReconciliation.kind === 'keep'
    && aliasedReconciliation.item.marker === 'today'
    && aliasedReconciliation.flightId === 'RYR4321',
  'pin reconciliation must canonicalize provider aliases and select the exact service date instead of the first same-number rotation',
);
assert(
  pinnedFlightLifecycle.reconcilePinnedFlight(
    aliasedPinnedFlight,
    [wrongNextDayRotation],
    pinnedServiceTs - 60,
  ).reason === 'missing',
  'a different-day rotation with the same canonical flight number must not replace the pinned service',
);

const unknownAirportNamePin = {
  _pinTab: 'departures',
  flight: {
    identification: { number: { default: 'FR6001' } },
    airport: { destination: { name: 'Malaga Costa del Sol Airport' } },
    time: { scheduled: { departure: pinnedServiceTs }, estimated: {}, real: {} },
  },
};
const sameServiceByIata = {
  marker: 'same-service',
  flight: {
    identification: { number: { default: 'RYR6001' } },
    airport: { destination: { code: { iata: 'AGP' } } },
    time: { scheduled: { departure: pinnedServiceTs + 15 * 60 }, estimated: { departure: pinnedServiceTs + 4 * 60 * 60 }, real: {} },
  },
};
const wrongSameDayRotation = {
  marker: 'wrong-rotation',
  flight: {
    identification: { number: { default: 'RYR6001' } },
    airport: { destination: { code: { iata: 'AGP' } } },
    time: { scheduled: { departure: pinnedServiceTs + 5 * 60 * 60 }, estimated: {}, real: {} },
  },
};
const unknownAirportReconciliation = pinnedFlightLifecycle.reconcilePinnedFlight(
  unknownAirportNamePin,
  [wrongSameDayRotation, sameServiceByIata],
  pinnedServiceTs - 60,
);
assert(
  unknownAirportReconciliation.kind === 'keep'
    && unknownAirportReconciliation.item.marker === 'same-service',
  'pin reconciliation must bridge a non-aliased airport name to IATA using canonical number/date and the scheduled-time guard',
);

const opsSource = fs.readFileSync(path.join(root, 'src/utils/airlineOps.ts'), 'utf8');
assert(
  !opsSource.includes('inboundArrivalTs'),
  'gate-window helper must remain anchored to the scheduled departure',
);

const autoNotificationsSource = fs.readFileSync(path.join(root, 'src/utils/autoNotifications.ts'), 'utf8');
const pinnedNotificationsSource = fs.readFileSync(path.join(root, 'src/utils/flightNotificationScheduler.ts'), 'utf8');
assert(!autoNotificationsSource.includes("getScheduledFlightTs(item, 'departure') ?? etdTs"), 'automatic check-in/gate notifications must not fall back to delayed departure time');
assert(!pinnedNotificationsSource.includes("getScheduledFlightTs(item, 'departure') ?? etdTs"), 'pinned check-in/gate notifications must not fall back to delayed departure time');

const homeScreenSource = fs.readFileSync(path.join(root, 'src/screens/HomeScreen.tsx'), 'utf8');
assert(
  homeScreenSource.includes('storeWidgetDataPreservingFlights(widgetData)'),
  'Home shift refreshes must preserve cached widget flights for the active shift',
);
assert(
  homeScreenSource.includes("const displayTs = tab === 'arrivals' ? getBestArrivalTs(item) : getBestDepartureTs(item);"),
  'the pinned Home flight must show the live departure/arrival time while operations stay scheduled',
);
assert(
  homeScreenSource.includes('const reconciliation = reconcilePinnedFlight(pinned, pool, Date.now() / 1000);')
    && homeScreenSource.includes("reconciliation.reason === 'missing'")
    && homeScreenSource.includes("reconciliation.item?.flight?.time?.real?.departure"),
  'Home must preserve pins through provider gaps and past cached estimates until a real completion is confirmed',
);
assert(
  homeScreenSource.includes("cancelPinnedNotifications('home confirmed pinned flight expiry'")
    && homeScreenSource.includes('dismissPinnedFlightNotification()'),
  'a pin that Home confirms as expired must clean scheduled and ongoing notification surfaces',
);
assert(
  homeScreenSource.includes('events.filter(isOwnedShiftEvent)')
    && homeScreenSource.includes('const currentWork = workEvents.find')
    && homeScreenSource.includes('shiftToday: (currentWork ?? todayWork) ?'),
  'Home and its widget snapshot must retain an owned overnight shift after midnight',
);

const calendarScreenSource = fs.readFileSync(path.join(root, 'src/screens/CalendarScreen.tsx'), 'utf8');
assert(
  calendarScreenSource.includes('await pushShiftsToWidget(widgetUpdates)')
    && calendarScreenSource.includes('storeWidgetDataPreservingFlights(noFlightData)')
    && calendarScreenSource.includes('PDF_EXTRACTION_TIMEOUT_MS')
    && calendarScreenSource.includes('MAX_PDF_TOTAL_BYTES'),
  'calendar import must update widget shifts atomically, preserve flights, and bound PDF extraction',
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

// ─── Shift Calendar Night-Shift Replacement Tests ────────────────────────────
// The Android implementation of expo-calendar getEventsAsync only returns
// events FULLY CONTAINED in the query window (BEGIN >= start AND END <= end).
// The mock reproduces that semantic so a regression to exact-day queries
// makes night shifts (and UTC-stored all-day rests) invisible again.
(async () => {
  const currentRequestEffects = loadTsModule('src/utils/currentRequestEffects.ts');
  let currentRequest = true;
  const guardedStore = new Map([['pin', 'old-pin']]);
  const guardedStorage = {
    getItem: async key => guardedStore.get(key) ?? null,
    setItem: async (key, value) => {
      guardedStore.set(key, value);
      currentRequest = false;
    },
    removeItem: async key => { guardedStore.delete(key); },
  };
  const committed = await currentRequestEffects.updateStorageForCurrentRequest(
    guardedStorage,
    'pin',
    'old-airport-refresh',
    'old-pin',
    () => currentRequest,
  );
  assert(!committed && guardedStore.get('pin') === 'old-pin',
    'a pin write that completes after its airport token becomes stale must roll back without owning global storage');

  currentRequest = true;
  guardedStore.set('pin', 'new-user-pin');
  const supersededWrite = await currentRequestEffects.updateStorageForCurrentRequest(
    guardedStorage,
    'pin',
    'old-airport-refresh',
    'old-pin',
    () => currentRequest,
  );
  assert(!supersededWrite && guardedStore.get('pin') === 'new-user-pin',
    'a fetch must not overwrite a newer pin that replaced the snapshot it originally read');

  currentRequest = true;
  const completedEffects = [];
  const allEffectsApplied = await currentRequestEffects.runEffectsForCurrentRequest(
    () => currentRequest,
    [
      async () => { completedEffects.push('first'); currentRequest = false; },
      async () => { completedEffects.push('stale-second'); },
    ],
  );
  assert(!allEffectsApplied && completedEffects.join(',') === 'first',
    'global pin effects must stop between awaits when an airport request token becomes stale');

  const updateWrites = new Map();
  const updateCheckerWithLegacyCompanionFirst = loadTsModule('src/utils/updateChecker.ts', {
    'expo-application': { nativeApplicationVersion: '1.0.0' },
    '@react-native-async-storage/async-storage': {
      getItem: async key => updateWrites.get(key) ?? null,
      setItem: async (key, value) => { updateWrites.set(key, value); },
      removeItem: async key => { updateWrites.delete(key); },
    },
    __globals: {
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v9.9.9',
          html_url: 'https://github.com/TargetMisser/AeroStaffPro/releases/tag/v9.9.9',
          body: 'test release',
          assets: [
            { name: 'AeroStaffPro-Wear-v9.9.9.apk', browser_download_url: 'https://example.test/wear.apk' },
            {
              name: 'AeroStaffPro-v9.9.9.apk',
              browser_download_url: 'https://github.com/TargetMisser/AeroStaffPro/releases/download/v9.9.9/AeroStaffPro-v9.9.9.apk',
              content_type: 'application/vnd.android.package-archive',
              digest: `sha256:${'a'.repeat(64)}`,
              size: 123456,
            },
          ],
        }),
      }),
    },
  });
  const legacyCompanionFirstUpdate = await updateCheckerWithLegacyCompanionFirst.checkForUpdate(true);
  assert(
    legacyCompanionFirstUpdate?.assetName === 'AeroStaffPro-v9.9.9.apk'
      && legacyCompanionFirstUpdate?.downloadUrl === 'https://github.com/TargetMisser/AeroStaffPro/releases/download/v9.9.9/AeroStaffPro-v9.9.9.apk'
      && legacyCompanionFirstUpdate?.assetDigest === `sha256:${'a'.repeat(64)}`
      && legacyCompanionFirstUpdate?.assetSize === 123456,
    'update checker must select the phone APK when a legacy companion APK is listed first',
  );

  const updateDownload = loadTsModule('src/utils/updateDownload.ts', {
    'react-native': {
      Linking: { openURL: async () => {} },
      NativeModules: {},
      Platform: { OS: 'android' },
    },
    'expo-application': { applicationId: 'com.aerostaffpro.app' },
    'expo-file-system/legacy': {
      documentDirectory: 'file:///private/files/',
      EncodingType: { UTF8: 'utf8' },
    },
    'expo-intent-launcher': {},
  });
  const validUpdateInfo = {
    available: true,
    latestVersion: 'v9.9.9',
    downloadUrl: 'https://github.com/TargetMisser/AeroStaffPro/releases/download/v9.9.9/AeroStaffPro-v9.9.9.apk',
    releaseUrl: 'https://github.com/TargetMisser/AeroStaffPro/releases/tag/v9.9.9',
    releaseNotes: '',
    assetName: 'AeroStaffPro-v9.9.9.apk',
    assetDigest: `sha256:${'a'.repeat(64)}`,
    assetSize: 123456,
    checkedAt: Date.now(),
  };
  assert(
    updateDownload.ensureDownloadUrl(validUpdateInfo) === validUpdateInfo.downloadUrl,
    'the updater must accept only the canonical HTTPS GitHub asset URL',
  );
  for (const maliciousUrl of [
    'http://github.com/TargetMisser/AeroStaffPro/releases/download/v9.9.9/AeroStaffPro-v9.9.9.apk',
    'https://github.com.evil.test/TargetMisser/AeroStaffPro/releases/download/v9.9.9/AeroStaffPro-v9.9.9.apk',
    'https://github.com/TargetMisser/AeroStaffPro/releases/download/v9.9.8/AeroStaffPro-v9.9.9.apk',
  ]) {
    let rejected = false;
    try {
      updateDownload.ensureDownloadUrl({ ...validUpdateInfo, downloadUrl: maliciousUrl });
    } catch {
      rejected = true;
    }
    assert(rejected, `the updater must reject untrusted asset URL: ${maliciousUrl}`);
  }

  const passwordScreenSource = fs.readFileSync(path.join(root, 'src/screens/PasswordScreen.tsx'), 'utf8');
  const pinPolicyRead = passwordScreenSource.indexOf('const enabled = await AsyncStorage.getItem(PIN_ENABLED_KEY)');
  const passwordRead = passwordScreenSource.indexOf('const loaded = await loadPasswords()', pinPolicyRead);
  assert(pinPolicyRead >= 0 && passwordRead > pinPolicyRead, 'vault bootstrap must resolve PIN policy before loading passwords');
  assert(
    passwordScreenSource.includes("AppState.addEventListener('change', onAppStateChange)")
      && passwordScreenSource.includes('setEntries([])')
      && passwordScreenSource.includes('getPinBackoffMs')
      && passwordScreenSource.includes('setSecureWindow(true)'),
    'vault must relock and clear secrets in background, throttle PIN retries, and protect Android snapshots',
  );

  const arionSource = fs.readFileSync(path.join(root, 'src/screens/ArionInboxScreen.tsx'), 'utf8');
  assert(
    arionSource.includes('isAllowedArionNavigation(request.url)')
      && arionSource.includes("'prd-arion-ap.firebaseapp.com'")
      && !arionSource.includes("originWhitelist={['https://*']}"),
    'Arion WebView must keep top-level navigation on its explicit host allowlist',
  );
  const traveldocSource = fs.readFileSync(path.join(root, 'src/screens/TraveldocScreen.tsx'), 'utf8');
  assert(
    traveldocSource.includes('isAllowedTraveldocNavigation(request.url)')
      && traveldocSource.includes("host.endsWith('.traveldoc.aero')")
      && traveldocSource.includes('mixedContentMode="never"'),
    'TravelDoc WebView must externalize non-TravelDoc hosts and reject mixed content',
  );

  const manifestSource = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert(
    manifestSource.includes('android:allowBackup="false"')
      && manifestSource.includes('android:dataExtractionRules="@xml/data_extraction_rules"')
      && !manifestSource.includes('android.permission.CAMERA')
      && manifestSource.includes('android:name="com.reactnativeandroidwidget.RNWidgetImageProvider" android:authorities="${applicationId}.rnwidget.imageprovider" android:exported="true"')
      && !manifestSource.includes('RNWidgetImageProvider" tools:node="remove"'),
    'release manifest must disable backup, remove unused dangerous permissions, and retain the launcher-readable widget image provider',
  );
  const nativeSecuritySource = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/aerostaffpro/app/security/AppSecurityModule.kt'), 'utf8');
  assert(
    nativeSecuritySource.includes('APK package name mismatch')
      && nativeSecuritySource.includes('APK signing certificate does not match')
      && nativeSecuritySource.includes('APK SHA-256 mismatch')
      && nativeSecuritySource.includes('FLAG_SECURE'),
    'native security bridge must validate APK identity/integrity and expose secure-window protection',
  );

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
