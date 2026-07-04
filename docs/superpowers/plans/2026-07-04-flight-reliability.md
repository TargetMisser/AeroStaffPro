# Flight Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Flights screen cache-first and bounded, preserve official FR24 ETAs, and ensure the Android widget always paints cached content before refreshing.

**Architecture:** Keep the existing client-side provider stack, but add explicit time provenance, run the two core live providers as one parallel wave, and cap the complete refresh at eight seconds. The screen and widget retain their last valid snapshots while refreshes run; public ADS-B becomes fill-only enrichment.

**Tech Stack:** Expo 54, React Native 0.81, TypeScript 5.9, AsyncStorage, SecureStore, react-native-android-widget, Node-based TypeScript regression harnesses.

---

### Task 1: Sync the implementation branch to v2.7.31

**Files:**
- Preserve: `docs/superpowers/specs/2026-07-04-flight-reliability-design.md`
- Preserve: `docs/superpowers/plans/2026-07-04-flight-reliability.md`

- [ ] **Step 1: Confirm the worktree state**

Run:

```powershell
git status --short --branch
git log -5 --oneline --decorate
```

Expected: `codex/design-lab-storybook` is active; `output/` and `tmp/` remain untracked and untouched.

- [ ] **Step 2: Merge the current main release line**

Run:

```powershell
git merge --no-edit origin/main
```

Expected: the branch now contains v2.7.31 and retains the reliability design and plan commits.

- [ ] **Step 3: Run the baseline flight checks**

Run:

```powershell
npm run test:flight-helpers
npm run test:misc-utils
npm run typecheck
```

Expected: all commands pass before regression tests are added.

### Task 2: Preserve authoritative arrival times

**Files:**
- Modify: `src/utils/flightProviders/fr24Provider.ts`
- Modify: `src/utils/liveArrivalEta.ts`
- Test: `scripts/test-flight-helpers.cjs`

- [ ] **Step 1: Add failing FR24 authority tests**

Add these assertions to the live ETA test section in `scripts/test-flight-helpers.cjs`:

```js
const officialEta = nowSeconds + 19 * 60;
const officialArrival = {
  flight: {
    identification: { number: { default: 'FR9991' } },
    aircraft: { registration: 'EI-ETA' },
    time: {
      scheduled: { arrival: nowSeconds + 30 * 60 },
      estimated: { arrival: officialEta },
      real: {},
    },
    _etaSource: 'fr24_api',
  },
};
const matchingAircraft = [{
  registration: 'EI-ETA',
  lat: 43.1,
  lon: 10.2,
  groundSpeedKt: 250,
  altitude: 9000,
  track: 45,
}];
const preserved = liveEta.applyLiveArrivalEtas(
  [officialArrival],
  matchingAircraft,
  43.6839,
  10.3927,
  nowSeconds,
);
assert(
  preserved[0].flight.time.estimated.arrival === officialEta,
  'public ADS-B must not overwrite an official FR24 ETA',
);

const missingEstimate = {
  ...officialArrival,
  flight: {
    ...officialArrival.flight,
    time: {
      scheduled: { arrival: nowSeconds + 30 * 60 },
      estimated: {},
      real: {},
    },
    _etaSource: undefined,
  },
};
const filled = liveEta.applyLiveArrivalEtas(
  [missingEstimate],
  matchingAircraft,
  43.6839,
  10.3927,
  nowSeconds,
);
assert(
  typeof filled[0].flight.time.estimated.arrival === 'number',
  'public ADS-B should fill a missing ETA',
);
assert(filled[0].flight._etaSource === 'adsb', 'filled ETA should expose ADS-B provenance');
```

Extend the FR24 provider fixture containing an arrival ETA and assert:

```js
assert(
  fr24Arrival.flight._etaSource === 'fr24_api',
  'official FR24 ETA should be tagged as authoritative',
);
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
npm run test:flight-helpers
```

