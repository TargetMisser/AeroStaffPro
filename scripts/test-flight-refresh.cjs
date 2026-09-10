const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function loader(mocks) {
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module);
    vm.runInNewContext(output, {
      module, exports: module.exports, console, Date, setTimeout, clearTimeout, AbortController,
      require: key => {
        if (Object.hasOwn(mocks, key)) return mocks[key];
        if (!key.startsWith('.')) return require(key);
        const resolved = path.resolve(path.dirname(filename), key);
        return load(fs.existsSync(resolved + '.ts') ? resolved + '.ts' : resolved + '/index.ts');
      },
    }, { filename });
    return module.exports;
  }
  return load;
}
const empty = { allArrivals: [], allDepartures: [] };
const unusedProvider = { supports: () => false, fetch: async () => empty };
const providerMocks = {
  './aeroDataBoxProvider': { aeroDataBoxProvider: unusedProvider },
  './airLabsProvider': { airLabsProvider: unusedProvider },
  './fr24Provider': { fr24ApiProvider: unusedProvider, fr24PublicProvider: unusedProvider },
  './staffMonitorProvider': { staffMonitorProvider: unusedProvider },
  './flightProviders/fr24Provider': {},
  '../devLog': { devLog() {} },
};
const providerLayer = loader(providerMocks)('src/utils/flightProviders/index.ts');
function flight(number = 'FR100', day = 0, marker = '') {
  const time = new Date();
  time.setDate(time.getDate() + day);
  time.setHours(23, 45, 0, 0);
  return { flight: {
    identification: { number: { default: number } },
    airline: { name: 'Ryanair', code: { iata: 'FR' } },
    airport: { destination: { name: 'London', code: { iata: 'STN' } } },
    time: { scheduled: { departure: time.getTime() / 1000 }, estimated: {}, real: {} }, marker,
  } };
}
function payload(number = 'FR100') {
  return { allArrivals: [], allDepartures: [flight(number)], source: 'staffMonitor',
    sourceLabel: 'StaffMonitor', fetchedAt: Date.now(), diagnostics: [] };
}
function facadeHarness(fetchProvider) {
  const storage = new Map();
  let preference = 'auto';
  let apiKey = null;
  const calls = [];
  const facade = loader({
    ...providerMocks,
    '@react-native-async-storage/async-storage': {
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => storage.set(key, value),
    },
    './airportSettings': {
      getAirportAirlines: () => ['ryanair'],
      getAirportInfo: code => ({ code, name: code }),
      getStoredAirportCode: async () => 'PSA',
      isValidAirportCode: code => /^[A-Z]{3}$/.test(code),
      normalizeAirportCode: code => String(code ?? '').toUpperCase(),
      storeDetectedAirportAirlines: async () => {},
    },
    './flightProviderSettings': {
      getAirLabsApiKey: async () => null, getFr24ApiKey: async () => apiKey,
      getAeroDataBoxApiKey: async () => null, getAeroDataBoxGateway: async () => 'apiMarket',
      getFlightProviderPreference: async () => preference,
    },
    './flightProviders': {
      getFlightScheduleProviders: () => [],
      fetchFlightScheduleFromProviders: async context => { calls.push(context); return fetchProvider(context); },
    },
  })('src/utils/fr24api.ts');
  return { facade, calls, storage, setPreference: value => { preference = value; }, setKey: value => { apiKey = value; } };
}

