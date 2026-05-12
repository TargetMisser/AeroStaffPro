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
  };
  vm.runInNewContext(output, sandbox, { filename: absolutePath });
  return module.exports;
}

const adapter = loadTsModule('src/utils/flightScheduleAdapter.ts');

const scheduledOnly = {
  flight: {
    identification: { number: { default: 'HV5426' } },
    airline: { name: 'Transavia' },
    time: { scheduled: { departure: 1000 }, estimated: {}, real: {} },
  },
};
const delayed = {
  flight: {
    identification: { number: { default: 'W45030' } },
    airline: { name: 'Wizz Air Malta' },
    time: { scheduled: { departure: 900 }, estimated: { departure: 1200 }, real: {} },
  },
};
const departed = {
  flight: {
    identification: { number: { default: 'FR1234' } },
    airline: { name: 'Ryanair' },
    time: { scheduled: { departure: 800 }, estimated: { departure: 850 }, real: { departure: 875 } },
  },
};

assert(adapter.getFlightBestTs(scheduledOnly, 'departure') === 1000, 'best time should fall back to scheduled');
assert(adapter.getFlightBestTs(delayed, 'departure') === 1200, 'best time should prefer estimated over scheduled');
assert(adapter.getFlightBestTs(departed, 'departure') === 875, 'best time should prefer real over estimated');
assert(adapter.getFlightStableKey(delayed, 'departure') === 'W45030_900', 'stable key should use flight number and scheduled time');

assert(typeof adapter.getFlightAirportLabel === 'function', 'flight adapter should expose airport label helper');
assert(
  adapter.getFlightAirportLabel({ code: { iata: 'AMS' }, name: 'Amsterdam' }) === 'AMS',
  'airport label should prefer nested IATA code',
);
assert(
  adapter.getFlightAirportLabel({ iata: 'TIA', name: 'Tirana' }) === 'TIA',
  'airport label should support flat IATA code',
);
assert(
  adapter.getFlightAirportLabel({ name: 'Krakow' }) === 'Krakow',
  'airport label should fall back to airport name',
);
assert(
  adapter.getFlightAirportLabel({ code: { iata: '???' }, iata: '', name: 'Lisbon' }) === 'Lisbon',
  'airport label should ignore placeholder airport codes',
);

assert(typeof adapter.isFlightAirlineMatch === 'function', 'flight adapter should expose airline matching helper');
const easyJetEuropeCodeOnly = {
  flight: {
    identification: { number: { default: 'EC4810' } },
    airline: { name: 'Compagnia EC', code: { iata: 'EC', icao: 'EJU' } },
  },
};
const easyJetFlightNumberOnly = {
  flight: {
    identification: { number: { default: 'U24810' } },
    airline: { name: 'Sconosciuta', code: {} },
  },
};
assert(adapter.isFlightAirlineMatch(easyJetEuropeCodeOnly, 'easyjet'), 'easyJet Europe EC/EJU flights should match easyjet filter');
assert(adapter.isFlightAirlineMatch(easyJetFlightNumberOnly, 'easyjet'), 'U2 flight-number prefix should match easyjet filter');
assert(!adapter.isFlightAirlineMatch(delayed, 'easyjet'), 'wizz flight should not match easyjet filter');
assert(
  adapter.filterFlightsByAirlines([easyJetEuropeCodeOnly, easyJetFlightNumberOnly, delayed], ['easyjet']).length === 2,
  'airline filter should keep easyJet variants identified by code or flight number',
);