Expected: FAIL because ADS-B currently replaces the existing estimate and FR24 rows do not consistently carry provenance.

- [ ] **Step 3: Tag FR24 ETA provenance**

In `officialLiveFlightToScheduleItem`, add the source only when `etaTs` exists:

```ts
      _source: 'fr24_api',
      ...(etaTs ? { _etaSource: 'fr24_api' as const } : {}),
```

In `mergeLiveIntoScheduleItem`, preserve or set the source beside `_source`:

```ts
      _source: 'fr24_api_merged',
      _etaSource: estimatedTs ? 'fr24_api' : scheduleFlight._etaSource,
```

- [ ] **Step 4: Make public ADS-B fill-only**

At the start of the candidate loop in `applyLiveArrivalEtas`, retain real arrivals and any existing estimate:

```ts
    if (item?.flight?.time?.real?.arrival) return;
    if (typeof item?.flight?.time?.estimated?.arrival === 'number') return;
```

Keep the existing `_etaSource: 'adsb'` assignment for newly filled estimates.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
npm run test:flight-helpers
```

Expected: PASS.

- [ ] **Step 6: Commit the authority fix**

Run:

```powershell
git add scripts/test-flight-helpers.cjs src/utils/flightProviders/fr24Provider.ts src/utils/liveArrivalEta.ts
git commit -m "fix: preserve authoritative flight ETAs"
```

### Task 3: Display same-day cached flights immediately

**Files:**
- Modify: `src/utils/flightScreenCache.ts`
- Modify: `src/screens/FlightScreen.tsx`
- Test: `scripts/test-flight-helpers.cjs`

- [ ] **Step 1: Add failing stale-cache tests**

Load `flightScreenCache.ts` with an AsyncStorage mock and add:

```js
const cacheNow = new Date(2026, 6, 4, 14, 0, 0).getTime();
const todayFlightTs = Math.floor(new Date(2026, 6, 4, 10, 0, 0).getTime() / 1000);
const yesterdayFlightTs = Math.floor(new Date(2026, 6, 3, 10, 0, 0).getTime() / 1000);
const staleBase = {
  airportCode: 'PSA',
  arrivals: [],
  departures: [{
    flight: {
      identification: { number: { default: 'FR1234' } },
      time: { scheduled: { departure: todayFlightTs }, estimated: {}, real: {} },
    },
  }],
  sourceLabel: 'StaffMonitor PSA',
  fetchedAt: cacheNow - 8 * 60 * 60 * 1000,
  savedAt: cacheNow - 8 * 60 * 60 * 1000,
};
assert(
  flightCache.sanitizeFlightScreenCache(staleBase, 'PSA', cacheNow) === null,
  'normal cache reads should still reject entries beyond the freshness TTL',
);
const staleToday = flightCache.sanitizeFlightScreenCache(
  staleBase,
  'PSA',
  cacheNow,
  flightCache.FLIGHT_SCREEN_CACHE_TTL_MS,
  true,
);
assert(staleToday?.isStale === true, 'initial screen cache should accept a stale same-day snapshot');
const staleYesterday = flightCache.sanitizeFlightScreenCache(
  {
    ...staleBase,
    departures: [{
      flight: {
        identification: { number: { default: 'FR1234' } },
        time: { scheduled: { departure: yesterdayFlightTs }, estimated: {}, real: {} },
      },
    }],
  },
  'PSA',
  cacheNow,
  flightCache.FLIGHT_SCREEN_CACHE_TTL_MS,
  true,
);
assert(staleYesterday === null, 'same-day fallback must reject another day');
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
npm run test:flight-helpers
```

Expected: FAIL because the sanitizer has no same-day stale mode or `isStale`.

- [ ] **Step 3: Add explicit same-day stale support**

Import `getBestArrivalTs` and `getBestDepartureTs`, extend `FlightScreenCache` with `isStale?: boolean`, and add:

```ts
function isSameLocalDay(ts: number | undefined, nowMs: number): boolean {
  if (!ts) return false;
  const value = new Date(ts * 1000);
  const now = new Date(nowMs);
  return value.getFullYear() === now.getFullYear()
    && value.getMonth() === now.getMonth()
    && value.getDate() === now.getDate();
}

