import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAirportAirlines,
  getAirportInfo,
  getStoredAirportCode,
  isValidAirportCode,
  normalizeAirportCode,
  storeDetectedAirportAirlines,
  type AirportInfo,
} from './airportSettings';
import {
  fetchFlightScheduleFromProviders,
  getFlightScheduleProviders,
  type FlightScheduleProviderContext,
  type FlightSchedulePayload,
  type FlightScheduleProviderId,
  type FlightScheduleProviderStatus,
} from './flightProviders';
import { getAeroDataBoxApiKey, getAeroDataBoxGateway, getAirLabsApiKey, getFlightProviderPreference, getFr24ApiKey } from './flightProviderSettings';
import { FLIGHT_CRITICAL_REFRESH_TIMEOUT_MS } from './flightRefreshPolicy';
import {
  filterFlightsByAirlines,
  getFlightBestTs,
  getFlightScheduledTs,
  mergeFlightLists,
  pruneExpiredFlights,
  pruneUnseenFlights,
  type FlightDirection,
} from './flightScheduleAdapter';
import { mergeFlightExternalLinkMetadata } from './flightExternalLinks';
import { TURNAROUND_MATCH_WINDOW_SECONDS } from './unifiedFlightList';
import { getErrorMessage } from './errorUtils';
export {
  enrichFlightScheduleWithFr24Ids,
  resolveFlightradar24IdForFlight,
} from './flightProviders/fr24Provider';

const FETCH_TIMEOUT = FLIGHT_CRITICAL_REFRESH_TIMEOUT_MS;
const SCHEDULE_CACHE_KEY = 'aerostaff_schedule_provider_cache_v1';
const SCHEDULE_CACHE_TTL_MS = 30 * 60 * 1000;
const SCHEDULE_DAY_CACHE_TTL_MS = 28 * 60 * 60 * 1000;

export type { FlightScheduleProviderId, FlightScheduleProviderStatus };

export type FR24Schedule = {
  arrivals: any[];
  departures: any[];
  airportCode: string;
  airport: AirportInfo;
  source?: FlightScheduleProviderId;
  sourceLabel?: string;
  providerDiagnostics?: FlightScheduleProviderStatus[];
  fetchedAt?: number;
};

export type FR24ScheduleRaw = FR24Schedule & {
  allArrivals: any[];
  allDepartures: any[];
};

export type FlightScheduleFetchOptions = {
  onProgress?: (schedule: FR24ScheduleRaw) => void;
  maxAgeMs?: number;
};

type ScheduleRequest = {
  promise: Promise<FR24ScheduleRaw>;
  listeners: Set<(schedule: FR24ScheduleRaw) => void>;
  latest?: FR24ScheduleRaw;
};
const scheduleRequests = new Map<string, ScheduleRequest>();
let recentSchedule: { key: string; schedule: FR24ScheduleRaw } | undefined;

function notifySchedule(listener: (schedule: FR24ScheduleRaw) => void, schedule: FR24ScheduleRaw) {
  try { listener(schedule); } catch {}
}

async function resolveAirportCode(code?: string): Promise<string> {
  const normalized = normalizeAirportCode(code);
  return isValidAirportCode(normalized) ? normalized : getStoredAirportCode();
}

type ScheduleCacheEntry = {
  airportCode: string;
  allArrivals: any[];
  allDepartures: any[];
  source?: FlightScheduleProviderId;
  sourceLabel?: string;
  providerDiagnostics?: FlightScheduleProviderStatus[];
  fetchedAt: number;
  savedAt: number;
};

function dedupeSchedulePayload<T extends { allArrivals: any[]; allDepartures: any[] }>(payload: T): T {
  return {
    ...payload,
    allArrivals: mergeFlightLists([], payload.allArrivals, 'arrival'),
    allDepartures: mergeFlightLists([], payload.allDepartures, 'departure'),
  };
}

export type FlightProviderDiagnosticsSnapshot = {
  airportCode: string;
  sourceLabel: string;
  fetchedAt: number;
  savedAt: number;
  diagnostics: FlightScheduleProviderStatus[];
  arrivals: number;
  departures: number;
  todayArrivals: number;
  todayDepartures: number;
  tomorrowArrivals: number;
  tomorrowDepartures: number;
};