const airportSettings = loadTsModule('src/utils/airportSettings.ts', {
  '@react-native-async-storage/async-storage': {
    getItem: async () => null,
    setItem: async () => {},
  },
});
const detectedAirlines = airportSettings.extractAirportAirlinesFromSchedule([
  'Compagnia XU',
  'XUE',
  'SI',
  'Q1',
  'KI',
  'JT',
  'Sconosciuta',
  {
    flight: {
      identification: { number: { default: 'U24810' } },
      airline: { name: 'Sconosciuta', code: { iata: 'U2' } },
    },
  },
  {
    flight: {
      identification: { number: { default: 'LH123' } },
      airline: { name: 'Compagnia LH', code: { iata: 'LH', icao: 'DLH' } },
    },
  },
  { flight: { airline: { name: 'Transavia France' } } },
]);
assert(detectedAirlines.includes('easyjet'), 'airport airline discovery should keep easyJet from codes');
assert(detectedAirlines.includes('lufthansa'), 'airport airline discovery should keep real airlines from codes');
assert(detectedAirlines.includes('transavia'), 'airport airline discovery should canonicalize real airline names');
assert(!detectedAirlines.some(key => key.startsWith('compagnia')), 'airport airline discovery should drop generic company placeholders');
assert(!['xue', 'si', 'q1', 'ki', 'jt', 'sconosciuta'].some(key => detectedAirlines.includes(key)), 'airport airline discovery should drop raw unknown airline codes');

const merged = adapter.mergeFlightLists([scheduledOnly], [scheduledOnly, delayed], 'departure');
assert(merged.length === 2, 'merge should dedupe cached and fresh flights');

const liveDuplicateOld = {
  flight: {
    identification: { number: { default: 'HV5426' } },
    airline: { name: 'Transavia' },
    airport: { destination: { code: { iata: 'AMS' }, name: 'Amsterdam' } },
    time: { scheduled: { departure: 2000 }, estimated: {}, real: {} },
  },
};
const liveDuplicateFresh = {
  flight: {
    identification: { number: { default: 'HV5426' } },
    airline: { name: 'Transavia' },
    airport: { destination: { code: { iata: 'AMS' }, name: 'Amsterdam' } },
    time: { scheduled: { departure: 2060 }, estimated: { departure: 2090 }, real: {} },
  },
};
const sameNumberDifferentRoute = {
  flight: {
    identification: { number: { default: 'HV5426' } },
    airline: { name: 'Transavia' },
    airport: { destination: { code: { iata: 'ORY' }, name: 'Paris Orly' } },
    time: { scheduled: { departure: 2060 }, estimated: {}, real: {} },
  },
};
const mergedLiveDuplicates = adapter.mergeFlightLists([liveDuplicateOld], [liveDuplicateFresh], 'departure');
assert(mergedLiveDuplicates.length === 1, 'merge should collapse the same flight when only the live timestamp changed');
assert(
  mergedLiveDuplicates[0].flight.time.estimated.departure === 2090,
  'merge should keep the freshest timing for a collapsed live duplicate',
);
assert(
  adapter.mergeFlightLists([liveDuplicateOld], [sameNumberDifferentRoute], 'departure').length === 2,
  'merge should not collapse the same flight number on a different route',
);

const pruned = adapter.pruneExpiredFlights([scheduledOnly, delayed], 'departure', 5000, 3600);
assert(pruned.length === 0, 'prune should remove flights older than retention using best time');

const sorted = [delayed, scheduledOnly, departed].sort(adapter.compareFlightsChronologically('departure'));
assert(sorted.map(item => item.flight.identification.number.default).join(',') === 'FR1234,W45030,HV5426', 'default sort should use scheduled chronology');

const sortedByBest = [delayed, scheduledOnly, departed].sort(adapter.compareFlightsChronologically('departure', { preferBestTime: true }));
assert(sortedByBest.map(item => item.flight.identification.number.default).join(',') === 'FR1234,HV5426,W45030', 'best-time sort should use real/estimated chronology');

