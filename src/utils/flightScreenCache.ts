import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FlightScheduleProviderStatus } from './flightProviders';

export const FLIGHTS_CACHE_KEY = 'aerostaff_flights_cache_v3';
export const LEGACY_FLIGHTS_CACHE_KEY = 'aerostaff_flights_cache_v2';
export const FLIGHT_SCREEN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type FlightScreenCache = {
  airportCode: string;
  arrivals: any[];
  departures: any[];
  sourceLabel: string;
  fetchedAt: number;
  savedAt: number;
  providerDiagnostics?: FlightScheduleProviderStatus[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function sanitizeFlightScreenCache(
  value: unknown,
  airportCode: string,
  nowMs = Date.now(),
  ttlMs = FLIGHT_SCREEN_CACHE_TTL_MS,
): FlightScreenCache | null {
  if (!isRecord(value)) return null;
  const cachedAirport = typeof value.airportCode === 'string' ? value.airportCode.toUpperCase() : airportCode;
  if (cachedAirport !== airportCode.toUpperCase()) return null;

  const savedAt = readTimestamp(value.savedAt, readTimestamp(value.fetchedAt, nowMs));
  if (nowMs - savedAt > ttlMs) return null;

  return {
    airportCode: cachedAirport,
    arrivals: Array.isArray(value.arrivals) ? value.arrivals : [],
    departures: Array.isArray(value.departures) ? value.departures : [],
    sourceLabel: typeof value.sourceLabel === 'string' && value.sourceLabel.trim()
      ? value.sourceLabel
      : 'Cache voli',
    fetchedAt: readTimestamp(value.fetchedAt, savedAt),
    savedAt,
    providerDiagnostics: Array.isArray(value.providerDiagnostics)
      ? value.providerDiagnostics as FlightScheduleProviderStatus[]
      : undefined,
  };
}

async function readCacheKey(key: string, airportCode: string): Promise<FlightScreenCache | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return sanitizeFlightScreenCache(JSON.parse(raw), airportCode);
  } catch {
    return null;
  }
}

export async function loadFlightScreenCache(airportCode: string): Promise<FlightScreenCache | null> {
  return await readCacheKey(FLIGHTS_CACHE_KEY, airportCode)
    ?? await readCacheKey(LEGACY_FLIGHTS_CACHE_KEY, airportCode);
}

export async function saveFlightScreenCache(cache: Omit<FlightScreenCache, 'savedAt'> & { savedAt?: number }): Promise<void> {
  const savedAt = cache.savedAt ?? Date.now();
  await AsyncStorage.setItem(FLIGHTS_CACHE_KEY, JSON.stringify({ ...cache, savedAt }));
}