async function loadCachedScheduleWithin(airportCode: string, ttlMs: number): Promise<ScheduleCacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULE_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const entry = cache?.[airportCode] as ScheduleCacheEntry | undefined;
    const savedAt = entry?.savedAt;
    if (!entry || typeof savedAt !== 'number' || !Number.isFinite(savedAt) || Date.now() - savedAt > ttlMs) return null;
    if (!Array.isArray(entry.allArrivals) || !Array.isArray(entry.allDepartures)) return null;
    return entry;
  } catch {
    return null;
  }
}

async function loadCachedSchedule(airportCode: string): Promise<ScheduleCacheEntry | null> {
  return loadCachedScheduleWithin(airportCode, SCHEDULE_CACHE_TTL_MS);
}

function pruneActiveDayFlights(items: any[], direction: FlightDirection, nowMs = Date.now()): any[] {
  return pruneUnseenFlights(
    pruneExpiredFlights(items, direction, nowMs / 1000, TURNAROUND_MATCH_WINDOW_SECONDS),
    nowMs,
    TURNAROUND_MATCH_WINDOW_SECONDS * 1000,
  );
}

function withActiveDayCache<T extends {
  allArrivals: any[];
  allDepartures: any[];
  sourceLabel?: string;
  diagnostics?: FlightScheduleProviderStatus[];
}>(payload: T, cached: ScheduleCacheEntry | null): T {
  const mergeNowMs = Date.now();
  const allArrivals = pruneActiveDayFlights(
    cached
      ? mergeFlightLists(cached.allArrivals, payload.allArrivals, 'arrival', mergeNowMs, mergeFlightExternalLinkMetadata)
      : payload.allArrivals,
    'arrival',
    mergeNowMs,
  );
  const allDepartures = pruneActiveDayFlights(
    cached
      ? mergeFlightLists(cached.allDepartures, payload.allDepartures, 'departure', mergeNowMs, mergeFlightExternalLinkMetadata)
      : payload.allDepartures,
    'departure',
    mergeNowMs,
  );
  if (!cached) {
    return { ...payload, allArrivals, allDepartures };
  }

  const freshCount = payload.allArrivals.length + payload.allDepartures.length;
  const mergedCount = allArrivals.length + allDepartures.length;
  const contributed = mergedCount > freshCount;

  return {
    ...payload,
    allArrivals,
    allDepartures,
    sourceLabel: contributed && payload.sourceLabel
      ? `${payload.sourceLabel} + Cache giornaliera`
      : payload.sourceLabel,
    diagnostics: [
      ...(payload.diagnostics ?? []),
      {
        provider: 'cache',
        label: 'Cache giornaliera',
        status: 'success',
        mode: 'dailyMerge',
        contributed,
        cacheMerged: contributed,
        message: contributed
          ? 'Lista voli fusa con la cache della giornata'
          : 'Cache della giornata verificata',
        arrivals: cached.allArrivals.length,
        departures: cached.allDepartures.length,
      },
    ],
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameLocalDay(ts: number | undefined, day: Date): boolean {
  if (!ts) return false;
  const actual = new Date(ts * 1000);
  return actual.getFullYear() === day.getFullYear()
    && actual.getMonth() === day.getMonth()
    && actual.getDate() === day.getDate();
}

function countFlightsOnDay(items: any[], direction: FlightDirection, day: Date): number {
  return items.reduce(
    (count, item) => count + (isSameLocalDay(
      getFlightScheduledTs(item, direction) ?? getFlightBestTs(item, direction),
      day,
    ) ? 1 : 0),
    0,
  );
}

export async function getCachedFlightProviderDiagnostics(code?: string): Promise<FlightProviderDiagnosticsSnapshot | null> {
  try {
    const airportCode = await resolveAirportCode(code);
    const raw = await AsyncStorage.getItem(SCHEDULE_CACHE_KEY);
    if (!raw) return null;

    const cache = JSON.parse(raw);
    const entry = cache?.[airportCode] as ScheduleCacheEntry | undefined;
    if (!entry) return null;
    const allArrivals = Array.isArray(entry.allArrivals) ? entry.allArrivals : [];
    const allDepartures = Array.isArray(entry.allDepartures) ? entry.allDepartures : [];
    const today = new Date();
    const tomorrow = addDays(today, 1);

    return {
      airportCode,
      sourceLabel: entry.sourceLabel ?? 'Sconosciuta',
      fetchedAt: entry.fetchedAt,
      savedAt: entry.savedAt,
      diagnostics: Array.isArray(entry.providerDiagnostics) ? entry.providerDiagnostics : [],
      arrivals: allArrivals.length,
      departures: allDepartures.length,
      todayArrivals: countFlightsOnDay(allArrivals, 'arrival', today),
      todayDepartures: countFlightsOnDay(allDepartures, 'departure', today),
      tomorrowArrivals: countFlightsOnDay(allArrivals, 'arrival', tomorrow),
      tomorrowDepartures: countFlightsOnDay(allDepartures, 'departure', tomorrow),
    };
  } catch {
    return null;
  }
}

async function saveCachedSchedule(entry: ScheduleCacheEntry): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULE_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[entry.airportCode] = entry;
    await AsyncStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

async function fetchScheduleRawData(code?: string, options: FlightScheduleFetchOptions = {}): Promise<FR24ScheduleRaw> {
  const [airportCode, airLabsApiKey, fr24ApiKey, aeroDataBoxApiKey, aeroDataBoxGateway, preference] = await Promise.all([
    resolveAirportCode(code), getAirLabsApiKey(), getFr24ApiKey(), getAeroDataBoxApiKey(),
    getAeroDataBoxGateway(), getFlightProviderPreference(),
  ]);
  // Coalesce concurrent work with identical settings. Only screen navigation
  // may reuse the last result; a manual refresh always checks sources again.
  const key = JSON.stringify([airportCode, airLabsApiKey, fr24ApiKey, aeroDataBoxApiKey, aeroDataBoxGateway, preference]);
  let request = scheduleRequests.get(key);
  if (!request && recentSchedule?.key === key && (options.maxAgeMs ?? 0) > 0) {
    const age = Date.now() - (recentSchedule.schedule.fetchedAt ?? 0);
    if (age >= 0 && age < Math.min(options.maxAgeMs!, 30_000)) return recentSchedule.schedule;
  }
  if (!request) {
    const current: ScheduleRequest = {
      listeners: new Set(),
      promise: runScheduleRequest({
        airportCode, airport: getAirportInfo(airportCode), airLabsApiKey, fr24ApiKey,
        aeroDataBoxApiKey, aeroDataBoxGateway, preference,
      }, schedule => {
        current.latest = schedule;
        current.listeners.forEach(listener => notifySchedule(listener, schedule));
      }).then(schedule => {
        if (!schedule.providerDiagnostics?.some(item => item.mode === 'fallback')) {
          recentSchedule = { key, schedule };
        } else if (recentSchedule?.key === key) {
          recentSchedule = undefined;
        }
        return schedule;
      }).catch(error => {
        if (recentSchedule?.key === key) recentSchedule = undefined;
        throw error;
      }).finally(() => {
        if (scheduleRequests.get(key) === current) scheduleRequests.delete(key);
        current.listeners.clear();
      }),
    };
    request = current;
    scheduleRequests.set(key, current);
  }
  const listener = options.onProgress;
  if (listener) {
    request.listeners.add(listener);
    if (request.latest) notifySchedule(listener, request.latest);
  }
  try {
    return await request.promise;
  } finally {
    if (listener) request.listeners.delete(listener);
  }
}

function toRawSchedule(payload: FlightSchedulePayload, airportCode: string, airport: AirportInfo): FR24ScheduleRaw {
  const { allArrivals, allDepartures } = payload;
  const visibleNowSeconds = Date.now() / 1000;
  const airlines = getAirportAirlines(airportCode);
  return {
    allArrivals, allDepartures,
    arrivals: filterFlightsByAirlines(pruneExpiredFlights(allArrivals, 'arrival', visibleNowSeconds), airlines),
    departures: filterFlightsByAirlines(pruneExpiredFlights(allDepartures, 'departure', visibleNowSeconds), airlines),
    airportCode, airport, source: payload.source, sourceLabel: payload.sourceLabel,
    providerDiagnostics: payload.diagnostics, fetchedAt: payload.fetchedAt,
  };
}

async function runScheduleRequest(context: FlightScheduleProviderContext, onProgress: (schedule: FR24ScheduleRaw) => void): Promise<FR24ScheduleRaw> {
  const { airportCode } = context;
  const airport = getAirportInfo(airportCode);
  const cachedDay = await loadCachedScheduleWithin(airportCode, SCHEDULE_DAY_CACHE_TTL_MS);
  const now = new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let payload: Awaited<ReturnType<typeof fetchFlightScheduleFromProviders>>;
  try {
    payload = dedupeSchedulePayload(await fetchFlightScheduleFromProviders({
      ...context,
      signal: controller.signal,
      now,
      onProgress: partial => onProgress(toRawSchedule(
        dedupeSchedulePayload(withActiveDayCache(partial, cachedDay)), airportCode, airport,
      )),
    }, getFlightScheduleProviders(context.preference)));
    payload = dedupeSchedulePayload(withActiveDayCache(
      payload,
      cachedDay,
    ));
    await saveCachedSchedule({
      airportCode,
      allArrivals: payload.allArrivals,
      allDepartures: payload.allDepartures,
      source: payload.source,
      sourceLabel: payload.sourceLabel,
      providerDiagnostics: payload.diagnostics,
      fetchedAt: payload.fetchedAt,
      savedAt: Date.now(),
    });
  } catch (error) {
    const cached = cachedDay ?? await loadCachedSchedule(airportCode);
    if (!cached) throw error;

    const fallbackNowMs = Date.now();
    payload = dedupeSchedulePayload({
      allArrivals: pruneActiveDayFlights(cached.allArrivals, 'arrival', fallbackNowMs),
      allDepartures: pruneActiveDayFlights(cached.allDepartures, 'departure', fallbackNowMs),
      source: cached.source ?? 'cache',
      sourceLabel: `${cached.sourceLabel ?? 'Cache voli'} (cache)`,
      fetchedAt: cached.fetchedAt,
      diagnostics: [
        ...(cached.providerDiagnostics ?? []),
        {
          provider: 'cache',
          label: 'Cache voli',
          status: 'success',
          mode: 'fallback',
          contributed: true,
          cacheMerged: false,
          message: `Fallback cache: ${getErrorMessage(error)}`,
        },
      ],
    });
  } finally {
    clearTimeout(timer);
  }

  const { allArrivals, allDepartures } = payload;
  await storeDetectedAirportAirlines(airportCode, allArrivals, allDepartures);
  return toRawSchedule(payload, airportCode, airport);
}

/**
 * Fetch airport schedule, filtered by allowed airlines.
 * Uses the provider layer under the hood: configured external providers first,
 * then airport-specific fallbacks and local cache.
 */
export async function fetchAirportSchedule(code?: string): Promise<FR24Schedule> {
  const raw = await fetchScheduleRawData(code);
  return {
    arrivals: raw.arrivals,
    departures: raw.departures,
    airportCode: raw.airportCode,
    airport: raw.airport,
    source: raw.source,
    sourceLabel: raw.sourceLabel,
    providerDiagnostics: raw.providerDiagnostics,
    fetchedAt: raw.fetchedAt,
  };
}

/**
 * Fetch raw (unfiltered) schedule - needed when callers also use non-allowed airline data
 * (e.g. inbound arrival map by registration).
 */
export async function fetchAirportScheduleRaw(code?: string, options?: FlightScheduleFetchOptions): Promise<FR24ScheduleRaw> {
  return fetchScheduleRawData(code, options);
}

// Legacy aliases kept to avoid breaking older imports.
export const fetchPSASchedule = fetchAirportSchedule;
export const fetchPSAScheduleRaw = fetchAirportScheduleRaw;
