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
    URLSearchParams,
    setTimeout,
    clearTimeout,
    AbortController,
    ...(mocks.__globals ?? {}),
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
assert(
  adapter.getFlightAirportLabel({ name: 'LONDON GATWICK' }) === 'LGW',
  'airport label should canonicalize known airport names to IATA codes',
);
assert(
  adapter.getFlightAirportLabel({ name: 'Amsterdam Schiphol' }) === 'AMS',
  'airport label should canonicalize common airport aliases to IATA codes',
);

const airlineOps = loadTsModule('src/utils/airlineOps.ts');
assert(airlineOps.getAirlineColor('Transavia') === '#00A650', 'Transavia name should use brand green');
assert(airlineOps.getAirlineColor('TRA') === '#00A650', 'Transavia ICAO code should use brand green');
assert(airlineOps.getAirlineColor('HV') === '#00A650', 'Transavia IATA code should use brand green');
assert(airlineOps.getAirlineColor('EZY') === '#FF6600', 'easyJet ICAO code should use brand orange');
assert(airlineOps.getAirlineColor('WMT') === '#C6006E', 'Wizz Air Malta ICAO code should use Wizz brand color');

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

const easyJetArrivalScheduledTs = Math.floor(new Date(2026, 4, 12, 17, 35, 0).getTime() / 1000);
const easyJetArrivalEstimatedTs = Math.floor(new Date(2026, 4, 12, 17, 32, 0).getTime() / 1000);
const fr24ApiArrival = {
  flight: {
    identification: { number: { default: 'U28319' } },
    airline: { name: 'EZY', code: { iata: 'U2', icao: 'EZY' } },
    airport: { origin: { code: { iata: 'LGW' }, name: 'LGW' } },
    time: { scheduled: { arrival: easyJetArrivalEstimatedTs }, estimated: { arrival: easyJetArrivalEstimatedTs }, real: {} },
  },
};
const staffMonitorArrival = {
  flight: {
    identification: { number: { default: 'U28319' } },
    airline: { name: 'easyJet', code: { iata: 'U2' } },
    airport: { origin: { name: 'LONDON GATWICK' } },
    time: { scheduled: { arrival: easyJetArrivalScheduledTs }, estimated: { arrival: easyJetArrivalEstimatedTs }, real: {} },
  },
};
const mergedProviderArrival = adapter.mergeFlightLists([fr24ApiArrival], [staffMonitorArrival], 'arrival');
assert(
  mergedProviderArrival.length === 1,
  'merge should collapse provider duplicates when one source has airport IATA and the other has the matching airport name',
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
  providerDiagnostics: [{ provider: 'airlabs', label: 'AirLabs', status: 'success', tomorrowDepartures: 1 }],
}, 'PSA', 20_000);
assert(cache && cache.arrivals.length === 1 && cache.departures.length === 1, 'flight screen cache should accept matching fresh airport cache');
assert(cache.providerDiagnostics?.[0]?.tomorrowDepartures === 1, 'flight screen cache should preserve provider diagnostics');
assert(flightCache.sanitizeFlightScreenCache({ airportCode: 'FCO', savedAt: 10_000 }, 'PSA', 20_000) === null, 'flight screen cache should reject another airport');