const flightCache = loadTsModule('src/utils/flightScreenCache.ts', {
  '@react-native-async-storage/async-storage': {
    getItem: async () => null,
    setItem: async () => {},
  },
});
const cache = flightCache.sanitizeFlightScreenCache({
  airportCode: 'PSA',
  savedAt: 10_000,
  arrivals: [scheduledOnly],
  departures: [delayed],
  sourceLabel: 'AirLabs',
  fetchedAt: 9_000,
}, 'PSA', 20_000);
assert(cache && cache.arrivals.length === 1 && cache.departures.length === 1, 'flight screen cache should accept matching fresh airport cache');
assert(flightCache.sanitizeFlightScreenCache({ airportCode: 'FCO', savedAt: 10_000 }, 'PSA', 20_000) === null, 'flight screen cache should reject another airport');

function makeProvider(id, label, result, calls) {
  return {
    id,
    label,
    supports: () => true,
    fetch: async () => {
      calls.push(id);
      return result;
    },
  };
}

function makeProviderFlight(flightNumber, departureTs, destination = 'AMS') {
  return {
    flight: {
      identification: { number: { default: flightNumber } },
      airline: { name: 'Transavia' },
      airport: { destination: { code: { iata: destination }, name: destination } },
      time: { scheduled: { departure: departureTs }, estimated: {}, real: {} },
    },
  };
}

async function runProviderLayerTests() {
  const now = new Date(2026, 4, 12, 12, 0, 0);
  const todayTs = Math.floor(new Date(2026, 4, 12, 14, 0, 0).getTime() / 1000);
  const tomorrowTs = Math.floor(new Date(2026, 4, 13, 14, 0, 0).getTime() / 1000);
  const calls = [];
  const providerLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './airLabsProvider': {
      airLabsProvider: makeProvider('airlabs', 'AirLabs', {
        allArrivals: [],
        allDepartures: [makeProviderFlight('HV9002', tomorrowTs)],
      }, calls),
    },
    './staffMonitorProvider': {
      staffMonitorProvider: makeProvider('staffMonitor', 'StaffMonitor PSA', {
        allArrivals: [],
        allDepartures: [makeProviderFlight('HV9001', todayTs)],
      }, calls),
    },
    './fr24Provider': {
      fr24ApiProvider: makeProvider('fr24Api', 'FlightRadar24 API', { allArrivals: [], allDepartures: [] }, calls),
      fr24PublicProvider: makeProvider('fr24Public', 'FlightRadar24 public', { allArrivals: [], allDepartures: [] }, calls),
    },
  });

  const payload = await providerLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    now,
  });

  assert(calls.includes('airlabs') && calls.includes('staffMonitor'), 'provider auto mode should continue past partial AirLabs coverage');
  assert(payload.allDepartures.length === 2, 'provider auto mode should merge today and tomorrow coverage from fallback providers');
  assert(payload.sourceLabel.includes('AirLabs') && payload.sourceLabel.includes('StaffMonitor'), 'provider source label should show merged providers');

  const fullCalls = [];
  const fullProviderLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './airLabsProvider': {
      airLabsProvider: makeProvider('airlabs', 'AirLabs', {
        allArrivals: [],
        allDepartures: [
          makeProviderFlight('HV9101', todayTs),
          makeProviderFlight('HV9102', tomorrowTs),
        ],
      }, fullCalls),
    },
    './staffMonitorProvider': {
      staffMonitorProvider: makeProvider('staffMonitor', 'StaffMonitor PSA', {
        allArrivals: [],
        allDepartures: [makeProviderFlight('HV9103', todayTs)],
      }, fullCalls),
    },
    './fr24Provider': {
      fr24ApiProvider: makeProvider('fr24Api', 'FlightRadar24 API', { allArrivals: [], allDepartures: [] }, fullCalls),
      fr24PublicProvider: makeProvider('fr24Public', 'FlightRadar24 public', { allArrivals: [], allDepartures: [] }, fullCalls),
    },
  });
  await fullProviderLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    now,
  });
  assert(fullCalls.join(',') === 'airlabs', 'provider auto mode should stop once one provider covers today and tomorrow');
}

runProviderLayerTests()
  .then(() => {
    console.log('Flight helper tests passed.');
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
