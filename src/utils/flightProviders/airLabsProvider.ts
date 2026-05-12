import AsyncStorage from '@react-native-async-storage/async-storage';
import { AIRLINE_DISPLAY_NAMES } from '../airlineOps';
import type { FlightScheduleProvider } from './types';

const AIRLABS_API_BASE = 'https://airlabs.co/api/v9/schedules';
const AIRLABS_ROUTES_API_BASE = 'https://airlabs.co/api/v9/routes';
const AIRLABS_LIMIT = 50;
const AIRLABS_ROUTES_CACHE_KEY = 'aerostaff_airlabs_routes_cache_v1';
const AIRLABS_ROUTES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DAYS_OF_WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type AirLabsScheduleItem = Record<string, any>;
type AirLabsRouteItem = Record<string, any>;

const AIRLINE_NAME_BY_IATA: Record<string, string> = {
  '3O': 'Air Arabia Maroc',
  '9H': 'Wizz Air Malta',
  AZ: 'ITA Airways',
  BA: AIRLINE_DISPLAY_NAMES['british airways'],
  DS: AIRLINE_DISPLAY_NAMES.easyjet,
  EC: AIRLINE_DISPLAY_NAMES.easyjet,
  EI: AIRLINE_DISPLAY_NAMES['aer lingus'],
  EN: 'Air Dolomiti',
  EW: 'Eurowings',
  FR: AIRLINE_DISPLAY_NAMES.ryanair,
  FZ: AIRLINE_DISPLAY_NAMES.flydubai,
  G9: 'Air Arabia',
  HV: AIRLINE_DISPLAY_NAMES.transavia,
  LH: 'Lufthansa',
  QY: 'DHL',
  RR: 'Buzz',
  SK: AIRLINE_DISPLAY_NAMES.sas,
  TO: AIRLINE_DISPLAY_NAMES.transavia,
  U2: AIRLINE_DISPLAY_NAMES.easyjet,
  V7: AIRLINE_DISPLAY_NAMES.volotea,
  VY: AIRLINE_DISPLAY_NAMES.vueling,
  W4: 'Wizz Air Malta',
  W6: AIRLINE_DISPLAY_NAMES.wizz,
  W9: 'Wizz Air UK',
  XZ: 'Aeroitalia',
};

function buildAirLabsUrl(paramName: 'dep_iata' | 'arr_iata', airportCode: string, apiKey: string): string {
  const params = [
    ['api_key', apiKey],
    [paramName, airportCode],
    ['limit', String(AIRLABS_LIMIT)],
  ];
  return `${AIRLABS_API_BASE}?${params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`;
}

