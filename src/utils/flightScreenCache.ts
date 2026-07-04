import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FlightScheduleProviderStatus } from './flightProviders';
import { getBestArrivalTs, getBestDepartureTs } from './flightTimes';

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
  isStale?: boolean;
  providerDiagnostics?: FlightScheduleProviderStatus[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isSameLocalDay(ts: number | undefined, nowMs: number): boolean {
  if (!ts) return false;
  const value = new Date(ts * 1000);
  const now = new Date(nowMs);
  return value.getFullYear() === now.getFullYear()
    && value.getMonth() === now.getMonth()
    && value.getDate() === now.getDate();
}

function hasFlightsForLocalDay(arrivals: any[], departures: any[], nowMs: number): boolean {
  return arrivals.some(item => isSameLocalDay(getBestArrivalTs(item), nowMs))
    || departures.some(item => isSameLocalDay(getBestDepartureTs(item), nowMs));
}

export function sanitizeFlightScreenCache(
  value: unknown,
  airportCode: string,
  nowMs = Date.now(),
  ttlMs = FLIGHT_SCREEN_CACHE_TTL_MS,
  allowStaleSameDay = false,
): FlightScreenCache | null {
  if (!isRecord(value)) return null;
  const cachedAirport = typeof value.airportCode === 'string' ? value.airportCode.toUpperCase() : airportCode;
  if (cachedAirport !== airportCode.toUpperCase()) return null;

  const savedAt = readTimestamp(value.savedAt, readTimestamp(value.fetchedAt, nowMs));
  const arrivals = Array.isArray(value.arrivals) ? value.arrivals : [];
  const departures = Array.isArray(value.departures) ? value.departures : [];
  const isStale = nowMs - savedAt > ttlMs;
  if (isStale && (!allowStaleSameDay || !hasFlightsForLocalDay(arrivals, departures, nowMs))) {
    return null;
  }

  return {
    airportCode: cachedAirport,
    arrivals,
    departures,
    sourceLabel: typeof value.sourceLabel === 'string' && value.sourceLabel.trim()
      ? value.sourceLabel
      : 'Cache voli',
    fetchedAt: readTimestamp(value.fetchedAt, savedAt),
    savedAt,
    isStale,
    providerDiagnostics: Array.isArray(value.providerDiagnostics)
      ? value.providerDiagnostics as FlightScheduleProviderStatus[]
      : undefined,
  };
}

async function readCacheKey(
  key: string,
  airportCode: string,
  allowStaleSameDay: boolean,
): Promise<FlightScreenCache | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return sanitizeFlightScreenCache(
      JSON.parse(raw),
      airportCode,
      Date.now(),
      FLIGHT_SCREEN_CACHE_TTL_MS,
      allowStaleSameDay,
    );
  } catch {
    return null;
  }
}

export async function loadFlightScreenCache(
  airportCode: string,
  allowStaleSameDay = false,
): Promise<FlightScreenCache | null> {
  return await readCacheKey(FLIGHTS_CACHE_KEY, airportCode, allowStaleSameDay)
    ?? await readCacheKey(LEGACY_FLIGHTS_CACHE_KEY, airportCode, allowStaleSameDay);
}

export async function saveFlightScreenCache(cache: Omit<FlightScreenCache, 'savedAt'> & { savedAt?: number }): Promise<void> {
  const savedAt = cache.savedAt ?? Date.now();
  await AsyncStorage.setItem(FLIGHTS_CACHE_KEY, JSON.stringify({ ...cache, savedAt }));
}
