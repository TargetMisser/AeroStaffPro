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

console.log('Flight helper tests passed.');
