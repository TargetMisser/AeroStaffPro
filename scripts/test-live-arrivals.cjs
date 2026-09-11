const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const empty = { allArrivals: [], allDepartures: [] };
const unused = { supports: () => false, fetch: async () => empty };
const airport = { code: 'PSA', name: 'Pisa International', icao: 'LIRP', latitude: 43.6839, longitude: 10.3927 };
function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  const load = file => {
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    let source = fs.readFileSync(filename, 'utf8');
    if (process.env.ARRIVAL_BASELINE && filename.endsWith('fr24Provider.ts')) {
      source = require('node:child_process').execFileSync('git', ['show', 'HEAD:src/utils/flightProviders/fr24Provider.ts'], { cwd: root, encoding: 'utf8' });
    }
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(output, {
      module, exports: module.exports, console, Date, URLSearchParams, setTimeout, clearTimeout,
      setInterval, clearInterval, AbortController, ...globals,
      require: key => {
        if (Object.hasOwn(mocks, key)) return mocks[key];
        if (!key.startsWith('.')) return require(key);
        const resolved = path.resolve(path.dirname(filename), key);
        return load(fs.existsSync(resolved + '.ts') ? resolved + '.ts' : resolved + '/index.ts');
      },
    }, { filename });
    return module.exports;
  };
  return load;
}
function arrival(number = 'FR123', eta = Date.now() / 1000 + 1800) {
  return { flight: {
    identification: { number: { default: number } },
    aircraft: { registration: 'EI-TEST' },
    airport: { origin: { name: 'Rome', code: { iata: 'FCO' } } },
    time: { scheduled: { arrival: eta }, estimated: {}, real: {} },
    _operational: { stand: '21' }, _source: 'staffMonitor', status: { text: 'Expected' },
  } };
}
const baseMocks = {
  '../airportSettings': { buildFr24ScheduleUrl: () => 'https://blocked-public.invalid', getAirportInfo: () => airport },
  './aeroDataBoxProvider': { aeroDataBoxProvider: unused }, './airLabsProvider': { airLabsProvider: unused },
  './staffMonitorProvider': { staffMonitorProvider: unused }, '../devLog': { devLog() {} },
};

async function providerRegression() {
  const calls = [];
  const now = Date.now();
  const liveEta = Math.floor(now / 1000 + 1500);
  const load = loader(baseMocks, { fetch: async (url, init) => {
    calls.push({ url, signal: init?.signal });
    if (!url.includes('fr24api.flightradar24.com')) return { ok: false, status: 403, text: async () => '<html>blocked</html>' };
    return { ok: true, text: async () => JSON.stringify({ data: url.includes('outbound') ? [] : [{
      flight: 'FR123', fr24_id: 'abcdef12', timestamp: new Date(now).toISOString(),
      eta: new Date(liveEta * 1000).toISOString(), orig_iata: 'FCO', reg: 'EI-TEST',
    }] }) };
  } });
  const fr24 = load('src/utils/flightProviders/fr24Provider.ts');
  const live = await fr24.fr24ApiProvider.fetch({ airportCode: 'PSA', airport, fr24ApiKey: 'test-only' });
  assert.equal(live.liveUpdates?.arrivals.length, 1, 'official ETA must survive a blocked public schedule');
  assert.equal(calls.length, 2, 'official provider must never request the public schedule');
  assert.equal(live.allArrivals.length, 0, 'ETA must never fabricate STA');
  const layer = load('src/utils/flightProviders/index.ts');
  for (const apiFirst of [true, false]) {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const previews = [];
    const board = arrival('FR123', Math.floor(now / 1000 + 1800));
    const providers = [
      { ...fr24.fr24ApiProvider, fetch: async () => { if (!apiFirst) await held; return live; } },
      { id: 'staffMonitor', label: 'StaffMonitor', supports: () => true, fetch: async () => {
        if (apiFirst) await held;
        return { allArrivals: [board], allDepartures: [] };
      } },
      { ...fr24.fr24PublicProvider },
    ];
    const pending = layer.fetchFlightScheduleFromProviders({ airportCode: 'PSA', airport, fr24ApiKey: 'test-only', onProgress: p => previews.push(p) }, providers);
    await tick();
    release();
    const result = await pending;
    assert.equal(result.allArrivals.length, 1);
    assert.equal(result.allArrivals[0].flight.time.estimated.arrival, liveEta);
    assert.equal(result.allArrivals[0].flight.time.scheduled.arrival, board.flight.time.scheduled.arrival);
    assert.equal(result.allArrivals[0].flight._operational.stand, '21');
    assert.equal(result.allArrivals[0].flight._etaObservedAt, Math.floor(now / 1000) * 1000);
    assert(previews.some(p => p.allArrivals[0]?.flight.time.estimated.arrival === liveEta));
    assert.equal(board.flight.time.estimated.arrival, undefined, 'input board stays unchanged');
  }
  calls.length = 0;
  await fr24.fetchFr24ArrivalUpdates('PSA', airport, 'test-only', ['FR123'], new AbortController().signal);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('airports'), 'inbound:PSA');
  assert.equal(url.searchParams.get('flights'), 'FR123');
  assert.equal(url.searchParams.get('limit'), '1');
}