function makeProvider(id, label, result, calls, contexts) {
  return {
    id,
    label,
    supports: () => true,
    fetch: async context => {
      calls.push(id);
      contexts?.push({ id, context });
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

function makeProviderArrival(flightNumber, arrivalTs, origin = 'LGW') {
  return {
    flight: {
      identification: { number: { default: flightNumber } },
      airline: { name: 'easyJet' },
      airport: { origin: { code: { iata: origin }, name: origin } },
      time: { scheduled: { arrival: arrivalTs }, estimated: {}, real: {} },
    },
  };
}

async function runProviderLayerTests() {
  const now = new Date(2026, 4, 12, 12, 0, 0);
  const todayTs = Math.floor(new Date(2026, 4, 12, 14, 0, 0).getTime() / 1000);
  const tomorrowTs = Math.floor(new Date(2026, 4, 13, 14, 0, 0).getTime() / 1000);
  const calls = [];
  const contexts = [];
  const providerLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './aeroDataBoxProvider': {
      aeroDataBoxProvider: makeProvider('aeroDataBox', 'AeroDataBox', {
        allArrivals: [makeProviderArrival('U29202', tomorrowTs)],
        allDepartures: [makeProviderFlight('HV9002', tomorrowTs)],
      }, calls, contexts),
    },
    './airLabsProvider': {
      airLabsProvider: makeProvider('airlabs', 'AirLabs', {
        allArrivals: [],
        allDepartures: [makeProviderFlight('HV9003', tomorrowTs)],
      }, calls, contexts),
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
    aeroDataBoxApiKey: 'adb-key',
    now,
  });

  assert(calls.includes('aeroDataBox') && calls.includes('staffMonitor'), 'provider auto mode should continue to AeroDataBox for future coverage');
  assert(!calls.includes('airlabs'), 'provider auto mode should not spend AirLabs when AeroDataBox covers tomorrow');
  assert(calls.indexOf('fr24Api') < calls.indexOf('staffMonitor'), 'provider auto mode should try configured FR24 API before StaffMonitor');
  assert(calls.indexOf('staffMonitor') < calls.indexOf('aeroDataBox'), 'provider auto mode should try local/live providers before AeroDataBox');
  assert(
    !calls.includes('fr24Public') || calls.indexOf('aeroDataBox') < calls.indexOf('fr24Public'),
    'provider auto mode should prefer configured AeroDataBox before public FR24 fallback',
  );
  assert(payload.allDepartures.length === 2, 'provider auto mode should merge today and tomorrow departures from fallback providers');
  assert(payload.sourceLabel.includes('AeroDataBox') && payload.sourceLabel.includes('StaffMonitor'), 'provider source label should show merged providers');
  const aeroDataBoxContext = contexts.find(item => item.id === 'aeroDataBox')?.context;
  assert(aeroDataBoxContext?.aeroDataBoxMode === 'futureOnly', 'provider auto mode should ask AeroDataBox only for future coverage once today is already covered');
  const aeroDataBoxStatus = payload.diagnostics.find(item => item.provider === 'aeroDataBox');
  assert(aeroDataBoxStatus?.tomorrowDepartures === 1, 'provider diagnostics should count AeroDataBox tomorrow departures');
  assert(aeroDataBoxStatus?.tomorrowArrivals === 1, 'provider diagnostics should count AeroDataBox tomorrow arrivals');
  assert(aeroDataBoxStatus?.todayDepartures === 0, 'provider diagnostics should count AeroDataBox today departures separately');

  const partialTomorrowCalls = [];
  const partialTomorrowLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './aeroDataBoxProvider': {
      aeroDataBoxProvider: makeProvider('aeroDataBox', 'AeroDataBox', {
        allArrivals: [],
        allDepartures: [],
      }, partialTomorrowCalls),
    },
    './airLabsProvider': {
      airLabsProvider: makeProvider('airlabs', 'AirLabs', {
        allArrivals: [
          makeProviderArrival('U29201', todayTs),
          makeProviderArrival('U29202', tomorrowTs),
        ],
        allDepartures: [makeProviderFlight('HV9203', todayTs)],
      }, partialTomorrowCalls),
    },
    './staffMonitorProvider': {
      staffMonitorProvider: makeProvider('staffMonitor', 'StaffMonitor PSA', {
        allArrivals: [],
        allDepartures: [makeProviderFlight('HV9204', tomorrowTs)],
      }, partialTomorrowCalls),
    },
    './fr24Provider': {
      fr24ApiProvider: makeProvider('fr24Api', 'FlightRadar24 API', { allArrivals: [], allDepartures: [] }, partialTomorrowCalls),
      fr24PublicProvider: makeProvider('fr24Public', 'FlightRadar24 public', { allArrivals: [], allDepartures: [] }, partialTomorrowCalls),
    },
  });
  const partialTomorrowPayload = await partialTomorrowLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    now,
  });
  assert(partialTomorrowCalls.includes('staffMonitor'), 'provider auto mode should continue when tomorrow departures are still missing');
  assert(
    partialTomorrowPayload.allDepartures.some(item => item.flight.identification.number.default === 'HV9204'),
    'provider auto mode should merge fallback tomorrow departures',
  );
  const fallbackStatus = partialTomorrowPayload.diagnostics.find(item => item.provider === 'staffMonitor');
  assert(fallbackStatus?.tomorrowDepartures === 1, 'fallback provider diagnostics should expose tomorrow coverage');

  const fullCalls = [];
  const fullProviderLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './aeroDataBoxProvider': {
      aeroDataBoxProvider: makeProvider('aeroDataBox', 'AeroDataBox', {
        allArrivals: [],
        allDepartures: [],
      }, fullCalls),
    },
    './airLabsProvider': {
      airLabsProvider: makeProvider('airlabs', 'AirLabs', {
        allArrivals: [
          makeProviderArrival('U29104', todayTs),
          makeProviderArrival('U29105', tomorrowTs),
        ],
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
  assert(fullCalls.join(',') === 'fr24Api,staffMonitor,aeroDataBox,fr24Public,airlabs', 'provider auto mode should reserve AirLabs until live/local/schedule providers are exhausted');

  const timeoutCalls = [];
  const timeoutPayload = await providerLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    providerTimeoutMs: 1,
    now,
  }, [
    {
      id: 'staffMonitor',
      label: 'Slow provider',
      supports: () => true,
      fetch: async () => {
        timeoutCalls.push('slow');
        return new Promise(() => {});
      },
    },
    makeProvider('fr24Api', 'Fast provider', {
      allArrivals: [makeProviderArrival('U29300', tomorrowTs)],
      allDepartures: [
        makeProviderFlight('HV9300', todayTs),
        makeProviderFlight('HV9301', tomorrowTs),
      ],
    }, timeoutCalls),
  ]);
  assert(timeoutCalls.join(',') === 'slow,fr24Api', 'provider auto mode should continue after a provider timeout');
  assert(timeoutPayload.sourceLabel.includes('Fast provider'), 'provider auto mode should return the next provider after timeout');
  const timeoutStatus = timeoutPayload.diagnostics.find(item => item.provider === 'staffMonitor');
  assert(timeoutStatus?.status === 'failed' && /PROVIDER_TIMEOUT/.test(timeoutStatus.message ?? ''), 'provider diagnostics should expose provider timeouts');

  const aeroStorage = new Map();
  const aeroCalls = [];
  const aeroDataBoxModule = loadTsModule('src/utils/flightProviders/aeroDataBoxProvider.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async key => aeroStorage.get(key) ?? null,
      setItem: async (key, value) => { aeroStorage.set(key, value); },
    },
    __globals: {
      fetch: async (url, options = {}) => {
        const decodedUrl = decodeURIComponent(String(url));
        aeroCalls.push({ url: decodedUrl, headers: options.headers ?? {} });
        const isTomorrowMorning = decodedUrl.includes('/2026-05-13T00:00/2026-05-13T12:00');
        return {
          ok: true,
          text: async () => JSON.stringify(isTomorrowMorning
            ? {
                departures: [{
                  number: 'HV5426',
                  status: 'Expected',
                  codeshareStatus: 'IsOperator',
                  isCargo: false,
                  airline: { name: 'Transavia', iata: 'HV', icao: 'TRA' },
                  aircraft: { reg: 'PH-HXA', model: 'B738' },
                  departure: {
                    airport: { name: 'Pisa Galileo Galilei', iata: 'PSA', icao: 'LIRP' },
                    scheduledTime: { local: '2026-05-13T09:50:00', utc: '2026-05-13T07:50:00Z' },
                    revisedTime: { local: '2026-05-13T09:55:00', utc: '2026-05-13T07:55:00Z' },
                    checkInDesk: '12-14',
                    gate: 'B4',
                    quality: ['Basic', 'Live'],
                  },
                  arrival: {
                    airport: { name: 'Amsterdam Schiphol', iata: 'AMS', icao: 'EHAM' },
                    scheduledTime: { local: '2026-05-13T11:45:00', utc: '2026-05-13T09:45:00Z' },
                    quality: ['Basic'],
                  },
                }],
                arrivals: [{
                  number: 'U28319',
                  status: 'Delayed',
                  codeshareStatus: 'IsOperator',
                  isCargo: false,
                  airline: { name: 'easyJet', iata: 'U2', icao: 'EZY' },
                  departure: {
                    airport: { name: 'London Gatwick', iata: 'LGW', icao: 'EGKK' },
                    scheduledTime: { local: '2026-05-13T08:00:00', utc: '2026-05-13T07:00:00Z' },
                    quality: ['Basic'],
                  },
                  arrival: {
                    airport: { name: 'Pisa Galileo Galilei', iata: 'PSA', icao: 'LIRP' },
                    scheduledTime: { local: '2026-05-13T10:50:00', utc: '2026-05-13T08:50:00Z' },
                    revisedTime: { local: '2026-05-13T11:05:00', utc: '2026-05-13T09:05:00Z' },
                    baggageBelt: '2',
                    quality: ['Basic', 'Live'],
                  },
                }],
              }
            : { departures: [], arrivals: [] }),
        };
      },
    },
  });
  const aeroResult = await aeroDataBoxModule.aeroDataBoxProvider.fetch({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    aeroDataBoxApiKey: 'adb-key',
    aeroDataBoxGateway: 'apiMarket',
    now,
  });
  assert(aeroCalls.length > 0, 'AeroDataBox provider should call the schedule API');
  assert(aeroCalls[0].url.startsWith('https://prod.api.market/api/v1/aedbx/aerodatabox/flights/airports/iata/PSA/'), 'AeroDataBox provider should use the API.Market gateway by default');
  assert(aeroCalls[0].headers['x-magicapi-key'] === 'adb-key', 'AeroDataBox provider should send API.Market key header');
  assert(aeroResult.allDepartures.some(item => item.flight.identification.number.default === 'HV5426'), 'AeroDataBox provider should parse departures');
  assert(aeroResult.allArrivals.some(item => item.flight.identification.number.default === 'U28319'), 'AeroDataBox provider should parse arrivals');
  const parsedDeparture = aeroResult.allDepartures.find(item => item.flight.identification.number.default === 'HV5426');
  assert(parsedDeparture.flight.airport.destination.code.iata === 'AMS', 'AeroDataBox departures should expose destination IATA');
  assert(parsedDeparture.flight.time.estimated.departure > parsedDeparture.flight.time.scheduled.departure, 'AeroDataBox revised time should become estimated time');
  assert(parsedDeparture.flight._operational.departureGate === 'B4', 'AeroDataBox provider should expose departure gate');
  const aeroFirstCallCount = aeroCalls.length;
  await aeroDataBoxModule.aeroDataBoxProvider.fetch({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    aeroDataBoxApiKey: 'adb-key',
    aeroDataBoxGateway: 'apiMarket',
    now,
  });
  assert(aeroCalls.length === aeroFirstCallCount, 'AeroDataBox provider should cache identical schedule windows');

  const futureOnlyStorage = new Map();
  const futureOnlyCalls = [];
  const futureOnlyModule = loadTsModule('src/utils/flightProviders/aeroDataBoxProvider.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async key => futureOnlyStorage.get(key) ?? null,
      setItem: async (key, value) => { futureOnlyStorage.set(key, value); },
    },
    __globals: {
      fetch: async (url, options = {}) => {
        const decodedUrl = decodeURIComponent(String(url));
        futureOnlyCalls.push({ url: decodedUrl, headers: options.headers ?? {} });
        return {
          ok: true,
          text: async () => JSON.stringify({ departures: [], arrivals: [] }),
        };
      },
    },
  });
  await futureOnlyModule.aeroDataBoxProvider.fetch({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    aeroDataBoxApiKey: 'future-key',
    aeroDataBoxGateway: 'apiMarket',
    aeroDataBoxMode: 'futureOnly',
    now,
  });
  assert(futureOnlyCalls.length === 2, 'AeroDataBox future-only mode should fetch only tomorrow schedule windows');
  assert(
    futureOnlyCalls.every(call => call.url.includes('/2026-05-13T')),
    'AeroDataBox future-only mode should skip today schedule windows',
  );

  const memoryStorage = new Map();
  const airLabsCalls = [];
  const airLabsModule = loadTsModule('src/utils/flightProviders/airLabsProvider.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async key => memoryStorage.get(key) ?? null,
      setItem: async (key, value) => { memoryStorage.set(key, value); },
    },
    __globals: {
      fetch: async url => {
        airLabsCalls.push(String(url));
        const isRoutes = String(url).includes('/routes');
        return {
          ok: true,
          text: async () => JSON.stringify({
            response: isRoutes
              ? [{
                  airline_iata: 'HV',
                  flight_iata: 'HV9999',
                  dep_iata: 'PSA',
                  dep_time: '10:00',
                  arr_iata: 'AMS',
                  arr_time: '12:00',
                  days: 'tue,wed,thu',
                }]
              : [],
          }),
        };
      },
    },
  });
  const airLabsResult = await airLabsModule.airLabsProvider.fetch({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    airLabsApiKey: 'test-key',
    now,
  });
  assert(airLabsCalls.some(url => url.includes('/routes')), 'AirLabs provider should query routes for tomorrow coverage');
  assert(
    airLabsResult.allDepartures.some(item => item.flight.identification.number.default === 'HV9999'),
    'AirLabs routes should accept comma-separated day strings for tomorrow departures',
  );

  airLabsCalls.length = 0;
  await airLabsModule.airLabsProvider.fetch({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    airLabsApiKey: 'test-key',
    airLabsMode: 'routesOnly',
    now,
  });
  assert(!airLabsCalls.some(url => url.includes('/schedules')), 'AirLabs routes-only mode should skip live schedules calls');
  const firstRoutesOnlyCallCount = airLabsCalls.length;
  await airLabsModule.airLabsProvider.fetch({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    airLabsApiKey: 'test-key',
    airLabsMode: 'routesOnly',
    now,
  });
  assert(airLabsCalls.length === firstRoutesOnlyCallCount, 'AirLabs routes-only mode should cache routes after the first routes-only call');
}

runProviderLayerTests()
  .then(() => {
    console.log('Flight helper tests passed.');
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