async function testScreenRefresh() {
  // Run the actual refresh callback, with native/network boundaries controlled.
  // This catches a pull-to-refresh being swallowed while optional ADS-B waits.
  const filename = path.join(root, 'src/screens/FlightScreen.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'fetchAll') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback);
  const output = ts.transpileModule('(' + callback.getText(source) + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const requests = [], overlays = [];
  const state = {};
  const globals = {
    airportLoading: false, isFocused: true, airportCode: 'PSA',
    airportCodeRef: { current: 'PSA' }, isFocusedRef: { current: true },
    activeProfileRef: { current: { airportCode: 'PSA', airlines: ['ryanair'] } },
    fetchInFlightRef: { current: null }, flightRequestIdRef: { current: 0 },
    freshSnapshotAirportRef: { current: null }, lastFlightRefreshAttemptAtRef: { current: 0 },
    liveEtaAbortRef: { current: null }, selectedAirlinesRef: { current: ['ryanair'] },
    createNotificationScheduleCheck: check => check,
    fetchAirportScheduleRaw: (airport, options) => {
      const pending = deferred(); requests.push({ ...pending, airport, options }); return pending.promise;
    },
    getAirportAirlines: () => ['ryanair'], reconcileSelectedAirlines: () => null,
    loadFlightScreenCache: async () => null, saveFlightScreenCache: async () => {},
    mergeFlightExternalLinkMetadata: (previous, next) => next,
    getAirportInfo: () => ({ latitude: 43.68, longitude: 10.39 }),
    fetchAdsbAircraft: (lat, lon, radius, signal) => {
      const pending = deferred();
      signal.addEventListener('abort', () => pending.reject(new Error('aborted')), { once: true });
      overlays.push({ ...pending, signal }); return pending.promise;
    },
    devLog() {}, devError() {}, getErrorMessage: error => error.message,
    TURNAROUND_MATCH_WINDOW_SECONDS: 21600,
    Date, AbortController, setTimeout, clearTimeout,
  };
  for (const name of ['Loading', 'Refreshing', 'AirportAirlines', 'AllArrivalsFull', 'AllDeparturesFull', 'FlightSnapshotAirportCode', 'FlightDataSource', 'Arrivals', 'Departures']) {
    globals['set' + name] = value => { state[name] = value; };
  }
  Object.assign(globals, loader({})('src/utils/flightScheduleAdapter.ts'));
  const fetchAll = vm.runInNewContext(output, globals, { filename });
  const raw = number => ({ ...payload(number), airportCode: 'PSA', departures: [flight(number)], arrivals: [], providerDiagnostics: [] });
  const first = fetchAll({ markRefreshing: true });
  requests[0].options.onProgress(raw('FR101'));
  assert.equal(state.AllDeparturesFull[0].flight.identification.number.default, 'FR101');
  assert.equal(state.Refreshing, false, 'Usable progressive results must clear the blocking refresh state');
  requests[0].resolve(raw('FR101'));
  await tick();
  assert.equal(overlays.length, 1);
  assert.equal(globals.fetchInFlightRef.current, null, 'Primary request lock must end before ADS-B completes');
  const second = fetchAll({ markRefreshing: true });
  assert.equal(requests.length, 2, 'Another manual refresh must start while the old overlay is pending');
  assert.equal(overlays[0].signal.aborted, true, 'New refresh must cancel the superseded overlay');
  requests[0].options.onProgress(raw('FR999'));
  assert.equal(state.AllDeparturesFull[0].flight.identification.number.default, 'FR101', 'Late progress from old requests must be ignored');
  requests[1].options.onProgress(raw('FR102'));
  requests[1].resolve(raw('FR102'));
  await tick();
  assert.equal(state.AllDeparturesFull[0].flight.identification.number.default, 'FR102');
  globals.isFocusedRef.current = false;
  requests[1].options.onProgress(raw('FR888'));
  assert.equal(state.AllDeparturesFull[0].flight.identification.number.default, 'FR102', 'Hidden screens must ignore late progress');
  globals.liveEtaAbortRef.current.abort();
  await Promise.all([first, second]);
}

async function main() {
  // A fast local schedule is visible while an optional source is still pending.
  // Arrival/departure precedence remains provider-order even when completion is reversed.
  const slow = deferred();
  const previews = [];
  let finished = false;
  const request = providerLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA', airport: {}, onProgress: value => previews.push(value),
  }, [
    { id: 'fr24Api', label: 'FR24', supports: () => true, fetch: () => slow.promise },
    { id: 'staffMonitor', label: 'StaffMonitor', supports: () => true,
      fetch: async () => ({ ...empty, allDepartures: [flight('FR100', 0, 'local')] }) },
  ]).then(value => { finished = true; return value; });
  await tick();
  assert.equal(finished, false);
  assert.equal(previews.length, 1, 'Fast provider must publish without waiting for the slow source');
  assert.equal(previews[0].allDepartures[0].flight.marker, 'local');
  slow.resolve({ ...empty, allDepartures: [flight('FR100', 0, 'api'), flight('FR200', 1)] });
  const complete = await request;
  assert.equal(complete.allDepartures.find(item => item.flight.identification.number.default === 'FR100').flight.marker, 'local');
  assert.equal(previews.at(-1).allDepartures.find(item => item.flight.identification.number.default === 'FR100').flight.marker, 'local');
  assert.equal(complete.sourceLabel, 'FR24 + StaffMonitor');
  assert.equal(complete.allDepartures.length, 2, 'Later tomorrow coverage must still be collected');
  assert.equal(previews[0].allDepartures.length, 1, 'Earlier preview must stay immutable');

  const observerSafe = await providerLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA', airport: {}, onProgress() { throw new Error('render failed'); },
  }, [{ id: 'staffMonitor', label: 'StaffMonitor', supports: () => true, fetch: async () => payload() }]);
  assert.equal(observerSafe.diagnostics[0].status, 'success');

  const cancelled = new AbortController();
  const stalled = deferred();
  const abortPreviews = [];
  const abortRequest = providerLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA', airport: {}, signal: cancelled.signal, onProgress: value => abortPreviews.push(value),
  }, [
    { id: 'fr24Api', label: 'FR24', supports: () => true, fetch: () => stalled.promise },
    { id: 'staffMonitor', label: 'StaffMonitor', supports: () => true, fetch: async () => payload() },
  ]);
  await tick();
  cancelled.abort();
  const timedOut = await abortRequest;
  assert.equal(timedOut.allDepartures.length, 1, 'Deadline must retain the useful fast result');
  assert.equal(abortPreviews.length, 1);

  const network = deferred();
  const h = facadeHarness(() => network.promise);
  const firstPreviews = [], secondPreviews = [], latePreviews = [];
  const first = h.facade.fetchAirportScheduleRaw('PSA', { onProgress: value => firstPreviews.push(value) });
  const second = h.facade.fetchAirportScheduleRaw('psa', { onProgress: value => secondPreviews.push(value) });
  await tick();
  assert.equal(h.calls.length, 1, 'Concurrent screens must share one provider pass');
  h.calls[0].onProgress(payload());
  assert.equal(firstPreviews.length, 1);
  assert.equal(secondPreviews.length, 1);
  assert.equal(h.storage.size, 0, 'Partial snapshots must not be persisted as complete refreshes');
  const late = h.facade.fetchAirportScheduleRaw('PSA', { onProgress: value => latePreviews.push(value) });
  await tick();
  assert.equal(latePreviews.length, 1, 'Joining an in-flight refresh must immediately replay useful data');
  network.resolve(payload());
  const [a, b, c] = await Promise.all([first, second, late]);
  assert.equal(a, b);
  assert.equal(b, c);
  await h.facade.fetchAirportScheduleRaw('PSA', { maxAgeMs: 30_000 });
  assert.equal(h.calls.length, 1, 'Quick return to a screen should reuse a recent completed result');
  await h.facade.fetchAirportScheduleRaw('PSA');
  assert.equal(h.calls.length, 2, 'Manual refresh must bypass completed-result reuse');
  h.setPreference('fr24');
  await h.facade.fetchAirportScheduleRaw('PSA', { maxAgeMs: 30_000 });
  assert.equal(h.calls.length, 3, 'Changing provider preference must bypass recent data');
  h.setKey('test-credential');
  await h.facade.fetchAirportScheduleRaw('PSA', { maxAgeMs: 30_000 });
  assert.equal(h.calls.length, 4, 'Changing credentials must bypass recent data');
  await h.facade.fetchAirportScheduleRaw('FCO', { maxAgeMs: 30_000 });
  assert.equal(h.calls.length, 5, 'Airports must never share snapshots');

  const pending = [];
  const isolated = facadeHarness(() => { const d = deferred(); pending.push(d); return d.promise; });
  const psa = isolated.facade.fetchAirportScheduleRaw('PSA');
  const fco = isolated.facade.fetchAirportScheduleRaw('FCO');
  await tick();
  assert.equal(isolated.calls.length, 2, 'Different airports need independent in-flight work');
  pending[0].resolve(payload()); pending[1].resolve(payload('FR300'));
  const airports = await Promise.all([psa, fco]);
  assert.equal(airports[0].airportCode, 'PSA');
  assert.equal(airports[1].airportCode, 'FCO');

  let fail = true;
  const recovery = facadeHarness(async () => { if (fail) throw new Error('offline'); return payload(); });
  await assert.rejects(recovery.facade.fetchAirportScheduleRaw('PSA'), /offline/);
  fail = false;
  await recovery.facade.fetchAirportScheduleRaw('PSA');
  assert.equal(recovery.calls.length, 2, 'Failed in-flight requests must be evicted so retry works');

  let offline = false;
  const fallback = facadeHarness(async () => { if (offline) throw new Error('offline'); return payload(); });
  await fallback.facade.fetchAirportScheduleRaw('PSA');
  offline = true;
  const cached = await fallback.facade.fetchAirportScheduleRaw('PSA');
  assert.ok(cached.providerDiagnostics.some(item => item.mode === 'fallback'));
  await fallback.facade.fetchAirportScheduleRaw('PSA', { maxAgeMs: 30_000 });
  assert.equal(fallback.calls.length, 3, 'Navigation must retry after failure, not reuse a recent fallback as fresh');

  const old = facadeHarness(async () => ({ ...payload(), fetchedAt: Date.now() - 31_000 }));
  await old.facade.fetchAirportScheduleRaw('PSA');
  await old.facade.fetchAirportScheduleRaw('PSA', { maxAgeMs: 30_000 });
  assert.equal(old.calls.length, 2, 'Reuse must expire instead of extending stale data indefinitely');
  await testScreenRefresh();
  console.log('Flight refresh tests passed: progressive results, source precedence, deadline, sharing, retry and fresh manual refresh.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