async function trackingRegression() {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  let apiCalls = 0;
  let apiFail = false;
  let resolveOfficial;
  const official = new Promise(resolve => { resolveOfficial = resolve; });
  const load = loader({
    './flightProviders/fr24Provider': { fetchFr24ArrivalUpdates: async () => {
      apiCalls++;
      if (apiFail) throw new Error('FR24_API_ARRIVALS_HTTP_429');
      return official;
    } },
    './liveArrivalEta': {
      fetchAdsbAircraft: async () => [],
      applyLiveArrivalEtas: items => items.map(item => ({ ...item, flight: { ...item.flight,
        time: { ...item.flight.time, estimated: { arrival: now / 1000 + 1000 } },
        _etaSource: 'adsb', _etaObservedAt: now,
      } })),
    },
  }, { Date: Clock });
  const refreshModule = load('src/utils/liveArrivalRefresh.ts');
  const refresh = refreshModule.createLiveArrivalRefresher();
  const rows = [arrival('FR123', now / 1000 + 1800)];
  const updates = [];
  const controller = new AbortController();
  const request = { arrivals: rows, airport, apiKey: 'test-only', signal: controller.signal, onProgress: p => updates.push(p) };
  const pending = refresh(request);
  await tick();
  assert.equal(updates[0][0].flight._etaSource, 'adsb', 'fast fallback must publish while FR24 is pending');
  resolveOfficial([{ ...rows[0], flight: { ...rows[0].flight,
    time: { ...rows[0].flight.time, estimated: { arrival: now / 1000 + 1200 } }, _etaSource: 'fr24_api', _etaObservedAt: now,
  } }]);
  await pending;
  assert.equal(updates.at(-1)[0].flight._etaSource, 'fr24_api');
  assert.equal(updates.at(-1)[0].flight.time.estimated.arrival, now / 1000 + 1200);
  await refresh(request);
  assert.equal(apiCalls, 1, 'repeated polls within one minute must not spend API credits');
  now += 61_000;
  apiFail = true;
  await refresh(request);
  assert.equal(apiCalls, 2);
  now += 61_000;
  await refresh(request);
  assert.equal(apiCalls, 2, 'quota errors must back off');
  await refresh({ ...request, apiKey: 'replacement-test-key' });
  assert.equal(apiCalls, 3, 'a replacement credential must escape the old cooldown');
  const beforeAbort = updates.length;
  controller.abort();
  await refresh(request);
  assert.equal(updates.length, beforeAbort);
  const landed = arrival('FR999', now / 1000 + 200);
  landed.flight.time.real.arrival = now / 1000;
  const targets = refreshModule.selectLiveArrivals([landed, arrival('FR998', now / 1000 + 86400),
    ...Array.from({ length: 9 }, (_, i) => arrival('FR' + i, now / 1000 + 900 + i * 100))]);
  assert.equal(targets.length, 6);
  assert.equal(targets[0].flight.identification.number.default, 'FR0');
}

