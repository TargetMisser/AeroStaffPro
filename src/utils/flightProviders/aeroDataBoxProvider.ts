import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AirportInfo } from '../airportSettings';
import { getAirlineDisplayName } from '../airlineOps';
import type { FlightScheduleProvider } from './types';

const AERODATABOX_API_MARKET_BASE = 'https://prod.api.market/api/v1/aedbx/aerodatabox';
const AERODATABOX_RAPIDAPI_BASE = 'https://aerodatabox.p.rapidapi.com';
const AERODATABOX_RAPIDAPI_HOST = 'aerodatabox.p.rapidapi.com';
const AERODATABOX_CACHE_KEY = 'aerostaff_aerodatabox_schedule_cache_v1';
const AERODATABOX_CACHE_TTL_MS = 30 * 60 * 1000;

type AeroDataBoxGateway = 'apiMarket' | 'rapidApi';
type Direction = 'arrivals' | 'departures';
type AeroDataBoxFlight = Record<string, any>;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalMinute(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function makeDate(date: Date, hours: number, minutes: number): Date {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function scheduleWindows(now: Date, mode: 'full' | 'futureOnly' = 'full'): Array<{ from: Date; to: Date }> {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const tomorrowWindows = [
    { from: tomorrow, to: makeDate(tomorrow, 12, 0) },
    { from: makeDate(tomorrow, 12, 0), to: makeDate(tomorrow, 23, 59) },
  ];
  if (mode === 'futureOnly') return tomorrowWindows;

  return [
    { from: today, to: makeDate(today, 12, 0) },
    { from: makeDate(today, 12, 0), to: makeDate(today, 23, 59) },
    ...tomorrowWindows,
  ];
}

function sanitizeApiKey(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function apiKeyFingerprint(apiKey: string): string {
  let hash = 0;
  for (let index = 0; index < apiKey.length; index += 1) {
    hash = ((hash << 5) - hash + apiKey.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const cleaned = String(value).trim();
  return cleaned || undefined;
}

function parseAeroDateTime(value: unknown, preferUtc = false): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  if (preferUtc || /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!match) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
  }

  const [, year, month, day, hour, minute] = match;
  const ms = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function movementTime(movement: Record<string, any> | undefined, key: 'scheduledTime' | 'revisedTime' | 'runwayTime' | 'predictedTime'): number | undefined {
  const value = movement?.[key];
  return parseAeroDateTime(value?.utc, true) ?? parseAeroDateTime(value?.local, false);
}

function airportEndpoint(airport: Record<string, any> | undefined, fallback: AirportInfo, fallbackCode: string) {
  const iata = cleanString(airport?.iata)?.toUpperCase() ?? fallbackCode;
  const icao = cleanString(airport?.icao)?.toUpperCase() ?? fallback.icao;
  const name = cleanString(airport?.name)
    ?? cleanString(airport?.shortName)
    ?? cleanString(airport?.municipalityName)
    ?? iata
    ?? fallback.name;
  return {
    name,
    code: {
      ...(iata ? { iata } : {}),
      ...(icao ? { icao } : {}),
    },
  };
}

function oppositeAirportEndpoint(airport: Record<string, any> | undefined) {
  const iata = cleanString(airport?.iata)?.toUpperCase();
  const icao = cleanString(airport?.icao)?.toUpperCase();
  const name = cleanString(airport?.name)
    ?? cleanString(airport?.shortName)
    ?? cleanString(airport?.municipalityName)
    ?? iata
    ?? icao
    ?? 'N/A';
  return {
    name,
    code: {
      ...(iata ? { iata } : {}),
      ...(icao ? { icao } : {}),
    },
  };
}

function statusColor(statusText: unknown, scheduledTs: number | undefined, bestTs: number | undefined): string {
  const status = String(statusText ?? '').toLowerCase();
  if (/cancel|divert/.test(status)) return 'red';
  if (/delay/.test(status)) return 'yellow';
  if (/enroute|checkin|boarding|departed|approaching|arrived|gateclosed/.test(status)) return 'green';
  if (scheduledTs && bestTs && bestTs - scheduledTs > 5 * 60) return 'yellow';
  return 'gray';
}

function flightToScheduleItem(
  item: AeroDataBoxFlight,
  direction: Direction,
  airportCode: string,
  airport: AirportInfo,
): any | null {
  const relevantMovement = direction === 'departures'
    ? item.departure ?? item.movement
    : item.arrival ?? item.movement;
  const oppositeMovement = direction === 'departures'
    ? item.arrival
    : item.departure;
  const scheduledTs = movementTime(relevantMovement, 'scheduledTime');
  if (!scheduledTs) return null;

  const revisedTs = movementTime(relevantMovement, 'revisedTime');
  const predictedTs = movementTime(relevantMovement, 'predictedTime');
  const runwayTs = movementTime(relevantMovement, 'runwayTime');
  const estimatedTs = revisedTs ?? predictedTs ?? runwayTs;
  const status = cleanString(item.status) ?? (estimatedTs && estimatedTs !== scheduledTs ? 'Delayed' : 'Expected');
  const bestTs = estimatedTs ?? scheduledTs;
  const timeField = direction === 'departures' ? 'departure' : 'arrival';
  const flightNumber = cleanString(item.number)?.replace(/\s+/g, '').toUpperCase();
  if (!flightNumber) return null;

  const localAirport = airportEndpoint(relevantMovement?.airport, airport, airportCode);
  const remoteAirport = oppositeAirportEndpoint(oppositeMovement?.airport ?? item.movement?.airport);
  const airlineIata = cleanString(item.airline?.iata)?.toUpperCase();
  const airlineIcao = cleanString(item.airline?.icao)?.toUpperCase();
  const rawAirlineName = cleanString(item.airline?.name);
  const airlineName = getAirlineDisplayName(rawAirlineName ?? airlineIata ?? airlineIcao, rawAirlineName ?? airlineIata ?? 'Sconosciuta');
  const realTs = /departed|arrived/i.test(status) ? (runwayTs ?? revisedTs) : undefined;

  return {
    flight: {
      identification: {
        id: `aerodatabox_${direction}_${flightNumber}_${scheduledTs}`,
        number: { default: flightNumber },
      },
      airline: {
        name: airlineName,
        code: {
          ...(airlineIata ? { iata: airlineIata } : {}),
          ...(airlineIcao ? { icao: airlineIcao } : {}),
        },
      },
      aircraft: {
        registration: cleanString(item.aircraft?.reg),
        model: { code: cleanString(item.aircraft?.model) },
      },
      airport: direction === 'arrivals'
        ? { origin: remoteAirport, destination: localAirport }
        : { origin: localAirport, destination: remoteAirport },
      time: {
        scheduled: { [timeField]: scheduledTs },
        estimated: estimatedTs && estimatedTs !== scheduledTs ? { [timeField]: estimatedTs } : {},
        real: realTs ? { [timeField]: realTs } : {},
      },
      status: {
        text: status,
        generic: { status: { color: statusColor(status, scheduledTs, bestTs) } },
      },
      _operational: {
        departureTerminal: cleanString(item.departure?.terminal),
        departureGate: cleanString(item.departure?.gate),
        checkin: cleanString(item.departure?.checkInDesk),
        arrivalTerminal: cleanString(item.arrival?.terminal),
        arrivalGate: cleanString(item.arrival?.gate),
        belt: cleanString(item.arrival?.baggageBelt),
      },
      _source: 'aerodatabox',
    },
  };
}

async function loadCachedWindow(cacheKey: string): Promise<{ arrivals: any[]; departures: any[] } | null> {
  try {
    const raw = await AsyncStorage.getItem(AERODATABOX_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const entry = cache?.[cacheKey];
    if (!entry || Date.now() - entry.savedAt > AERODATABOX_CACHE_TTL_MS) return null;
    if (!Array.isArray(entry.arrivals) || !Array.isArray(entry.departures)) return null;
    return { arrivals: entry.arrivals, departures: entry.departures };
  } catch {
    return null;
  }
}

async function saveCachedWindow(cacheKey: string, arrivals: any[], departures: any[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AERODATABOX_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[cacheKey] = { savedAt: Date.now(), arrivals, departures };
    await AsyncStorage.setItem(AERODATABOX_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function buildScheduleUrl(gateway: AeroDataBoxGateway, airportCode: string, from: Date, to: Date): string {
  const base = gateway === 'rapidApi' ? AERODATABOX_RAPIDAPI_BASE : AERODATABOX_API_MARKET_BASE;
  const path = [
    'flights',
    'airports',
    'iata',
    airportCode,
    toLocalMinute(from),
    toLocalMinute(to),
  ].map(encodeURIComponent).join('/');
  const params = new URLSearchParams({
    direction: 'Both',
    withLeg: 'true',
    withCancelled: 'true',
    withCodeshared: 'false',
    withCargo: 'false',
    withPrivate: 'false',
    withLocation: 'false',
  });
  return `${base}/${path}?${params.toString()}`;
}

function buildHeaders(gateway: AeroDataBoxGateway, apiKey: string): Record<string, string> {
  if (gateway === 'rapidApi') {
    return {
      Accept: 'application/json',
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': AERODATABOX_RAPIDAPI_HOST,
    };
  }

  return {
    Accept: 'application/json',
    'x-magicapi-key': apiKey,
  };
}

async function fetchWindow(
  airportCode: string,
  airport: AirportInfo,
  gateway: AeroDataBoxGateway,
  apiKey: string,
  from: Date,
  to: Date,
  signal?: AbortSignal,
): Promise<{ arrivals: any[]; departures: any[] }> {
  const cacheKey = `${gateway}:${airportCode}:${toLocalMinute(from)}:${toLocalMinute(to)}:${apiKeyFingerprint(apiKey)}`;
  const cached = await loadCachedWindow(cacheKey);
  if (cached) return cached;

  const res = await fetch(buildScheduleUrl(gateway, airportCode, from, to), {
    headers: buildHeaders(gateway, apiKey),
    signal,
  });
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`AERODATABOX_HTTP_${res.status}`);
  }

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('AERODATABOX_INVALID_JSON_RESPONSE');
  }

  const departures = (Array.isArray(json.departures) ? json.departures : [])
    .map((item: AeroDataBoxFlight) => flightToScheduleItem(item, 'departures', airportCode, airport))
    .filter((item: any) => item !== null);
  const arrivals = (Array.isArray(json.arrivals) ? json.arrivals : [])
    .map((item: AeroDataBoxFlight) => flightToScheduleItem(item, 'arrivals', airportCode, airport))
    .filter((item: any) => item !== null);

  await saveCachedWindow(cacheKey, arrivals, departures);
  return { arrivals, departures };
}

export const aeroDataBoxProvider: FlightScheduleProvider = {
  id: 'aeroDataBox',
  label: 'AeroDataBox',
  supports: ({ aeroDataBoxApiKey }) => Boolean(aeroDataBoxApiKey),
  unavailableMessage: () => 'AeroDataBox API key non configurata',
  fetch: async ({ airportCode, airport, aeroDataBoxApiKey, aeroDataBoxGateway = 'apiMarket', aeroDataBoxMode = 'full', signal, now = new Date() }) => {
    const apiKey = sanitizeApiKey(aeroDataBoxApiKey);
    if (!apiKey) throw new Error('AERODATABOX_API_KEY_MISSING');

    const arrivals: any[] = [];
    const departures: any[] = [];
    const failures: string[] = [];

    // Sequential requests avoid AsyncStorage write races between cached windows.
    for (const window of scheduleWindows(now, aeroDataBoxMode)) {
      try {
        const result = await fetchWindow(airportCode, airport, aeroDataBoxGateway, apiKey, window.from, window.to, signal);
        arrivals.push(...result.arrivals);
        departures.push(...result.departures);
      } catch (error) {
        failures.push(String(error));
      }
    }

    if (arrivals.length + departures.length === 0 && failures.length > 0) {
      throw new Error(`AERODATABOX_FAILED ${failures.join(' | ')}`);
    }

    return { allArrivals: arrivals, allDepartures: departures };
  },
};
