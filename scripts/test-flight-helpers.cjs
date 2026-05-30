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
assert(typeof adapter.getFlightAirportDisplay === 'function', 'flight adapter should expose airport display helper');
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
const gatwickDisplay = adapter.getFlightAirportDisplay({ code: { iata: 'LGW' }, name: 'LGW' });
assert(gatwickDisplay.code === 'LGW', 'airport display should expose the IATA code');
assert(gatwickDisplay.name === 'London Gatwick', 'airport display should decode known IATA codes to readable names');
assert(gatwickDisplay.label === 'LGW · London Gatwick', 'airport display should combine code and readable name');
const amsterdamDisplay = adapter.getFlightAirportDisplay({ code: { iata: 'AMS' }, name: 'Amsterdam' });
assert(amsterdamDisplay.name === 'Amsterdam Schiphol', 'airport display should prefer the curated full airport name when a code is known');
const orlyDisplay = adapter.getFlightAirportDisplay({ name: 'PARIS ORLY' });
assert(orlyDisplay.code === 'ORY' && orlyDisplay.name === 'Paris Orly', 'airport display should decode known airport-name aliases');

const airlineOps = loadTsModule('src/utils/airlineOps.ts');
assert(airlineOps.getAirlineColor('Transavia') === '#00A650', 'Transavia name should use brand green');
assert(airlineOps.getAirlineColor('TRA') === '#00A650', 'Transavia ICAO code should use brand green');
assert(airlineOps.getAirlineColor('HV') === '#00A650', 'Transavia IATA code should use brand green');
assert(airlineOps.getAirlineColor('EZY') === '#FF6600', 'easyJet ICAO code should use brand orange');
assert(airlineOps.getAirlineColor('EC') === '#FF6600', 'easyJet Europe EC code should use easyJet brand orange');
assert(airlineOps.getAirlineDisplayName('Compagnia EC') === 'easyJet', 'generic EC airline labels should display as easyJet');
assert(airlineOps.getAirlineColor('WMT') === '#C6006E', 'Wizz Air Malta ICAO code should use Wizz brand color');
assert(typeof airlineOps.getDepartureGateWindow === 'function', 'airline ops should expose a gate window helper');
const gateWindowDepartureTs = Math.floor(new Date(2026, 4, 15, 21, 30, 0).getTime() / 1000);
const defaultGateWindow = airlineOps.getDepartureGateWindow(gateWindowDepartureTs, airlineOps.getAirlineOps('Ryanair'));
assert(
  defaultGateWindow.openTs === gateWindowDepartureTs - 30 * 60 && defaultGateWindow.closeTs === gateWindowDepartureTs - 20 * 60,
  'gate window should use airline defaults without inbound data',
);
const inboundInsideGateWindow = airlineOps.getDepartureGateWindow(
  gateWindowDepartureTs,
  airlineOps.getAirlineOps('Ryanair'),
  gateWindowDepartureTs - 25 * 60,
);
assert(
  inboundInsideGateWindow.openTs === gateWindowDepartureTs - 25 * 60,
  'gate window should use inbound arrival when it falls before gate close',
);
const inboundAfterGateCloseWindow = airlineOps.getDepartureGateWindow(
  gateWindowDepartureTs,
  airlineOps.getAirlineOps('Ryanair'),
  gateWindowDepartureTs + 78 * 60,
);
assert(
  inboundAfterGateCloseWindow.openTs < inboundAfterGateCloseWindow.closeTs,
  'gate window should never display an inverted interval when inbound data is after gate close',
);
assert(
  inboundAfterGateCloseWindow.openTs === defaultGateWindow.openTs,
  'gate window should ignore impossible inbound arrivals after gate close',
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

const flightExternalLinks = loadTsModule('src/utils/flightExternalLinks.ts');
assert(
  flightExternalLinks.buildFlightradar24FlightUrl('U20345') === 'https://www.flightradar24.com/data/flights/u20345',
  'FR24 link builder should preserve leading zeros in published flight numbers',
);
assert(
  flightExternalLinks.buildFlightradar24FlightUrl(' FR-0123 ') === 'https://www.flightradar24.com/data/flights/fr0123',
  'FR24 link builder should normalize separators without stripping digits',
);
assert(flightExternalLinks.buildFlightradar24FlightUrl('N/A') === null, 'FR24 link builder should reject placeholder flight numbers');

const airlineBranding = loadTsModule('src/utils/airlineBranding.ts', {
  './airlineOps': airlineOps,
});
assert(airlineBranding.getAirlineBrandColor('easyjet', 'easyJet') === '#FF6600', 'airline branding should reuse known airline colors');
assert(airlineBranding.getAirlineIataCode('transavia', 'Transavia France') === 'TO', 'airline branding should expose known IATA codes');
assert(airlineBranding.getAirlineMonogram('Smart Aviation') === 'SA', 'airline branding should build readable fallback monograms');
assert(airlineBranding.prettifyAirlineLabel('air dolomiti') === 'Air Dolomiti', 'airline branding should prettify stored keys');
assert(airlineBranding.hexToRgba('#0f0', 0.5) === 'rgba(0,255,0,0.5)', 'airline branding should support short hex rgba conversion');
assert(airlineBranding.mixHexColor('#000000', '#ffffff', 0.5) === '#808080', 'airline branding should mix hex colors deterministically');

const flightNotificationSettings = loadTsModule('src/utils/flightNotificationSettings.ts', {
  './flightScheduleAdapter': adapter,
});
const sanitizedNotifSettings = flightNotificationSettings.sanitizeNotificationSettings({
  onlyTrackedAirlines: true,
  includeArrivals: false,
  includeDepartures: false,
  includeShiftEnd: false,
  sticky: true,
  arrivalLeadMinutes: -10,
  departureLeadMinutes: 999,
});
assert(
  flightNotificationSettings.sanitizeNotificationSettings({}).includeDepartures === false,
  'notification settings should keep the existing default of departure alerts disabled',
);
assert(sanitizedNotifSettings.arrivalLeadMinutes === 1, 'notification settings should clamp low lead minutes');
assert(sanitizedNotifSettings.departureLeadMinutes === 90, 'notification settings should clamp high lead minutes');
assert(
  flightNotificationSettings.shouldNotifyAirline(easyJetFlightNumberOnly, sanitizedNotifSettings, ['easyjet']),
  'notification settings should keep tracked airline matches',
);
assert(
  !flightNotificationSettings.shouldNotifyAirline(easyJetFlightNumberOnly, sanitizedNotifSettings, ['wizz']),
  'notification settings should reject non-matching tracked airlines',
);
assert(flightNotificationSettings.sameAirlineKeys(['easyjet', 'wizz'], ['easyjet', 'wizz']), 'airline key comparison should accept identical order');
assert(!flightNotificationSettings.sameAirlineKeys(['wizz', 'easyjet'], ['easyjet', 'wizz']), 'airline key comparison should remain order-sensitive');

const easyjetOverlapMode = loadTsModule('src/utils/easyjetOverlapMode.ts', {
  './flightScheduleAdapter': adapter,
});

const todayNoon = new Date();
todayNoon.setHours(12, 0, 0, 0);
const todayNoonTs = Math.floor(todayNoon.getTime() / 1000);

const flightA = {
  flight: {
    identification: { number: { default: 'U24810' } },
    airline: { name: 'easyJet', code: { iata: 'U2' } },
    time: { scheduled: { arrival: todayNoonTs }, estimated: {}, real: {} },
  },
};

const flightB = {
  flight: {
    identification: { number: { default: 'U24812' } },
    airline: { name: 'easyJet', code: { iata: 'U2' } },
    time: { scheduled: { arrival: todayNoonTs + 1800 }, estimated: {}, real: {} },
  },
};

const flightC = {
  flight: {
    identification: { number: { default: 'W61234' } },
    airline: { name: 'Wizz Air', code: { iata: 'W6' } },
    time: { scheduled: { arrival: todayNoonTs + 600 }, estimated: {}, real: {} },
  },
};

const result = easyjetOverlapMode.checkEasyJetOverlap([flightA, flightB, flightC]);
assert(result.isActive === true, 'overlap mode should be active when two easyJet flights overlap');
assert(result.overlappingFlights.length === 2, 'should identify the overlapping easyJet flights');

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

const easyJetVariantDepartureTs = Math.floor(new Date(2026, 4, 14, 15, 15, 0).getTime() / 1000);
const fr24ApiEasyJetDeparture = {
  flight: {
    identification: { number: { default: 'U24924' } },
    airline: { name: 'easyJet', code: { iata: 'U2', icao: 'EZY' } },
    airport: { destination: { code: { iata: 'ORY' }, name: 'ORY' } },
    time: { scheduled: { departure: easyJetVariantDepartureTs }, estimated: { departure: easyJetVariantDepartureTs }, real: {} },
  },
};
const providerEasyJetEuropeDeparture = {
  flight: {
    identification: { number: { default: 'EC4924' } },
    airline: { name: 'Compagnia EC', code: { iata: 'EC', icao: 'EJU' } },
    airport: { destination: { code: { iata: 'ORY' }, name: 'Paris Orly' } },
    time: { scheduled: { departure: easyJetVariantDepartureTs }, estimated: {}, real: {} },
  },
};
const mergedEasyJetCodeVariants = adapter.mergeFlightLists([fr24ApiEasyJetDeparture], [providerEasyJetEuropeDeparture], 'departure');
assert(
  mergedEasyJetCodeVariants.length === 1,
  'merge should collapse easyJet U2 and EC code variants for the same service',
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

const flightLoadingState = loadTsModule('src/utils/flightLoadingState.ts');
assert(
  flightLoadingState.shouldShowBlockingFlightLoader({ isLoading: true, hasVisibleFlights: false }),
  'flight screen should show the full loader during initial load with no visible flights',
);
assert(
  !flightLoadingState.shouldShowBlockingFlightLoader({ isLoading: true, hasVisibleFlights: true }),
  'flight screen should keep cached flights visible while a refresh is in progress',
);
assert(
  flightLoadingState.shouldShowFlightRefreshIndicator({ isLoading: true, isRefreshing: false, hasVisibleFlights: true }),
  'flight screen should show a compact refresh indicator during automatic background loading',
);
assert(
  flightLoadingState.shouldShowFlightRefreshIndicator({ isLoading: false, isRefreshing: true, hasVisibleFlights: true }),
  'flight screen should show a compact refresh indicator during manual refresh with visible flights',
);
assert(
  !flightLoadingState.shouldShowFlightRefreshIndicator({ isLoading: true, isRefreshing: true, hasVisibleFlights: false }),
  'flight screen should not show the compact refresh indicator when the blocking loader is needed',
);

const flightSourceLabel = loadTsModule('src/utils/flightSourceLabel.ts');
assert(
  flightSourceLabel.formatFlightSourceLabel('FlightRadar24 API + StaffMonitor PSA + AeroDataBox + Cache giornaliera') === 'FR24 API + StaffMonitor + AeroDataBox + Cache',
  'flight source label should be compact enough for the flights header badge',
);
assert(
  flightSourceLabel.formatFlightSourceLabel('FlightRadar24 API + FlightRadar24 API + Cache giornaliera') === 'FR24 API + Cache',
  'flight source label should dedupe repeated compact providers',
);
const flightDiagnostics = loadTsModule('src/utils/flightDiagnostics.ts');
const formattedFutureOnlyProvider = flightDiagnostics.formatProviderDiagnostic({
  provider: 'aeroDataBox',
  label: 'AeroDataBox',
  status: 'success',
  mode: 'futureOnly',
  contributed: true,
  todayArrivals: 0,
  todayDepartures: 0,
  tomorrowArrivals: 1,
  tomorrowDepartures: 2,
});
assert(
  formattedFutureOnlyProvider.includes('futureOnly') && formattedFutureOnlyProvider.includes('usato'),
  'flight diagnostics should include provider mode and contribution state',
);
assert(
  flightDiagnostics.getTomorrowEmptyReason({
    rawDayCount: 2,
    activeTab: 'departures',
    diagnostics: [],
  }) === 'filtered',
  'tomorrow empty reason should detect flights hidden by airline filters',
);
assert(
  flightDiagnostics.getTomorrowEmptyReason({
    rawDayCount: 0,
    activeTab: 'departures',
    diagnostics: [{ provider: 'airlabs', label: 'AirLabs', status: 'skipped', message: 'AirLabs API key non configurata' }],
  }) === 'provider_skipped',
  'tomorrow empty reason should detect skipped future providers',
);
assert(
  flightDiagnostics.getTomorrowEmptyReason({
    rawDayCount: 0,
    activeTab: 'departures',
    diagnostics: [{ provider: 'aeroDataBox', label: 'AeroDataBox', status: 'success', tomorrowDepartures: 0 }],
  }) === 'provider_empty',
  'tomorrow empty reason should detect providers that returned no future flights',
);
assert(
  flightDiagnostics.getTomorrowEmptyReason({
    rawDayCount: 0,
    activeTab: 'departures',
    diagnostics: [{ provider: 'aeroDataBox', label: 'AeroDataBox', status: 'failed', message: 'quota' }],
  }) === 'provider_failed',
  'tomorrow empty reason should detect failed providers',
);

const calendarStatsRange = loadTsModule('src/utils/calendarStatsRange.ts');
assert(
  calendarStatsRange.getCalendarStatsRange('2026-05-12').key === calendarStatsRange.getCalendarStatsRange('2026-05-17').key,
  'calendar stats refresh key should stay stable while moving inside the same week',
);
assert(
  calendarStatsRange.getCalendarStatsRange('2026-05-12').key !== calendarStatsRange.getCalendarStatsRange('2026-05-18').key,
  'calendar stats refresh key should change only when moving to another week',
);

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

const calendarFlightStats = loadTsModule('src/utils/calendarFlightStats.ts');
const calendarShiftStart = Math.floor(new Date(2026, 4, 12, 14, 0, 0).getTime() / 1000);
const calendarShiftEnd = Math.floor(new Date(2026, 4, 12, 18, 0, 0).getTime() / 1000);
const calendarCounts = calendarFlightStats.buildCalendarFlightCountsFromCache(
  {
    '2026-05-12': [{
      title: 'Lavoro',
      startDate: new Date(calendarShiftStart * 1000).toISOString(),
      endDate: new Date(calendarShiftEnd * 1000).toISOString(),
    }],
    '2026-05-13': [{ title: 'Riposo', startDate: '2026-05-13T00:00:00.000Z', endDate: '2026-05-13T23:59:59.000Z' }],
  },
  [
    makeProviderFlight('HV1001', calendarShiftStart + 900),
    makeProviderFlight('HV1002', calendarShiftEnd + 3600),
  ],
  [makeProviderArrival('U21001', calendarShiftStart + 1800)],
);
assert(calendarCounts['2026-05-12'] === 2, 'calendar flight stats should count cached arrivals and departures inside the work shift');
assert(!Object.prototype.hasOwnProperty.call(calendarCounts, '2026-05-13'), 'calendar flight stats should ignore rest days without work shifts');

function makeFr24LiveProviderFlight(flightNumber, departureTs, destination = 'AMS') {
  const item = makeProviderFlight(flightNumber, departureTs, destination);
  item.flight._source = 'fr24_api';
  return item;
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
  const fr24Status = payload.diagnostics.find(item => item.provider === 'fr24Api');
  assert(fr24Status?.contributed === false, 'empty successful providers should be marked as not contributed');
  const staffStatus = payload.diagnostics.find(item => item.provider === 'staffMonitor');
  assert(staffStatus?.contributed === true, 'providers that add useful flights should be marked as contributed');
  const aeroDataBoxStatus = payload.diagnostics.find(item => item.provider === 'aeroDataBox');
  assert(aeroDataBoxStatus?.mode === 'futureOnly', 'provider diagnostics should expose future-only mode');
  assert(aeroDataBoxStatus?.contributed === true, 'future provider diagnostics should expose contribution state');
  assert(aeroDataBoxStatus?.tomorrowDepartures === 1, 'provider diagnostics should count AeroDataBox tomorrow departures');
  assert(aeroDataBoxStatus?.tomorrowArrivals === 1, 'provider diagnostics should count AeroDataBox tomorrow arrivals');
  assert(aeroDataBoxStatus?.todayDepartures === 0, 'provider diagnostics should count AeroDataBox today departures separately');

  const thinTodayCalls = [];
  const thinTodayContexts = [];
  const thinTodayLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './aeroDataBoxProvider': {
      aeroDataBoxProvider: {
        id: 'aeroDataBox',
        label: 'AeroDataBox',
        supports: () => true,
        fetch: async context => {
          thinTodayCalls.push('aeroDataBox');
          thinTodayContexts.push(context);
          if (context.aeroDataBoxMode === 'futureOnly') {
            return {
              allArrivals: [makeProviderArrival('U29910', tomorrowTs)],
              allDepartures: [makeProviderFlight('HV9910', tomorrowTs)],
            };
          }
          return {
            allArrivals: [
              makeProviderArrival('U29901', todayTs),
              makeProviderArrival('U29902', todayTs + 900),
              makeProviderArrival('U29910', tomorrowTs),
            ],
            allDepartures: [
              makeProviderFlight('HV9901', todayTs),
              makeProviderFlight('HV9902', todayTs + 900),
              makeProviderFlight('HV9910', tomorrowTs),
            ],
          };
        },
      },
    },
    './airLabsProvider': {
      airLabsProvider: makeProvider('airlabs', 'AirLabs', { allArrivals: [], allDepartures: [] }, thinTodayCalls),
    },
    './staffMonitorProvider': {
      staffMonitorProvider: makeProvider('staffMonitor', 'StaffMonitor PSA', { allArrivals: [], allDepartures: [] }, thinTodayCalls),
    },
    './fr24Provider': {
      fr24ApiProvider: makeProvider('fr24Api', 'FlightRadar24 API', {
        allArrivals: [],
        allDepartures: [
          makeFr24LiveProviderFlight('FRLIVE1', todayTs, 'STN'),
          makeFr24LiveProviderFlight('FRLIVE2', todayTs + 600, 'LGW'),
          makeFr24LiveProviderFlight('FRLIVE3', todayTs + 1200, 'LTN'),
        ],
      }, thinTodayCalls),
      fr24PublicProvider: makeProvider('fr24Public', 'FlightRadar24 public', { allArrivals: [], allDepartures: [] }, thinTodayCalls),
    },
  });
  const thinTodayPayload = await thinTodayLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    aeroDataBoxApiKey: 'adb-key',
    fr24ApiKey: 'fr24-key',
    now,
  });
  assert(thinTodayContexts[0]?.aeroDataBoxMode !== 'futureOnly', 'provider auto mode should not treat three live flights as complete today coverage');
  assert(thinTodayPayload.allDepartures.length >= 5, 'provider auto mode should merge today schedule data when FR24 API only returns thin live coverage');
  assert(
    thinTodayPayload.allArrivals.some(item => item.flight.identification.number.default === 'U29901'),
    'provider auto mode should keep today arrivals from schedule fallback after thin FR24 live coverage',
  );

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
  const fullContexts = [];
  const fullProviderLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './aeroDataBoxProvider': {
      aeroDataBoxProvider: makeProvider('aeroDataBox', 'AeroDataBox', {
        allArrivals: [],
        allDepartures: [],
      }, fullCalls, fullContexts),
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
      }, fullCalls, fullContexts),
    },
    './staffMonitorProvider': {
      staffMonitorProvider: makeProvider('staffMonitor', 'StaffMonitor PSA', {
        allArrivals: [],
        allDepartures: [makeProviderFlight('HV9103', todayTs)],
      }, fullCalls, fullContexts),
    },
    './fr24Provider': {
      fr24ApiProvider: makeProvider('fr24Api', 'FlightRadar24 API', { allArrivals: [], allDepartures: [] }, fullCalls, fullContexts),
      fr24PublicProvider: makeProvider('fr24Public', 'FlightRadar24 public', { allArrivals: [], allDepartures: [] }, fullCalls, fullContexts),
    },
  });
  const fullPayload = await fullProviderLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    now,
  });
  assert(fullCalls.join(',') === 'fr24Api,staffMonitor,aeroDataBox,fr24Public,airlabs', 'provider auto mode should reserve AirLabs until live/local/schedule providers are exhausted');
  const airLabsContext = fullContexts.find(item => item.id === 'airlabs')?.context;
  assert(airLabsContext?.airLabsMode === 'routesOnly', 'provider auto mode should switch AirLabs to routes-only after today is covered');
  const airLabsStatus = fullPayload.diagnostics.find(item => item.provider === 'airlabs');
  assert(airLabsStatus?.mode === 'routesOnly', 'provider diagnostics should expose AirLabs routes-only mode');

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
  assert(timeoutStatus?.errorCode === 'provider_timeout', 'provider diagnostics should expose normalized timeout error codes');

  const cooldownCalls = [];
  const cooldownLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './aeroDataBoxProvider': {
      aeroDataBoxProvider: makeProvider('aeroDataBox', 'AeroDataBox', { allArrivals: [], allDepartures: [] }, cooldownCalls),
    },
    './airLabsProvider': {
      airLabsProvider: {
        id: 'airlabs',
        label: 'AirLabs',
        supports: () => true,
        fetch: async () => {
          cooldownCalls.push('airlabs');
          throw new Error('AIRLABS_HTTP_429_RATE_LIMIT');
        },
      },
    },
    './staffMonitorProvider': {
      staffMonitorProvider: makeProvider('staffMonitor', 'StaffMonitor PSA', {
        allArrivals: [makeProviderArrival('U29320', tomorrowTs)],
        allDepartures: [makeProviderFlight('HV9320', tomorrowTs)],
      }, cooldownCalls),
    },
    './fr24Provider': {
      fr24ApiProvider: makeProvider('fr24Api', 'FlightRadar24 API', { allArrivals: [], allDepartures: [] }, cooldownCalls),
      fr24PublicProvider: makeProvider('fr24Public', 'FlightRadar24 public', { allArrivals: [], allDepartures: [] }, cooldownCalls),
    },
  });
  const cooldownContext = {
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    airLabsApiKey: 'airlabs-key',
    now,
  };
  const firstCooldownPayload = await cooldownLayer.fetchFlightScheduleFromProviders(cooldownContext, [
    cooldownLayer.getFlightScheduleProviders('airlabs')[0],
    cooldownLayer.getFlightScheduleProviders('staffMonitor')[0],
  ]);
  const firstCooldownStatus = firstCooldownPayload.diagnostics.find(item => item.provider === 'airlabs');
  assert(firstCooldownStatus?.status === 'failed', 'rate-limited provider should fail before cooldown is active');
  assert(firstCooldownStatus?.errorCode === 'quota_or_limit', 'HTTP 429 should be normalized as quota_or_limit');
  assert(typeof firstCooldownStatus?.cooldownUntil === 'number', 'rate-limited provider failure should expose cooldownUntil');

  const secondCooldownPayload = await cooldownLayer.fetchFlightScheduleFromProviders({
    ...cooldownContext,
    now: new Date(now.getTime() + 60_000),
  }, [
    cooldownLayer.getFlightScheduleProviders('airlabs')[0],
    cooldownLayer.getFlightScheduleProviders('staffMonitor')[0],
  ]);
  assert(cooldownCalls.join(',') === 'airlabs,staffMonitor,staffMonitor', 'provider cooldown should skip the failed provider without calling it again');
  const skippedCooldownStatus = secondCooldownPayload.diagnostics.find(item => item.provider === 'airlabs');
  assert(skippedCooldownStatus?.status === 'skipped', 'cooldown provider should be reported as skipped');
  assert(skippedCooldownStatus?.errorCode === 'provider_cooldown', 'cooldown skip should expose provider_cooldown diagnostics');
  assert(/cooldown/i.test(skippedCooldownStatus?.message ?? ''), 'cooldown skip should explain why the provider was skipped');

  const authCalls = [];
  const authPayload = await providerLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    fr24ApiKey: 'fr24-key',
    now,
  }, [
    {
      id: 'fr24Api',
      label: 'FlightRadar24 API',
      supports: () => true,
      fetch: async () => {
        authCalls.push('fr24Api');
        throw new Error('FR24_API_DEPARTURES_HTTP_401');
      },
    },
    makeProvider('staffMonitor', 'StaffMonitor PSA', {
      allArrivals: [makeProviderArrival('U29321', tomorrowTs)],
      allDepartures: [makeProviderFlight('HV9321', tomorrowTs)],
    }, authCalls),
  ]);
  const authStatus = authPayload.diagnostics.find(item => item.provider === 'fr24Api');
  assert(authStatus?.errorCode === 'auth_failed', 'HTTP 401 should be normalized as auth_failed');
  const robustThinCalls = [];
  const robustThinLayer = loadTsModule('src/utils/flightProviders/index.ts', {
    './aeroDataBoxProvider': {
      aeroDataBoxProvider: makeProvider('aeroDataBox', 'AeroDataBox', {
        allArrivals: [makeProviderArrival('U29920', tomorrowTs)],
        allDepartures: [makeProviderFlight('HV9920', tomorrowTs)],
      }, robustThinCalls),
    },
    './airLabsProvider': {
      airLabsProvider: makeProvider('airlabs', 'AirLabs', { allArrivals: [], allDepartures: [] }, robustThinCalls),
    },
    './staffMonitorProvider': {
      staffMonitorProvider: makeProvider('staffMonitor', 'StaffMonitor PSA', { allArrivals: [], allDepartures: [] }, robustThinCalls),
    },
    './fr24Provider': {
      fr24ApiProvider: makeProvider('fr24Api', 'FlightRadar24 API', {
        allArrivals: [makeFr24LiveProviderFlight('FRLIVE_ARR_TOMORROW', tomorrowTs, 'PSA')],
        allDepartures: [makeFr24LiveProviderFlight('FRLIVE_DEP_TOMORROW', tomorrowTs, 'LGW')],
      }, robustThinCalls),
      fr24PublicProvider: makeProvider('fr24Public', 'FlightRadar24 public', { allArrivals: [], allDepartures: [] }, robustThinCalls),
    },
  });
  const robustThinPayload = await robustThinLayer.fetchFlightScheduleFromProviders({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    aeroDataBoxApiKey: 'adb-key',
    fr24ApiKey: 'fr24-key',
    now,
  });
  assert(robustThinCalls.includes('aeroDataBox'), 'provider auto mode should continue to AeroDataBox if FR24 API only returned thin live tomorrow data without schedule backing');
  assert(
    robustThinPayload.allDepartures.some(item => item.flight.identification.number.default === 'HV9920'),
    'provider auto mode should merge tomorrow schedule data from AeroDataBox after thin FR24 tomorrow live data'
  );

  const dailyCacheStorage = new Map();
  const fixedNowMs = now.getTime();
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      return args.length > 0 ? new RealDate(...args) : new RealDate(fixedNowMs);
    }

    static now() {
      return fixedNowMs;
    }

    static parse(value) {
      return RealDate.parse(value);
    }

    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  }
  const staleSavedAt = fixedNowMs - (4 * 60 * 60 * 1000);
  dailyCacheStorage.set('aerostaff_schedule_provider_cache_v1', JSON.stringify({
    PSA: {
      airportCode: 'PSA',
      allArrivals: [],
      allDepartures: [
        makeProviderFlight('HV9050', todayTs + (4 * 60 * 60), 'AMS'),
        makeProviderFlight('FR0001', todayTs - (4 * 60 * 60), 'STN'),
      ],
      source: 'aeroDataBox',
      sourceLabel: 'AeroDataBox',
      providerDiagnostics: [],
      fetchedAt: staleSavedAt,
      savedAt: staleSavedAt,
    },
  }));
  const fr24ApiFacade = loadTsModule('src/utils/fr24api.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async key => dailyCacheStorage.get(key) ?? null,
      setItem: async (key, value) => dailyCacheStorage.set(key, value),
    },
    './airportSettings': {
      getAirportAirlines: () => [],
      getAirportInfo: code => ({ code, name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false }),
      getStoredAirportCode: async () => 'PSA',
      isValidAirportCode: code => code === 'PSA',
      normalizeAirportCode: code => String(code ?? 'PSA').toUpperCase(),
      storeDetectedAirportAirlines: async () => {},
    },
    './flightProviderSettings': {
      getAeroDataBoxApiKey: async () => null,
      getAeroDataBoxGateway: async () => 'apiMarket',
      getAirLabsApiKey: async () => null,
      getFlightProviderPreference: async () => 'auto',
      getFr24ApiKey: async () => null,
    },
    './flightProviders': {
      fetchFlightScheduleFromProviders: async () => ({
        allArrivals: [],
        allDepartures: [makeFr24LiveProviderFlight('U24000', todayTs + (2 * 60 * 60), 'ORY')],
        source: 'fr24Api',
        sourceLabel: 'FlightRadar24 API',
        fetchedAt: fixedNowMs,
        diagnostics: [],
      }),
      getFlightScheduleProviders: () => [],
    },
    __globals: {
      Date: FixedDate,
    },
  });
  const dailyCachedSchedule = await fr24ApiFacade.fetchAirportScheduleRaw('PSA');
  const dailyCachedFlightNumbers = dailyCachedSchedule.allDepartures
    .map(item => item.flight.identification.number.default)
    .sort()
    .join(',');
  assert(
    dailyCachedFlightNumbers.includes('HV9050') && dailyCachedFlightNumbers.includes('U24000'),
    'schedule fetch should seed thin fresh provider results with the cached day list',
  );
  assert(
    !dailyCachedFlightNumbers.includes('FR0001'),
    'schedule fetch should prune expired cached flights while keeping the active day list',
  );
  const dailyCacheStatus = dailyCachedSchedule.providerDiagnostics.find(item => item.provider === 'cache');
  assert(dailyCacheStatus?.mode === 'dailyMerge', 'daily cache diagnostics should identify merge mode');
  assert(dailyCacheStatus?.cacheMerged === true, 'daily cache diagnostics should mark merged cache contribution');

  const fallbackStorage = new Map(dailyCacheStorage);
  const fallbackFacade = loadTsModule('src/utils/fr24api.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async key => fallbackStorage.get(key) ?? null,
      setItem: async (key, value) => fallbackStorage.set(key, value),
    },
    './airportSettings': {
      getAirportAirlines: () => [],
      getAirportInfo: code => ({ code, name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false }),
      getStoredAirportCode: async () => 'PSA',
      isValidAirportCode: code => code === 'PSA',
      normalizeAirportCode: code => String(code ?? 'PSA').toUpperCase(),
      storeDetectedAirportAirlines: async () => {},
    },
    './flightProviderSettings': {
      getAeroDataBoxApiKey: async () => null,
      getAeroDataBoxGateway: async () => 'apiMarket',
      getAirLabsApiKey: async () => null,
      getFlightProviderPreference: async () => 'auto',
      getFr24ApiKey: async () => null,
    },
    './flightProviders': {
      fetchFlightScheduleFromProviders: async () => {
        throw new Error('NO_FLIGHT_PROVIDER_AVAILABLE test outage');
      },
      getFlightScheduleProviders: () => [],
    },
    __globals: {
      Date: FixedDate,
    },
  });
  const fallbackSchedule = await fallbackFacade.fetchAirportScheduleRaw('PSA');
  const fallbackCacheStatus = fallbackSchedule.providerDiagnostics.find(item => item.provider === 'cache' && item.mode === 'fallback');
  assert(fallbackCacheStatus?.cacheMerged === false, 'fallback cache diagnostics should identify total cache fallback instead of merge');

  const fr24Module = loadTsModule('src/utils/flightProviders/fr24Provider.ts', {
    '../airportSettings': {
      buildFr24ScheduleUrl: airportCode => `https://fr24-public.test/${airportCode}`,
    },
    __globals: {
      fetch: async url => {
        const value = String(url);
        if (value.includes('flight-positions')) {
          const isDeparture = decodeURIComponent(value).includes('outbound:PSA');
          return {
            ok: true,
            text: async () => JSON.stringify({
              data: isDeparture
                ? [{
                    flight: 'U24924',
                    timestamp: '2026-05-14T13:15:00Z',
                    dest_iata: 'ORY',
                    operating_as: 'easyJet',
                    reg: 'OE-TEST',
                  }]
                : [],
            }),
          };
        }

        return {
          ok: true,
          text: async () => JSON.stringify({
            result: {
              response: {
                airport: {
                  pluginData: {
                    schedule: {
                      departures: {
                        data: [{
                          flight: {
                            identification: { number: { default: 'EC4924' } },
                            airline: { name: 'Compagnia EC', code: { iata: 'EC', icao: 'EJU' } },
                            airport: { destination: { code: { iata: 'ORY' }, name: 'Paris Orly' } },
                            time: { scheduled: { departure: easyJetVariantDepartureTs }, estimated: {}, real: {} },
                            status: { text: 'Scheduled', generic: { status: { color: 'gray' } } },
                          },
                        }],
                      },
                      arrivals: { data: [] },
                    },
                  },
                },
              },
            },
          }),
        };
      },
    },
  });
  const fr24MergedEasyJetVariants = await fr24Module.fr24ApiProvider.fetch({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    fr24ApiKey: 'fr24-key',
    now,
  });
  assert(
    fr24MergedEasyJetVariants.allDepartures.length === 1,
    'FR24 provider should merge public EC easyJet schedule rows with U2 live API rows',
  );
  assert(
    fr24MergedEasyJetVariants.allDepartures[0].flight.airline.name === 'easyJet',
    'FR24 merged easyJet variants should keep a canonical easyJet airline label',
  );

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

  const staffMonitorModule = loadTsModule('src/utils/flightProviders/staffMonitorProvider.ts', {
    '../staffMonitor': {
      fetchStaffMonitorData: async nature => nature === 'D'
        ? [{
            flightNumber: 'EC4924',
            scheduledTime: '15:15',
            estimatedTime: '15:15',
            route: 'ORY',
          }]
        : [],
    },
  });
  const staffMonitorResult = await staffMonitorModule.staffMonitorProvider.fetch({
    airportCode: 'PSA',
    airport: { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP', isCustom: false },
    now,
  });
  const staffEasyJetVariant = staffMonitorResult.allDepartures.find(
    item => item.flight.identification.number.default === 'EC4924',
  );
  assert(staffEasyJetVariant, 'StaffMonitor provider should parse EC easyJet Europe departures');
  assert(staffEasyJetVariant.flight.airline.name === 'easyJet', 'StaffMonitor EC flights should display as easyJet');
  assert(staffEasyJetVariant.flight.airline.code.iata === 'U2', 'StaffMonitor EC flights should use the canonical easyJet IATA code');

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