function hasFlightsForLocalDay(
  arrivals: any[],
  departures: any[],
  nowMs: number,
): boolean {
  return arrivals.some(item => isSameLocalDay(getBestArrivalTs(item), nowMs))
    || departures.some(item => isSameLocalDay(getBestDepartureTs(item), nowMs));
}
```

Extend the sanitizer signature:

```ts
export function sanitizeFlightScreenCache(
  value: unknown,
  airportCode: string,
  nowMs = Date.now(),
  ttlMs = FLIGHT_SCREEN_CACHE_TTL_MS,
  allowStaleSameDay = false,
): FlightScreenCache | null
```

After reading the arrays, enforce:

```ts
const isStale = nowMs - savedAt > ttlMs;
if (isStale && (!allowStaleSameDay || !hasFlightsForLocalDay(arrivals, departures, nowMs))) {
  return null;
}
```

Return `isStale`, and allow `loadFlightScreenCache` to receive the boolean:

```ts
export async function loadFlightScreenCache(
  airportCode: string,
  allowStaleSameDay = false,
): Promise<FlightScreenCache | null>
```

- [ ] **Step 4: Use stale cache only for initial paint**

Change the initial Flights screen cache effect to:

```ts
loadFlightScreenCache(airportCode, true).then(cache => {
  if (!active || !cache) return;
  setAllArrivalsFull(cache.arrivals);
  setAllDeparturesFull(cache.departures);
  setFlightDataSource({
    sourceLabel: cache.isStale ? `${cache.sourceLabel} · cache in aggiornamento` : cache.sourceLabel,
    fetchedAt: cache.fetchedAt,
    providerDiagnostics: cache.providerDiagnostics,
  });
})
```

In the `NO_FLIGHT_PROVIDER_AVAILABLE` branch, do not clear any of the four flight arrays. Setting the failure diagnostics is sufficient; arrays that are already empty remain empty.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
npm run test:flight-helpers
```

Expected: PASS.

- [ ] **Step 6: Commit cache-first rendering**

Run:

```powershell
git add scripts/test-flight-helpers.cjs src/utils/flightScreenCache.ts src/screens/FlightScreen.tsx
git commit -m "fix: show same-day flight cache immediately"
```

### Task 4: Bound and parallelize the critical provider refresh

**Files:**
- Modify: `src/utils/flightRefreshPolicy.ts`
- Modify: `src/utils/fr24api.ts`
- Modify: `src/utils/flightProviders/index.ts`
- Test: `scripts/test-flight-helpers.cjs`
- Test: `scripts/test-app-setup.cjs`

- [ ] **Step 1: Add failing policy and concurrency tests**

In `scripts/test-app-setup.cjs`, assert:

```js
assert(
  flightRefreshPolicy.FLIGHT_CRITICAL_REFRESH_TIMEOUT_MS === 8_000,
  'critical flight refresh should have an eight-second hard deadline',
);
```

In the async provider tests, create two core providers that resolve after different short delays and one fallback provider that records calls:

```js
const starts = [];
const coreA = {
  id: 'fr24Api',
  label: 'FR24',
  supports: () => true,
  fetch: async () => {
    starts.push(['fr24Api', Date.now()]);
    await new Promise(resolve => setTimeout(resolve, 30));
    return { allArrivals: [makeTodayArrival('FR100')], allDepartures: [] };
  },
};
const coreB = {
  id: 'staffMonitor',
  label: 'StaffMonitor',
  supports: () => true,
  fetch: async () => {
    starts.push(['staffMonitor', Date.now()]);
    await new Promise(resolve => setTimeout(resolve, 30));
    return { allArrivals: [], allDepartures: [makeTodayDeparture('FR200')] };
  },
};
const fallback = {
  id: 'fr24Public',
  label: 'FR24 public',
  supports: () => true,
  fetch: async () => ({ allArrivals: [], allDepartures: [] }),
};
await providerLayer.fetchFlightScheduleFromProviders(
  { airportCode: 'PSA', airport, now, preference: 'auto' },
  [coreA, coreB, fallback],
);
assert(
  Math.abs(starts[0][1] - starts[1][1]) < 20,
  'FR24 API and StaffMonitor should start as one parallel core wave',
);
```