async function freshnessRegression() {
  const now = Date.now();
  const load = loader({}, { fetch: async () => ({ ok: true, json: async () => ({
    now, ac: [{ r: 'EI-TEST', flight: 'RYR123', lat: 42.5, lon: 11.2, gs: 400, alt_baro: 30000, track: 333, seen_pos: 120 }],
  }) }) });
  const live = load('src/utils/liveArrivalEta.ts');
  const data = await live.fetchAdsbAircraft(airport.latitude, airport.longitude);
  assert.equal(data[0].observedAt, now - 120_000, 'ADS-B now is milliseconds on the live endpoint');
  const row = arrival();
  assert.equal(live.applyLiveArrivalEtas([row], data, airport.latitude, airport.longitude)[0], row, 'old positions must not produce a fresh ETA');
  const merge = load('src/utils/flightLiveUpdates.ts');
  const old = { ...row, flight: { ...row.flight, _etaSource: 'fr24_api', _etaObservedAt: now - 600_000,
    time: { ...row.flight.time, estimated: { arrival: now / 1000 + 1200 } } } };
  const fresh = live.applyLiveArrivalEtas([old], [{ ...data[0], observedAt: now }], airport.latitude, airport.longitude)[0];
  assert.equal(fresh.flight._etaSource, 'adsb', 'expired official ETA must not block fresh fallback indefinitely');
  assert.equal(merge.isLiveEtaFresh(old), false);
  assert.equal(merge.isLiveEtaFresh(fresh), true);
  const official = { ...row, flight: { ...row.flight, _etaSource: 'fr24_api', _etaObservedAt: now - 2000,
    time: { ...row.flight.time, estimated: { arrival: now / 1000 + 1400 } } } };
  assert.equal(merge.applyFlightLiveUpdates([fresh], [official], 'arrival')[0].flight._etaSource, 'fr24_api',
    'fresh authoritative ETA beats a slightly newer geometric observation');
  const delayed = { ...official, flight: { ...official.flight,
    time: { scheduled: { arrival: now / 1000 + 4 * 3600 }, estimated: { arrival: now / 1000 + 4 * 3600 }, real: {} } } };
  assert.equal(merge.applyFlightLiveUpdates([row], [delayed], 'arrival')[0].flight.time.estimated.arrival, now / 1000 + 4 * 3600,
    'same registration, flight number and route retain an ETA delayed beyond two hours');
  const duplicate = { ...row, flight: { ...row.flight } };
  assert.equal(merge.applyFlightLiveUpdates([row, duplicate], [old], 'arrival')[0], row, 'ambiguous rotations must not receive the ETA');
  const landed = { ...row, flight: { ...row.flight, time: { ...row.flight.time, real: { arrival: now / 1000 } } } };
  assert.equal(merge.applyFlightLiveUpdates([landed], [old], 'arrival')[0], landed);
}

async function lifecycleRegression(preference = 'auto') {
  const effects = [];
  const snapshots = [];
  let interval, appChange, release, requestSignal;
  let removed = false, cleared = false;
  const appState = { currentState: 'active', addEventListener: (_event, callback) => {
    appChange = callback; return { remove: () => { removed = true; } };
  } };
  const load = loader({
    react: { useMemo: fn => fn(), useState: () => [null, value => snapshots.push(value)],
      useRef: current => ({ current }), useEffect: fn => effects.push(fn) },
    'react-native': { AppState: appState }, '../utils/airportSettings': { getAirportInfo: () => airport },
    '../utils/flightProviderSettings': { getFr24ApiKey: async () => 'test-only', getFlightProviderPreference: async () => preference },
    '../utils/liveArrivalRefresh': { LIVE_ARRIVAL_REFRESH_MS: 30_000, createLiveArrivalRefresher: () => async request => {
      assert.equal(request.apiKey, 'test-only', `${preference} is a timetable preference, not a switch disabling live ETA`);
      requestSignal = request.signal;
      await new Promise(resolve => { release = resolve; });
      request.onProgress([arrival()]);
    } },
  }, { setInterval: fn => { interval = fn; return 7; }, clearInterval: id => { cleared = id === 7; } });
  const hook = load('src/hooks/useLiveArrivals.ts');
  hook.useLiveArrivals([arrival()], 'PSA', true);
  const cleanup = effects[0]();
  await tick();
  interval();
  appState.currentState = 'background';
  appChange('background');
  assert.equal(requestSignal.aborted, true);
  cleanup();
  release();
  await tick();
  assert.equal(snapshots.length, 0, 'late responses after background/unmount must not update the UI');
  assert(removed && cleared);
  hook.useLiveArrivals([arrival()], 'PSA', false);
  assert.equal(effects[1](), undefined, 'hidden/tomorrow tabs must not start live polling');
}

