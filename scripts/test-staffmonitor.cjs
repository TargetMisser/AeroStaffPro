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
    Map,
    Set,
    Number,
    String,
    Array,
    Math,
    JSON,
    RegExp,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    AbortController,
    __DEV__: false,
    ...(mocks.__globals ?? {}),
  };
  vm.runInNewContext(output, sandbox, { filename: absolutePath });
  return module.exports;
}

function makeAsyncStorageMock(initialStore = {}) {
  const store = { ...initialStore };
  return {
    _store: store,
    getItem: async key => (key in store ? store[key] : null),
    setItem: async (key, value) => { store[key] = value; },
    removeItem: async key => { delete store[key]; },
  };
}

function makeResponse({ body, ok = true, status = 200, setCookie = null }) {
  return {
    ok,
    status,
    headers: { get: name => (name.toLowerCase() === 'set-cookie' ? setCookie : null) },
    text: async () => body,
  };
}

// ─── normalizeFlightNumber ───────────────────────────────────────────────────
const baseModule = loadTsModule('src/utils/staffMonitor.ts', {
  '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
  __globals: { fetch: async () => { throw new Error('unused'); } },
});

assert(baseModule.normalizeFlightNumber('FR07146') === 'FR7146', 'should drop a single leading zero after a 2-letter IATA code');
assert(baseModule.normalizeFlightNumber('W405032') === 'W45032', 'should drop a single leading zero after a mixed-alnum code (W4)');
assert(baseModule.normalizeFlightNumber('U208320') === 'U28320', 'should drop a single leading zero after a mixed-alnum code (U2)');
assert(baseModule.normalizeFlightNumber('FR1234') === 'FR1234', 'should leave flight numbers without leading zeros unchanged');
assert(baseModule.normalizeFlightNumber('  fr1234 ') === 'FR1234', 'should trim and uppercase raw flight numbers');

// ─── HTML table parsing (departures) ─────────────────────────────────────────
const departuresHtml = `
<html><body>
<table>
<tr><th colspan="2">VOLO / FLIGHT</th><th>AC TYPE</th><th>REG</th><th>DEST</th><th>SCHED</th><th>EXP</th><th>STATUS</th><th>STAND</th><th>GATE</th><th>BANCO</th><th>BELT</th></tr>
<tr><td><img src="fr.png"/></td><td>FR1234 B738</td><td>B738</td><td>EI-DPB</td><td>Barcelona</td><td>10.30</td><td>10.45</td><td>BOARDING</td><td>17&#9670; Federico</td><td>4</td><td>3 RICCARDO F</td><td>--</td></tr>
<tr><td><img src="u2.png"/></td><td>U21234</td><td>A20N</td><td>G-UZHA</td><td>London Gatwick</td><td>11.00</td><td></td><td>SCHEDULED</td><td>ANA</td><td>--</td><td>Albe 3284693677</td><td>--</td></tr>
</table>
</body></html>`;

async function runStaffMonitor(nature, { fetchImpl, store } = {}) {
  let callCount = 0;
  const wrappedFetch = async (...args) => {
    callCount += 1;
    return fetchImpl(...args);
  };
  const asyncStorage = makeAsyncStorageMock(store ?? {});
  const mod = loadTsModule('src/utils/staffMonitor.ts', {
    '@react-native-async-storage/async-storage': asyncStorage,
    __globals: { fetch: wrappedFetch },
  });
  const result = await mod.fetchStaffMonitorData(nature);
  return { mod, result, callCount, asyncStorage };
}