Define the factories beside the test:

```js
const makeTodayFlight = (flightNumber, direction) => {
  const ts = Math.floor(now.getTime() / 1000) + 30 * 60;
  return {
    flight: {
      identification: { number: { default: flightNumber } },
      airline: { name: 'Test Air' },
      airport: direction === 'arrival'
        ? { origin: { code: { iata: 'FCO' } }, destination: { code: { iata: 'PSA' } } }
        : { origin: { code: { iata: 'PSA' } }, destination: { code: { iata: 'FCO' } } },
      time: {
        scheduled: { [direction]: ts },
        estimated: {},
        real: {},
      },
      status: { text: 'Scheduled', generic: { status: { color: 'gray' } } },
    },
  };
};
const makeTodayArrival = flightNumber => makeTodayFlight(flightNumber, 'arrival');
const makeTodayDeparture = flightNumber => makeTodayFlight(flightNumber, 'departure');
```

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```powershell
npm run test:flight-helpers
npm run test:app-setup
```

Expected: FAIL because the timeout constant and parallel core wave do not exist.

- [ ] **Step 3: Add the global critical deadline**

In `flightRefreshPolicy.ts`:

```ts
export const FLIGHT_CRITICAL_REFRESH_TIMEOUT_MS = 8_000;
```

Import it in `fr24api.ts` and replace the 90-second constant:

```ts
import { FLIGHT_CRITICAL_REFRESH_TIMEOUT_MS } from './flightRefreshPolicy';

const FETCH_TIMEOUT = FLIGHT_CRITICAL_REFRESH_TIMEOUT_MS;
```

- [ ] **Step 4: Execute FR24 API and StaffMonitor as one core wave**

In `fetchFlightScheduleFromProviders`, for `auto` and `fr24` preferences:

1. Select supported, non-cooldown providers whose IDs are `fr24Api` or `staffMonitor`.
2. Start them together with `Promise.allSettled`.
3. Convert their settled results into the same diagnostics currently produced by the sequential loop.
4. Merge successful results in the original provider order, not completion order.
5. Remove the attempted core providers from the following sequential fallback loop.
6. Keep AeroDataBox and AirLabs mode selection based on the aggregate produced by the core wave.

Use this shape so merge order stays deterministic:

```ts
const parallelCoreIds = new Set<FlightScheduleProviderId>(['fr24Api', 'staffMonitor']);
const useParallelCore = context.preference === 'auto' || context.preference === 'fr24';
const coreProviders = useParallelCore
  ? providers.filter(provider => parallelCoreIds.has(provider.id))
  : [];
const coreSettled = await Promise.allSettled(
  coreProviders.map(provider => fetchProviderWithTimeout(provider, context)),
);
const coreById = new Map(
  coreProviders.map((provider, index) => [provider.id, coreSettled[index]] as const),
);
```

