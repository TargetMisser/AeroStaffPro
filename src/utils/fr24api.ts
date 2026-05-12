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
  type FlightScheduleProviderId,
  type FlightScheduleProviderStatus,
} from './flightProviders';
import { getAirLabsApiKey, getFlightProviderPreference, getFr24ApiKey } from './flightProviderSettings';
import { filterFlightsByAirlines, mergeFlightLists } from './flightScheduleAdapter';

const FETCH_TIMEOUT = 15000; // AirLabs live + route prediction can take a little longer on mobile networks.
const SCHEDULE_CACHE_KEY = 'aerostaff_schedule_provider_cache_v1';
const SCHEDULE_CACHE_TTL_MS = 30 * 60 * 1000;

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
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? 'unknown_error');
}

async function loadCachedSchedule(airportCode: string): Promise<ScheduleCacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULE_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const entry = cache?.[airportCode] as ScheduleCacheEntry | undefined;
    if (!entry || Date.now() - entry.savedAt > SCHEDULE_CACHE_TTL_MS) return null;
    if (!Array.isArray(entry.allArrivals) || !Array.isArray(entry.allDepartures)) return null;
    return entry;
  } catch {
    return null;
  }
}

export async function getCachedFlightProviderDiagnostics(code?: string): Promise<FlightProviderDiagnosticsSnapshot | null> {
  try {
    const airportCode = await resolveAirportCode(code);
    const raw = await AsyncStorage.getItem(SCHEDULE_CACHE_KEY);
    if (!raw) return null;

    const cache = JSON.parse(raw);
    const entry = cache?.[airportCode] as ScheduleCacheEntry | undefined;
    if (!entry) return null;

    return {
      airportCode,
      sourceLabel: entry.sourceLabel ?? 'Sconosciuta',
      fetchedAt: entry.fetchedAt,
      savedAt: entry.savedAt,
      diagnostics: Array.isArray(entry.providerDiagnostics) ? entry.providerDiagnostics : [],
      arrivals: Array.isArray(entry.allArrivals) ? entry.allArrivals.length : 0,
      departures: Array.isArray(entry.allDepartures) ? entry.allDepartures.length : 0,
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

async function fetchScheduleRawData(code?: string): Promise<FR24ScheduleRaw> {
  const airportCode = await resolveAirportCode(code);
  const airport = getAirportInfo(airportCode);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let payload: Awaited<ReturnType<typeof fetchFlightScheduleFromProviders>>;
  try {
    const airLabsApiKey = await getAirLabsApiKey();
    const fr24ApiKey = await getFr24ApiKey();
    const providerPreference = await getFlightProviderPreference();
    payload = dedupeSchedulePayload(await fetchFlightScheduleFromProviders({
      airportCode,
      airport,
      airLabsApiKey,
      fr24ApiKey,
      signal: controller.signal,
    }, getFlightScheduleProviders(providerPreference)));
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
    const cached = await loadCachedSchedule(airportCode);
    if (!cached) throw error;

    payload = dedupeSchedulePayload({
      allArrivals: cached.allArrivals,
      allDepartures: cached.allDepartures,
      source: cached.source ?? 'cache',
      sourceLabel: `${cached.sourceLabel ?? 'Cache voli'} (cache)`,
      fetchedAt: cached.fetchedAt,
      diagnostics: [
        ...(cached.providerDiagnostics ?? []),
        {
          provider: 'cache',
          label: 'Cache voli',
          status: 'success',
          message: `Fallback cache: ${errorMessage(error)}`,
        },
      ],
    });
  } finally {
    clearTimeout(timer);
  }

  const { allArrivals, allDepartures } = payload;
  await storeDetectedAirportAirlines(airportCode, allArrivals, allDepartures);
  const airlines = getAirportAirlines(airportCode);
  return {
    allArrivals,
    allDepartures,
    arrivals: filterFlightsByAirlines(allArrivals, airlines),
    departures: filterFlightsByAirlines(allDepartures, airlines),
    airportCode,
    airport,
    source: payload.source,
    sourceLabel: payload.sourceLabel,
    providerDiagnostics: payload.diagnostics,
    fetchedAt: payload.fetchedAt,
  };
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
export async function fetchAirportScheduleRaw(code?: string): Promise<FR24ScheduleRaw> {
  return fetchScheduleRawData(code);
}

// Legacy aliases kept to avoid breaking older imports.
export const fetchPSASchedule = fetchAirportSchedule;
export const fetchPSAScheduleRaw = fetchAirportScheduleRaw;