function buildAirLabsRoutesUrl(paramName: 'dep_iata' | 'arr_iata', airportCode: string, apiKey: string): string {
  const fields = [
    'airline_iata',
    'airline_icao',
    'flight_iata',
    'flight_icao',
    'flight_number',
    'dep_iata',
    'dep_icao',
    'dep_time',
    'dep_terminals',
    'arr_iata',
    'arr_icao',
    'arr_time',
    'arr_terminals',
    'duration',
    'days',
    'aircraft_icao',
  ].join(',');
  const params = [
    ['api_key', apiKey],
    [paramName, airportCode],
    ['limit', String(AIRLABS_LIMIT)],
    ['_fields', fields],
  ];
  return `${AIRLABS_ROUTES_API_BASE}?${params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? 'unknown_error');
}

function parseUnixTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return parseUnixTimestamp(Number(value));
  }
  return undefined;
}

function parseAirLabsDateTime(value: unknown, utc = false): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!match) return undefined;

  const [, y, mo, d, h, mi] = match;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const ms = utc
    ? Date.UTC(year, month, day, hour, minute, 0, 0)
    : new Date(year, month, day, hour, minute, 0, 0).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function readTime(item: AirLabsScheduleItem, localField: string): number | undefined {
  return parseUnixTimestamp(item[`${localField}_ts`])
    ?? parseAirLabsDateTime(item[`${localField}_utc`], true)
    ?? parseAirLabsDateTime(item[localField], false);
}

function airportEndpoint(code: unknown, icao: unknown) {
  const iataCode = typeof code === 'string' ? code.toUpperCase() : undefined;
  const icaoCode = typeof icao === 'string' ? icao.toUpperCase() : undefined;
  const name = iataCode || icaoCode || 'N/A';
  return {
    name,
    code: {
      ...(iataCode ? { iata: iataCode } : {}),
      ...(icaoCode ? { icao: icaoCode } : {}),
    },
  };
}

function normalizeFlightNumber(item: AirLabsScheduleItem): string {
  const explicit = typeof item.flight_iata === 'string' ? item.flight_iata.trim() : '';
  if (explicit) return explicit.replace(/\s+/g, '');

  const airline = typeof item.airline_iata === 'string' ? item.airline_iata.trim().toUpperCase() : '';
  const number = typeof item.flight_number === 'string' || typeof item.flight_number === 'number'
    ? String(item.flight_number).trim()
    : '';
  return `${airline}${number}`.replace(/\s+/g, '') || 'N/A';
}

function statusColor(statusText: unknown, scheduledTs: number | undefined, bestTs: number | undefined): string {
  const status = typeof statusText === 'string' ? statusText.toLowerCase() : '';
  if (/cancel/.test(status)) return 'red';
  if (/delay/.test(status)) return 'yellow';
  if (/active|landed|boarding|departed/.test(status)) return 'green';
  if (scheduledTs && bestTs && bestTs - scheduledTs > 5 * 60) return 'yellow';
  return 'gray';
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const cleaned = String(value).trim();
  return cleaned || undefined;
}

function firstCleanString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const cleaned = cleanString(item);
      if (cleaned) return cleaned;
    }
    return undefined;
  }

  return cleanString(value);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toLocalIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayCode(date: Date): string {
  return DAYS_OF_WEEK[date.getDay()];
}

function normalizeRouteDays(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeRouteDays);
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return [];
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) return [];
  if (/^(daily|everyday|all)$/.test(raw)) return [...DAYS_OF_WEEK];

  const tokens = raw.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.flatMap(token => {
    if (DAYS_OF_WEEK.includes(token as any)) return [token];
    if (/^[0-7]+$/.test(token)) {
      return token.split('').map(char => {
        const numeric = Number(char);
        if (numeric === 0 || numeric === 7) return 'sun';
        return DAYS_OF_WEEK[numeric] ?? '';
      }).filter(Boolean);
    }
    return [];
  });
}

function parseClock(value: unknown): { hours: number; minutes: number } | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

function timestampForLocalClock(baseDate: Date, value: unknown): number | undefined {
  const clock = parseClock(value);
  if (!clock) return undefined;

  const date = new Date(baseDate);
  date.setHours(clock.hours, clock.minutes, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function isSameLocalDay(ts: number | undefined, date: Date): boolean {
  if (!ts) return false;
  const actual = new Date(ts * 1000);
  return actual.getFullYear() === date.getFullYear()
    && actual.getMonth() === date.getMonth()
    && actual.getDate() === date.getDate();
}

function routeRunsOn(route: AirLabsRouteItem, departureDate: Date): boolean {
  const days = normalizeRouteDays(route.days);
  return days.includes(dayCode(departureDate));
}

function normalizeRouteFlightNumber(item: AirLabsRouteItem): string {
  const explicit = typeof item.flight_iata === 'string' ? item.flight_iata.trim() : '';
  if (explicit) return explicit.replace(/\s+/g, '');

  const airline = typeof item.airline_iata === 'string' ? item.airline_iata.trim().toUpperCase() : '';
  const number = typeof item.flight_number === 'string' || typeof item.flight_number === 'number'
    ? String(item.flight_number).trim()
    : '';
  return `${airline}${number}`.replace(/\s+/g, '') || 'N/A';
}

function buildRouteArrivalTs(route: AirLabsRouteItem, departureDate: Date, departureTs: number): number | undefined {
  const duration = typeof route.duration === 'number' && Number.isFinite(route.duration) && route.duration > 0
    ? Math.round(route.duration)
    : undefined;
  if (duration) return departureTs + duration * 60;

  let arrivalDate = new Date(departureDate);
  const departureClock = parseClock(route.dep_time);
  const arrivalClock = parseClock(route.arr_time);
  if (departureClock && arrivalClock) {
    const depMinutes = departureClock.hours * 60 + departureClock.minutes;
    const arrMinutes = arrivalClock.hours * 60 + arrivalClock.minutes;
    if (arrMinutes < depMinutes) {
      arrivalDate = addDays(arrivalDate, 1);
    }
  }

  return timestampForLocalClock(arrivalDate, route.arr_time);
}

function routeToScheduleItem(
  route: AirLabsRouteItem,
  direction: 'arrivals' | 'departures',
  targetDate: Date,
  departureDate: Date,
): any | null {
  if (!routeRunsOn(route, departureDate)) return null;

  const departureTs = timestampForLocalClock(departureDate, route.dep_time);
  if (!departureTs) return null;

  const routeArrivalTs = buildRouteArrivalTs(route, departureDate, departureTs);
  const arrivalTs = direction === 'arrivals'
    ? (isSameLocalDay(routeArrivalTs, targetDate)
        ? timestampForLocalClock(targetDate, route.arr_time) ?? routeArrivalTs
        : undefined)
    : routeArrivalTs;

  if (direction === 'arrivals' && !isSameLocalDay(arrivalTs, targetDate)) {
    return null;
  }

  if (direction === 'departures' && !isSameLocalDay(departureTs, targetDate)) {
    return null;
  }

  const timeField = direction === 'arrivals' ? 'arrival' : 'departure';
  const scheduledTs = direction === 'arrivals' ? arrivalTs : departureTs;
  if (!scheduledTs) return null;

  const flightNumber = normalizeRouteFlightNumber(route);
  const airlineIata = cleanString(route.airline_iata)?.toUpperCase();
  const airlineIcao = cleanString(route.airline_icao)?.toUpperCase();
  const airlineName = airlineIata ? AIRLINE_NAME_BY_IATA[airlineIata] : undefined;
  const depAirport = airportEndpoint(route.dep_iata, route.dep_icao);
  const arrAirport = airportEndpoint(route.arr_iata, route.arr_icao);

  return {
    flight: {
      identification: {
        id: `airlabs_routes_${direction}_${flightNumber}_${scheduledTs}`,
        number: { default: flightNumber },
      },
      airline: {
        name: airlineName ?? (airlineIata ? `Compagnia ${airlineIata}` : 'Sconosciuta'),
        code: {
          ...(airlineIata ? { iata: airlineIata } : {}),
          ...(airlineIcao ? { icao: airlineIcao } : {}),
        },
      },
      aircraft: {
        model: { code: cleanString(route.aircraft_icao) },
      },
      airport: {
        origin: depAirport,
        destination: arrAirport,
      },
      time: {
        scheduled: {
          ...(departureTs ? { departure: departureTs } : {}),
          ...(arrivalTs ? { arrival: arrivalTs } : {}),
          [timeField]: scheduledTs,
        },
        estimated: {},
        real: {},
      },
      status: {
        text: 'Scheduled',
        generic: { status: { color: 'gray' } },
      },
      _operational: {
        departureTerminal: firstCleanString(route.dep_terminals),
        arrivalTerminal: firstCleanString(route.arr_terminals),
      },
      _source: 'airlabs_routes',
    },
  };
}

function itemToScheduleItem(
  item: AirLabsScheduleItem,
  direction: 'arrivals' | 'departures',
): any | null {
  const timePrefix = direction === 'arrivals' ? 'arr' : 'dep';
  const timeField = direction === 'arrivals' ? 'arrival' : 'departure';
  const scheduledTs = readTime(item, `${timePrefix}_time`);
  if (!scheduledTs) return null;

  const estimatedTs = readTime(item, `${timePrefix}_estimated`);
  const actualTs = readTime(item, `${timePrefix}_actual`);
  const bestTs = actualTs ?? estimatedTs ?? scheduledTs;
  const flightNumber = normalizeFlightNumber(item);
  const airlineIata = cleanString(item.airline_iata)?.toUpperCase();
  const airlineIcao = cleanString(item.airline_icao)?.toUpperCase();
  const airlineName = airlineIata ? AIRLINE_NAME_BY_IATA[airlineIata] : undefined;
  const depAirport = airportEndpoint(item.dep_iata, item.dep_icao);
  const arrAirport = airportEndpoint(item.arr_iata, item.arr_icao);
  const status = cleanString(item.status) ?? (estimatedTs && estimatedTs !== scheduledTs ? 'delayed' : 'scheduled');

  return {
    flight: {
      identification: {
        id: `airlabs_${direction}_${flightNumber}_${scheduledTs}`,
        number: { default: flightNumber },
      },
      airline: {
        name: airlineName ?? (airlineIata ? `Compagnia ${airlineIata}` : 'Sconosciuta'),
        code: {
          ...(airlineIata ? { iata: airlineIata } : {}),
          ...(airlineIcao ? { icao: airlineIcao } : {}),
        },
      },
      aircraft: {
        model: { code: cleanString(item.aircraft_icao) },
      },
      airport: {
        origin: depAirport,
        destination: arrAirport,
      },
      time: {
        scheduled: { [timeField]: scheduledTs },
        estimated: estimatedTs ? { [timeField]: estimatedTs } : {},
        real: actualTs ? { [timeField]: actualTs } : {},
      },
      status: {
        text: status,
        generic: { status: { color: statusColor(status, scheduledTs, bestTs) } },
      },
      _operational: {
        departureGate: cleanString(item.dep_gate),
        departureTerminal: cleanString(item.dep_terminal),
        arrivalGate: cleanString(item.arr_gate),
        arrivalTerminal: cleanString(item.arr_terminal),
        belt: cleanString(item.arr_baggage),
      },
      _source: 'airlabs',
    },
  };
}

async function fetchAirLabsDirection(
  airportCode: string,
  direction: 'arrivals' | 'departures',
  apiKey: string,
  signal?: AbortSignal,
): Promise<any[]> {
  const paramName = direction === 'arrivals' ? 'arr_iata' : 'dep_iata';
  const res = await fetch(buildAirLabsUrl(paramName, airportCode, apiKey), {
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`AIRLABS_HTTP_${res.status}`);
  }

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('AIRLABS_INVALID_JSON_RESPONSE');
  }

  if (json?.error) {
    const code = json.error.code ? `AIRLABS_${String(json.error.code).toUpperCase()}` : 'AIRLABS_ERROR';
    throw new Error(`${code}: ${json.error.message ?? 'Unknown AirLabs error'}`);
  }

  const response = Array.isArray(json) ? json : json?.response;
  if (!Array.isArray(response)) {
    throw new Error('AIRLABS_UNEXPECTED_RESPONSE');
  }

  return response
    .map(item => itemToScheduleItem(item, direction))
    .filter((item): item is any => item !== null);
}

async function loadCachedRoutePredictions(cacheKey: string): Promise<any[] | null> {
  try {
    const raw = await AsyncStorage.getItem(AIRLABS_ROUTES_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const entry = cache?.[cacheKey];
    if (!entry || Date.now() - entry.savedAt > AIRLABS_ROUTES_CACHE_TTL_MS) return null;
    return Array.isArray(entry.flights) ? entry.flights : null;
  } catch {
    return null;
  }
}

async function saveCachedRoutePredictions(cacheKey: string, flights: any[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AIRLABS_ROUTES_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[cacheKey] = { savedAt: Date.now(), flights };
    await AsyncStorage.setItem(AIRLABS_ROUTES_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

async function fetchAirLabsRoutePredictions(
  airportCode: string,
  direction: 'arrivals' | 'departures',
  apiKey: string,
  targetDate: Date,
  signal?: AbortSignal,
): Promise<any[]> {
  const cacheKey = `${airportCode}:${direction}:${toLocalIso(targetDate)}`;
  const cached = await loadCachedRoutePredictions(cacheKey);
  if (cached) return cached;

  const paramName = direction === 'arrivals' ? 'arr_iata' : 'dep_iata';
  const res = await fetch(buildAirLabsRoutesUrl(paramName, airportCode, apiKey), {
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`AIRLABS_ROUTES_HTTP_${res.status}`);
  }

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('AIRLABS_ROUTES_INVALID_JSON_RESPONSE');
  }

  if (json?.error) {
    const code = json.error.code ? `AIRLABS_ROUTES_${String(json.error.code).toUpperCase()}` : 'AIRLABS_ROUTES_ERROR';
    throw new Error(`${code}: ${json.error.message ?? 'Unknown AirLabs routes error'}`);
  }

  const response = Array.isArray(json) ? json : json?.response;
  if (!Array.isArray(response)) {
    throw new Error('AIRLABS_ROUTES_UNEXPECTED_RESPONSE');
  }

  const candidateDepartureDates = direction === 'arrivals'
    ? [targetDate, addDays(targetDate, -1)]
    : [targetDate];
  const flights = response
    .flatMap(route => candidateDepartureDates.map(departureDate =>
      routeToScheduleItem(route, direction, targetDate, departureDate),
    ))
    .filter((item): item is any => item !== null);

  await saveCachedRoutePredictions(cacheKey, flights);
  return flights;
}

function flightMergeKey(item: any, timeField: 'arrival' | 'departure'): string {
  const flightNumber = item.flight?.identification?.number?.default ?? '';
  const ts = item.flight?.time?.scheduled?.[timeField] ?? '';
  return `${flightNumber}_${ts}`;
}

function mergePredictedAndLiveFlights(predicted: any[], live: any[], timeField: 'arrival' | 'departure'): any[] {
  const map = new Map<string, any>();
  for (const item of predicted) map.set(flightMergeKey(item, timeField), item);
  for (const item of live) map.set(flightMergeKey(item, timeField), item);
  return Array.from(map.values());
}

export const airLabsProvider: FlightScheduleProvider = {
  id: 'airlabs',
  label: 'AirLabs',
  supports: ({ airLabsApiKey }) => Boolean(airLabsApiKey),
  unavailableMessage: () => 'AirLabs API key non configurata',
  fetch: async ({ airportCode, airLabsApiKey, signal, now = new Date() }) => {
    if (!airLabsApiKey) throw new Error('AIRLABS_API_KEY_MISSING');

    const tomorrow = addDays(now, 1);
    tomorrow.setHours(0, 0, 0, 0);

    const [departuresResult, arrivalsResult, routeDeparturesResult, routeArrivalsResult] = await Promise.allSettled([
      fetchAirLabsDirection(airportCode, 'departures', airLabsApiKey, signal),
      fetchAirLabsDirection(airportCode, 'arrivals', airLabsApiKey, signal),
      fetchAirLabsRoutePredictions(airportCode, 'departures', airLabsApiKey, tomorrow, signal),
      fetchAirLabsRoutePredictions(airportCode, 'arrivals', airLabsApiKey, tomorrow, signal),
    ]);

    const liveDepartures = departuresResult.status === 'fulfilled' ? departuresResult.value : [];
    const liveArrivals = arrivalsResult.status === 'fulfilled' ? arrivalsResult.value : [];
    const routeDepartures = routeDeparturesResult.status === 'fulfilled' ? routeDeparturesResult.value : [];
    const routeArrivals = routeArrivalsResult.status === 'fulfilled' ? routeArrivalsResult.value : [];
    const allDepartures = mergePredictedAndLiveFlights(routeDepartures, liveDepartures, 'departure');
    const allArrivals = mergePredictedAndLiveFlights(routeArrivals, liveArrivals, 'arrival');

    if (
      departuresResult.status === 'rejected'
      && arrivalsResult.status === 'rejected'
      && routeDeparturesResult.status === 'rejected'
      && routeArrivalsResult.status === 'rejected'
    ) {
      throw new Error(
        `AIRLABS_FAILED D:${errorMessage(departuresResult.reason)} A:${errorMessage(arrivalsResult.reason)} RD:${errorMessage(routeDeparturesResult.reason)} RA:${errorMessage(routeArrivalsResult.reason)}`,
      );
    }

    if (allArrivals.length + allDepartures.length === 0) {
      throw new Error('AIRLABS_EMPTY_SCHEDULE');
    }

    return { allArrivals, allDepartures };
  },
};