The implementation must route each settled entry through one shared result/diagnostic merge helper so parallel and sequential attempts use identical cooldown, coverage, and source-label behavior.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm run test:flight-helpers
npm run test:app-setup
```

Expected: PASS, with the two core provider start timestamps inside the test tolerance.

- [ ] **Step 6: Commit the bounded refresh**

Run:

```powershell
git add scripts/test-flight-helpers.cjs scripts/test-app-setup.cjs src/utils/flightRefreshPolicy.ts src/utils/fr24api.ts src/utils/flightProviders/index.ts
git commit -m "perf: bound and parallelize flight refresh"
```

### Task 5: Paint the widget before network refresh

**Files:**
- Modify: `src/widgets/widgetTaskHandler.tsx`
- Test: `scripts/test-misc-utils.cjs`

- [ ] **Step 1: Add a failing cache-first widget test**

Extend `testWidgetShiftSelfHeal` with a valid shift and cached widget state. Mock the provider with a deferred promise, call `widgetTaskHandler`, and assert the first render occurs before resolving the provider:

```js
let resolveProvider;
const providerWait = new Promise(resolve => { resolveProvider = resolve; });
const renders = [];
const taskPromise = handler.widgetTaskHandler({
  widgetAction: 'WIDGET_UPDATE',
  widgetInfo: { widgetName: 'ShiftFlights', widgetId: 7, width: 320, height: 180 },
  renderWidget: value => { renders.push(value); },
});
await new Promise(resolve => setTimeout(resolve, 0));
assert(renders.length === 1, 'widget update should paint cached content before network completion');
resolveProvider({ allDepartures: [] });
await taskPromise;
assert(renders.length >= 1, 'widget refresh completion should retain a rendered state');
```

The test module must mock `staffMonitorProvider.fetch` with `providerWait` and seed `widget_data_cache_v1` with a valid `work` state whose `shiftLabel` matches the resolved shift.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
npm run test:misc-utils
```

Expected: FAIL because `WIDGET_UPDATE` currently waits for `fetchFreshWidgetData` before its first render.

- [ ] **Step 3: Add a bounded widget network request**

Inside `fetchFreshWidgetData`, create a six-second controller and pass its signal to the provider:

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 6_000);
try {
  const result = await staffMonitorProvider.fetch({
    airportCode,
    airport: airportInfo,
    now: new Date(),
    signal: controller.signal,
  });
  allDepartures = result.allDepartures;
} finally {
  clearTimeout(timer);
}
```

Keep the existing cached fallback in the outer catch.

- [ ] **Step 4: Render cache, then refresh**

Add:

```ts
async function renderCachedThenRefresh(props: WidgetTaskHandlerProps): Promise<void> {
  const cached = await getWidgetData();
  await renderThemedWidget(props, cached);
  const fresh = await fetchFreshWidgetData();
  if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
    await renderThemedWidget(props, fresh);
  }
}
```

Use it for `WIDGET_ADDED`, `WIDGET_RESIZED`, `WIDGET_UPDATE`, and `REFRESH`. Keep `WIDGET_DELETED` unchanged.

- [ ] **Step 5: Run widget and app tests**

Run:

```powershell
npm run test:misc-utils
npm run test:app-setup
```

Expected: PASS.

- [ ] **Step 6: Commit widget reliability**

Run:

```powershell
git add scripts/test-misc-utils.cjs src/widgets/widgetTaskHandler.tsx
git commit -m "fix: render widget cache before refresh"
```

### Task 6: Full verification and delivery

**Files:**
- Verify all modified files
- Do not add: `output/`
- Do not add: `tmp/`

- [ ] **Step 1: Run the required checks**

Run:

```powershell
npm run test:flight-helpers
npm test
npm run typecheck
npm run release:check
```

Expected: all commands pass.

- [ ] **Step 2: Run emulator QA against the working tree**

Run:

```powershell
npm run qa:emulator
```

Expected: exit code 0, no inverted flight times, and screenshots/UI dumps written only under ignored `tmp/emulator-qa`.

- [ ] **Step 3: Review scope and repository state**

Run:

```powershell
git diff --check
git status --short --branch
git log -8 --oneline --decorate
```

Expected: no unstaged implementation files, no tracked temp artifacts, and the reliability commits are ahead of the remote branch.

- [ ] **Step 4: Push the implementation branch**

Run:

```powershell
git push origin codex/design-lab-storybook
```

Expected: push succeeds. Do not run release commands or publish an APK.