async function cachedBoardRegression() {
  const now = Date.now();
  let calls = 0;
  const board = { ...arrival(), _seenAtMs: now };
  const live = { ...board, flight: { ...board.flight, _etaSource: 'fr24_api', _etaObservedAt: now,
    time: { scheduled: { arrival: now / 1000 + 1200 }, estimated: { arrival: now / 1000 + 1200 }, real: {} } } };
  const storage = new Map([['aerostaff_schedule_provider_cache_v1', JSON.stringify({ PSA: {
    airportCode: 'PSA', allArrivals: [board], allDepartures: [], fetchedAt: now - 300_000, savedAt: now - 300_000,
  } })]]);
  const load = loader({
    '@react-native-async-storage/async-storage': { getItem: async k => storage.get(k), setItem: async (k, v) => storage.set(k, v) },
    './airportSettings': { getAirportInfo: () => airport, getStoredAirportCode: async () => 'PSA',
      normalizeAirportCode: c => c, isValidAirportCode: () => true, getAirportAirlines: () => [], storeDetectedAirportAirlines: async () => {} },
    './flightProviderSettings': { getFr24ApiKey: async () => 'test-only', getFlightProviderPreference: async () => 'auto',
      getAirLabsApiKey: async () => null, getAeroDataBoxApiKey: async () => null, getAeroDataBoxGateway: async () => 'apiMarket' },
    './flightProviders/fr24Provider': {},
    './flightProviders': { getFlightScheduleProviders: () => [], fetchFlightScheduleFromProviders: async context => {
      const payload = { ...empty,
        allArrivals: calls++ ? [board] : [],
        liveUpdates: { arrivals: calls === 1 ? [live] : [], departures: [] }, source: 'fr24Api',
        sourceLabel: 'FR24', fetchedAt: now, diagnostics: [] };
      context.onProgress(payload);
      return payload;
    } },
  });
  const previews = [];
  const facade = load('src/utils/fr24api.ts');
  const result = await facade.fetchAirportScheduleRaw('PSA', { onProgress: p => previews.push(p) });
  assert.equal(result.allArrivals[0].flight.time.estimated.arrival, live.flight.time.estimated.arrival);
  assert.equal(previews[0].allArrivals[0].flight.time.estimated.arrival, live.flight.time.estimated.arrival);
  const saved = JSON.parse(storage.get('aerostaff_schedule_provider_cache_v1')).PSA;
  assert.equal(saved.allArrivals[0].flight.time.scheduled.arrival, board.flight.time.scheduled.arrival);
  assert.equal(saved.allArrivals[0].flight.time.estimated.arrival, live.flight.time.estimated.arrival);
  previews.length = 0;
  const next = await facade.fetchAirportScheduleRaw('PSA', { onProgress: p => previews.push(p) });
  assert.equal(calls, 2, 'exercise an actual second provider refresh');
  assert.equal(next.allArrivals[0].flight.time.estimated.arrival, live.flight.time.estimated.arrival);
  assert.equal(previews[0].allArrivals[0].flight._etaSource, 'fr24_api', 'progress previews also retain a fresh observation');
  assert.equal(JSON.parse(storage.get('aerostaff_schedule_provider_cache_v1')).PSA.allArrivals[0].flight._etaObservedAt, now);
}