(async () => {
  const { mod, result } = await runStaffMonitor('D', {
    fetchImpl: async () => makeResponse({ body: departuresHtml }),
  });

  assert(result.length === 2, 'departures HTML should yield two parsed flights');

  const [fr, u2] = result;
  assert(fr.flightNumber === 'FR1234', 'first row flight number should be parsed from "FR1234 B738"');
  assert(fr.aircraftType === 'B738', 'first row aircraft type should come from AC TYPE column');
  assert(fr.registration === 'EI-DPB', 'first row registration should come from REG column');
  assert(fr.route === 'Barcelona', 'first row route should come from DEST column');
  assert(fr.scheduledTime === '10:30', 'dotted scheduled time "10.30" should normalize to "10:30"');
  assert(fr.estimatedTime === '10:45', 'dotted estimated time "10.45" should normalize to "10:45"');
  assert(fr.status === 'BOARDING', 'first row status should come from STATUS column');
  assert(fr.stand === '17', 'stand code should be extracted from "17◆ Federico"');
  assert(fr.checkin === '3', 'checkin desk code should be extracted from "3 RICCARDO F"');
  assert(fr.gate === '4', 'gate code should be the plain numeric value');
  assert(fr.belt === undefined, '"--" belt placeholder should be treated as empty');

  assert(u2.flightNumber === 'U21234', 'second row flight number should be parsed unchanged (no leading zero)');
  assert(u2.estimatedTime === undefined, 'empty EXP cell should yield an undefined estimated time');
  assert(u2.stand === undefined, 'pure-letter handler name "ANA" in STAND column should be rejected');
  assert(u2.gate === undefined, '"--" gate placeholder should be treated as empty');
  assert(u2.checkin === undefined, 'phone-number-like checkin value should be rejected as junk');

  assert(mod.getStaffMonitorDebugColumns().includes('"volo / flight"'), 'debug columns should record the detected header row');
})().then(() => runArrivalsXmlTest()).catch(handleFailure);

// ─── XML parsing (arrivals) ──────────────────────────────────────────────────
const arrivalsXml = `<FLIGHTS>
<FLIGHT code="FR" number="5678" aircraftType="B738" aircraftReg="EI-FRB" flightTypeDescr="Scheduled" city="Palermo" schedulate="14:25:00" expect="14:40:00" state="LANDED" stand="22" gate="" checkin=""><CONVEYOR code="2"/></FLIGHT>
<FLIGHT code="W6" number="1234" aircraftType="A21N" aircraftReg="HA-LYD" flightTypeDescr="Scheduled" city="Budapest" schedulate="15:10:00" expect="" state="SCHEDULED" stand="" gate="B12" checkin="44"></FLIGHT>
</FLIGHTS>`;

async function runArrivalsXmlTest() {
  const { mod, result } = await runStaffMonitor('A', {
    fetchImpl: async url => makeResponse({
      body: arrivalsXml,
      setCookie: 'JSESSIONID=abc123; Path=/; HttpOnly',
    }),
  });

  assert(result.length === 2, 'arrivals XML should yield two parsed flights');

  const [first, second] = result;
  assert(first.flightNumber === 'FR5678', 'XML flight number should be built from code+number attributes');
  assert(first.aircraftType === 'B738', 'XML aircraft type should come from the aircraftType attribute');
  assert(first.trafficType === 'Scheduled', 'XML traffic type should come from flightTypeDescr');
  assert(first.registration === 'EI-FRB', 'XML registration should come from aircraftReg');
  assert(first.route === 'Palermo', 'XML route should come from city');
  assert(first.scheduledTime === '14:25', 'XML scheduled time should be truncated to HH:MM');
  assert(first.estimatedTime === '14:40', 'XML estimated time should be truncated to HH:MM');
  assert(first.status === 'LANDED', 'XML status should come from state');
  assert(first.stand === '22', 'XML stand should come from stand attribute');
  assert(first.gate === undefined, 'empty XML gate attribute should be undefined');
  assert(first.checkin === undefined, 'empty XML checkin attribute should be undefined');
  assert(first.belt === '2', 'belt should be extracted from the nested CONVEYOR code');

  assert(second.flightNumber === 'W61234', 'second XML flight number should combine code W6 + number 1234');
  assert(second.estimatedTime === undefined, 'empty expect attribute should yield undefined estimated time');
  assert(second.stand === undefined, 'empty XML stand attribute should be undefined');
  assert(second.gate === 'B12', 'second XML flight gate should be parsed');
  assert(second.checkin === '44', 'second XML flight checkin should be parsed');
  assert(second.belt === undefined, 'flight without CONVEYOR should have an undefined belt');

  // The raw arrivals XML should be exposed for support/debug purposes, so a user
  // can copy the exact "schedulate"/"expect"/"state" attributes from the device.
  const rawArrivals = mod.getStaffMonitorDebugHtml('A');
  assert(rawArrivals.includes('schedulate="14:25:00"') && rawArrivals.includes('expect="14:40:00"'),
    'getStaffMonitorDebugHtml("A") should expose the raw arrivals XML with the schedulate/expect attributes');
  assert(mod.getStaffMonitorDebugHtml('D') === '', 'getStaffMonitorDebugHtml("D") should be empty when only an arrivals fetch has run');

  return runCacheTests();
}

