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

console.log('App setup tests passed.');