async function manchesterPhotoRegression() {
  // Photo identifiers/times with a controlled observation clock and API response;
  // this does not assert which response the user's device actually received.
  let now = Date.parse('2026-09-11T17:00:00+02:00');
  const sta = Date.parse('2026-09-11T18:50:00+02:00') / 1000;
  const eta = Date.parse('2026-09-11T18:33:00+02:00') / 1000;
  class Clock extends Date { static now() { return now; } }
  const board = arrival('U22129', sta);
  board.flight.aircraft.registration = 'G-UZMJ';
  board.flight.airport.origin = { name: 'Manchester', code: {} };
  board.flight.time.estimated.arrival = sta;
  const load = loader(baseMocks, { Date: Clock, fetch: async url => ({ ok: true,
    text: async () => JSON.stringify({ data: url.includes('outbound') ? [] : [{
      flight: 'U22129', reg: 'G-UZMJ', orig_iata: 'MAN', dest_iata: 'PSA',
      fr24_id: 'abcdef12', timestamp: new Date(now).toISOString(), eta: new Date(eta * 1000).toISOString(),
    }] }),
  }) });
  const fr24 = load('src/utils/flightProviders/fr24Provider.ts');
  const observations = await fr24.fetchFr24ArrivalUpdates('PSA', airport, 'test-only', ['U22129']);
  const adapter = load('src/utils/flightScheduleAdapter.ts');
  const live = load('src/utils/flightLiveUpdates.ts');
  const observed = live.applyFlightLiveUpdates([board], observations, 'arrival')[0];
  assert.equal(observed.flight.time.estimated.arrival, eta, 'U22129 / Manchester matches U22129 / MAN');
  const departure = { flight: { identification: { number: { default: 'U22130' } },
    aircraft: { registration: 'GUZMJ' }, airport: { destination: { name: 'Manchester' } },
    time: { scheduled: { departure: sta + 45 * 60 }, estimated: {}, real: {} },
  } };
  const rotation = load('src/utils/unifiedFlightList.ts').buildUnifiedFlightList(
    [observed], [departure], new Date(now));
  assert.equal(rotation[0].linkedArrival.flight.time.estimated.arrival, eta, 'linked inbound retains 18:33');
  const { mergeFlightExternalLinkMetadata } = load('src/utils/flightExternalLinks.ts');
  const refreshed = adapter.mergeFlightLists([observed], [board], 'arrival', now + 60_000, mergeFlightExternalLinkMetadata)[0];
  assert.equal(refreshed.flight.time.estimated.arrival, eta,
    'a new timetable with 18:50 must not erase a still-fresh FR24 observation of 18:33');
  assert.equal(refreshed.flight._etaObservedAt, now, 'a timetable refresh must not renew the observation age');
  const refresh = (cached, fresh) => adapter.mergeFlightLists([cached], [fresh], 'arrival', now, mergeFlightExternalLinkMetadata)[0];
  const newer = { ...observed, flight: { ...observed.flight, _etaObservedAt: now + 1000,
    time: { ...observed.flight.time, estimated: { arrival: eta + 60 } } } };
  assert.equal(refresh(observed, newer).flight.time.estimated.arrival, eta + 60, 'newer official ETA wins');
  const landed = { ...board, flight: { ...board.flight, time: { ...board.flight.time, real: { arrival: eta - 60 } } } };
  assert.equal(refresh(observed, landed).flight.time.real.arrival, eta - 60, 'actual touchdown wins');
  assert.equal(refresh(observed, landed).flight._etaSource, undefined, 'landed rows do not inherit an obsolete ETA source');
  const swapped = { ...board, flight: { ...board.flight, aircraft: { registration: 'G-OTHER' } } };
  assert.equal(refresh(observed, swapped).flight.time.estimated.arrival, sta, 'aircraft swaps invalidate the old observation');
  const otherLeg = { ...board, flight: { ...board.flight, _fr24Id: 'abcdef13' } };
  assert.equal(refresh(observed, otherLeg).flight.time.estimated.arrival, sta, 'different tracking legs must not share a cached ETA');
  const unknownSource = live.applyFlightLiveUpdates([board], [board], 'arrival')[0];
  assert.equal(unknownSource.flight._etaSource, undefined, 'an empty live poll must never label the timetable as FR24');
  assert.equal(live.applyFlightLiveUpdates([newer], [board], 'arrival')[0].flight.time.estimated.arrival, eta + 60);
  assert.equal(load('src/utils/liveArrivalRefresh.ts').selectLiveArrivals([board], now).length, 1,
    'a Manchester inbound within three hours must not be excluded by the old 90-minute cutoff');
  now += 181_000;
  assert.equal(refresh(observed, board).flight.time.estimated.arrival, sta, 'expired observations must not override a new timetable indefinitely');
}

(async () => {
  await manchesterPhotoRegression();
  await providerRegression();
  await trackingRegression();
  await freshnessRegression();
  for (const preference of ['auto', 'fr24', 'staffMonitor', 'aeroDataBox', 'airlabs']) await lifecycleRegression(preference);
  await cachedBoardRegression();
  console.log('Live arrival regressions passed: U22129 timetable refresh, source provenance, public outage, provider order, ETA freshness, targeted polling, quota backoff and lifecycle.');
})().catch(error => { console.error(error); process.exitCode = 1; });