// ─── Cache fallback behaviour ─────────────────────────────────────────────────
async function runCacheTests() {
  const failingFetch = async () => { throw new Error('mock network failure'); };

  // Fresh cache should be served when every fetch attempt fails.
  const freshCacheStore = {
    sm_flights_v2: JSON.stringify({
      D: { flights: [{ flightNumber: 'FR9999', status: 'CACHED' }], ts: Date.now() },
    }),
  };
  const { mod: cachedMod, result: cachedResult } = await runStaffMonitor('D', {
    fetchImpl: failingFetch,
    store: freshCacheStore,
  });
  assert(cachedResult.length === 1 && cachedResult[0].flightNumber === 'FR9999', 'a fresh cache entry should be served when all network requests fail');
  assert(cachedMod.getStaffMonitorDebugStatus() === 'D:CACHE(1)', 'debug status should report the cache fallback');

  // Stale (>20 minute) cache must not be served.
  const staleCacheStore = {
    sm_flights_v2: JSON.stringify({
      D: { flights: [{ flightNumber: 'FR9999', status: 'CACHED' }], ts: Date.now() - 25 * 60 * 1000 },
    }),
  };
  const { result: staleResult } = await runStaffMonitor('D', {
    fetchImpl: failingFetch,
    store: staleCacheStore,
  });
  assert(staleResult.length === 0, 'a stale (>20min) cache entry should not be served');

  // No cache at all and every fetch fails -> empty array.
  const { result: emptyResult } = await runStaffMonitor('D', {
    fetchImpl: failingFetch,
    store: {},
  });
  assert(emptyResult.length === 0, 'fetchStaffMonitorData should return an empty array with no data and no cache');

  // A successful parse should be written back to the cache for future fallbacks.
  const { asyncStorage: savingStorage } = await runStaffMonitor('D', {
    fetchImpl: async () => makeResponse({ body: departuresHtml }),
    store: {},
  });
  const saved = JSON.parse(savingStorage._store.sm_flights_v2);
  assert(saved.D?.flights?.length === 2, 'a successful parse should be written back to the AsyncStorage cache');

  return runInFlightDedupTest();
}

// ─── Concurrent requests for the same nature should be de-duplicated ─────────
async function runInFlightDedupTest() {
  let fetchCalls = 0;
  const mod = loadTsModule('src/utils/staffMonitor.ts', {
    '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
    __globals: {
      fetch: async () => {
        fetchCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 5));
        return makeResponse({ body: departuresHtml });
      },
    },
  });

  const [first, second] = await Promise.all([
    mod.fetchStaffMonitorData('D'),
    mod.fetchStaffMonitorData('D'),
  ]);
  assert(first.length === 2 && second.length === 2, 'both concurrent calls should resolve with parsed flights');
  assert(fetchCalls === 1, 'concurrent fetchStaffMonitorData calls for the same nature should share a single in-flight request');

  console.log('StaffMonitor parser test passed.');
}

function handleFailure(err) {
  console.error(err);
  process.exit(1);
}
