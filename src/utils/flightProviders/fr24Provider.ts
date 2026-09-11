import { buildFr24ScheduleUrl } from '../airportSettings';
import type { AirportInfo } from '../airportSettings';
import { getAirlineDisplayName } from '../airlineOps';
import {
  getCanonicalFlightNumberIdentity,
  isFlightServiceMatch,
  type FlightDirection,
} from '../flightScheduleAdapter';
import type { FlightScheduleProvider } from './types';

const FR24_API_BASE = 'https://fr24api.flightradar24.com/api/live/flight-positions/full';
const FR24_IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;
const FR24_IDENTITY_TIMEOUT_MS = 6_000;

type Direction = 'arrivals' | 'departures';
type PublicFr24Schedule = { allArrivals: any[]; allDepartures: any[] };
const publicIdentityCache = new Map<string, { fetchedAt: number; schedule: PublicFr24Schedule }>();
const publicIdentityRequests = new Map<string, Promise<PublicFr24Schedule>>();

function toUnixSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

function airportEndpoint(name: string, iata?: string, icao?: string) {
  return {
    name,
    code: {
      ...(iata ? { iata } : {}),
      ...(icao ? { icao } : {}),
    },
  };
}

async function fetchPublicFr24Schedule(airportCode: string, signal?: AbortSignal): Promise<PublicFr24Schedule> {
  const res = await fetch(buildFr24ScheduleUrl(airportCode), {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json,text/plain,*/*',
    },
    signal,
  });
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`FR24_PUBLIC_HTTP_${res.status}`);
  }
  if (/^\s*</.test(body) || /cloudflare|just a moment|enable javascript/i.test(body)) {
    throw new Error('FR24_PUBLIC_BLOCKED_OR_HTML_RESPONSE');
  }

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('FR24_PUBLIC_INVALID_JSON_RESPONSE');
  }

  const schedule = {
    allArrivals: (json.result?.response?.airport?.pluginData?.schedule?.arrivals?.data || []).map(normalizePublicScheduleItem),
    allDepartures: (json.result?.response?.airport?.pluginData?.schedule?.departures?.data || []).map(normalizePublicScheduleItem),
  };
  publicIdentityCache.set(airportCode.toUpperCase(), { fetchedAt: Date.now(), schedule });
  return schedule;
}

async function loadPublicFr24IdentitySchedule(airportCode: string): Promise<PublicFr24Schedule> {
  const key = airportCode.toUpperCase();
  const cached = publicIdentityCache.get(key);
  if (cached && Date.now() - cached.fetchedAt <= FR24_IDENTITY_CACHE_TTL_MS) {
    return cached.schedule;
  }

  const inFlight = publicIdentityRequests.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FR24_IDENTITY_TIMEOUT_MS);
    try {
      return await fetchPublicFr24Schedule(key, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  })();
  publicIdentityRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (publicIdentityRequests.get(key) === request) publicIdentityRequests.delete(key);
  }
}

function buildOfficialLiveUrl(airportCode: string, direction: Direction, flights?: string[]): string {
  const params = new URLSearchParams({
    airports: `${direction === 'arrivals' ? 'inbound' : 'outbound'}:${airportCode}`,
    limit: flights ? String(flights.length) : '300',
  });
  if (flights) params.set('flights', flights.join(','));
  return `${FR24_API_BASE}?${params.toString()}`;
}

function bearerToken(apiKey: string): string {
  return apiKey.trim().replace(/^Bearer\s+/i, '');
}

async function fetchOfficialLiveDirection(
  airportCode: string,
  direction: Direction,
  apiKey: string,
  signal?: AbortSignal,
  flights?: string[],
): Promise<any[]> {
  const res = await fetch(buildOfficialLiveUrl(airportCode, direction, flights), {
    headers: {
      Accept: 'application/json',
      'Accept-Version': 'v1',
      Authorization: `Bearer ${bearerToken(apiKey)}`,
    },
    signal,
  });
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`FR24_API_${direction.toUpperCase()}_HTTP_${res.status}`);
  }

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`FR24_API_${direction.toUpperCase()}_INVALID_JSON_RESPONSE`);
  }

  return Array.isArray(json.data) ? json.data : [];
}

function airlineCodeFromFlightNumber(flightNumber: string): string {
  return flightNumber.toUpperCase().match(/^([A-Z0-9]{2,3}?)(?=\d)/)?.[1] ?? '';
}

function normalizeAirlineLabel(...values: unknown[]): string {
  const identity = values
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .map(value => String(value))
    .join(' ');
  return getAirlineDisplayName(identity, 'Sconosciuta');
}

function normalizeFr24Id(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{6,16}$/.test(normalized) ? normalized : undefined;
}

function normalizePublicScheduleItem(item: any): any {
  const flight = item?.flight;
  const airline = flight?.airline;
  if (!flight) return item;
  const fr24Id = normalizeFr24Id(flight.identification?.id);

  return {
    ...item,
    flight: {
      ...flight,
      ...(airline ? {
        airline: {
          ...airline,
          name: normalizeAirlineLabel(
            airline.name,
            airline.code?.iata,
            airline.code?.icao,
            flight.identification?.number?.default,
          ),
        },
      } : {}),
      ...(fr24Id ? { _fr24Id: fr24Id } : {}),
    },
  };
}

function officialLiveFlightToScheduleItem(
  item: Record<string, any>,
  direction: Direction,
  airportCode: string,
  airport: AirportInfo,
): any | null {
  const publishedFlightNumber = String(item.flight ?? '').trim().toUpperCase();
  const canonicalCallsign = getCanonicalFlightNumberIdentity(item.callsign);
  const flightNumber = publishedFlightNumber
    || (/^[A-Z0-9]{2}\d+$/.test(canonicalCallsign) ? canonicalCallsign : '');
  if (!flightNumber) return null;

  const etaTs = toUnixSeconds(item.eta);
  const positionTs = toUnixSeconds(item.timestamp);
  const timeField = direction === 'arrivals' ? 'arrival' : 'departure';
  // FR24's live-position `eta` is always the aircraft's arrival at its
  // destination. It is therefore authoritative only for inbound rows; on an
  // outbound row it must never be presented as an estimated departure.
  const authoritativeArrivalEtaTs = direction === 'arrivals' ? etaTs : undefined;
  const scheduledTs = direction === 'arrivals'
    ? etaTs ?? positionTs
    : positionTs;

  if (!scheduledTs) return null;

  const airlineCode = airlineCodeFromFlightNumber(flightNumber);
  const fr24Id = normalizeFr24Id(item.fr24_id);
  const localAirport = airportEndpoint(airport.name, airportCode, airport.icao);
  const remoteAirport = direction === 'arrivals'
    ? airportEndpoint(item.orig_iata ?? item.orig_icao ?? 'N/A', item.orig_iata, item.orig_icao)
    : airportEndpoint(item.dest_iata ?? item.dest_icao ?? 'N/A', item.dest_iata, item.dest_icao);
  const statusText = direction === 'arrivals'
    ? etaTs ? 'Stimato FR24 API' : 'Live FR24 API'
    : 'In volo FR24 API';

  return {
    flight: {
      identification: {
        id: `fr24api_${direction}_${item.fr24_id ?? flightNumber}_${scheduledTs}`,
        number: { default: flightNumber },
      },
      airline: {
        name: normalizeAirlineLabel(item.operating_as, item.painted_as, airlineCode, flightNumber),
        code: { iata: airlineCode },
      },
      aircraft: {
        registration: item.reg,
        model: { code: item.type },
      },
      airport: direction === 'arrivals'
        ? { origin: remoteAirport, destination: localAirport }
        : { origin: localAirport, destination: remoteAirport },
      time: {
        scheduled: { [timeField]: scheduledTs },
        estimated: authoritativeArrivalEtaTs ? { arrival: authoritativeArrivalEtaTs } : {},
        real: {},
      },
      status: {
        text: statusText,
        generic: { status: { color: direction === 'departures' ? 'green' : 'gray' } },
      },
      _source: 'fr24_api',
      _scheduledSource: direction === 'departures' ? 'fr24_api_live_position' : 'fr24_api_live_eta',
      _scheduledSynthetic: true,
      ...(fr24Id ? { _fr24Id: fr24Id } : {}),
      ...(authoritativeArrivalEtaTs ? { _etaSource: 'fr24_api' as const } : {}),
      ...(positionTs ? { _etaObservedAt: positionTs * 1000 } : {}),
    },
  };
}

async function fetchOfficialFr24LiveSchedule(
  airportCode: string,
  airport: AirportInfo,
  apiKey: string,
  signal?: AbortSignal,
) {
  const [departuresResult, arrivalsResult] = await Promise.allSettled([
    fetchOfficialLiveDirection(airportCode, 'departures', apiKey, signal),
    fetchOfficialLiveDirection(airportCode, 'arrivals', apiKey, signal),
  ]);

  if (departuresResult.status === 'rejected' && arrivalsResult.status === 'rejected') {
    throw new Error(`FR24_API_FAILED D:${String(departuresResult.reason)} A:${String(arrivalsResult.reason)}`);
  }

  const allDepartures = departuresResult.status === 'fulfilled'
    ? departuresResult.value
        .map(item => officialLiveFlightToScheduleItem(item, 'departures', airportCode, airport))
        .filter((item): item is any => item !== null)
    : [];
  const allArrivals = arrivalsResult.status === 'fulfilled'
    ? arrivalsResult.value
        .map(item => officialLiveFlightToScheduleItem(item, 'arrivals', airportCode, airport))
        .filter((item): item is any => item !== null)
    : [];

  if (allArrivals.length + allDepartures.length === 0) {
    throw new Error('FR24_API_EMPTY_LIVE_POSITIONS');
  }

  return { allArrivals, allDepartures };
}

export async function fetchFr24ArrivalUpdates(
  airportCode: string, airport: AirportInfo, apiKey: string, flights: string[], signal?: AbortSignal,
): Promise<any[]> {
  if (!flights.length || signal?.aborted) return [];
  const items = await fetchOfficialLiveDirection(airportCode, 'arrivals', apiKey, signal, flights);
  return items.map(item => officialLiveFlightToScheduleItem(item, 'arrivals', airportCode, airport))
    .filter(item => item !== null);
}

function flightNumberKey(item: any): string {
  return getCanonicalFlightNumberIdentity(item.flight?.identification?.number?.default);
}

function findMatchingFr24Item(item: any, candidates: any[], direction: FlightDirection): any | undefined {
  const exact = candidates.find(candidate =>
    normalizeFr24Id(candidate?.flight?._fr24Id)
      && isFlightServiceMatch(item, candidate, direction),
  );
  if (exact) return exact;

  const key = flightNumberKey(item);
  if (!key) return undefined;
  const sameNumber = candidates.filter(candidate =>
    normalizeFr24Id(candidate?.flight?._fr24Id) && flightNumberKey(candidate) === key,
  );
  return sameNumber.length === 1 ? sameNumber[0] : undefined;
}

function attachFr24Id(item: any, fr24Id: string): any {
  return {
    ...item,
    flight: {
      ...(item?.flight ?? {}),
      _fr24Id: fr24Id,
    },
  };
}

function enrichDirectionWithFr24Ids(
  items: any[],
  publicItems: any[],
  direction: FlightDirection,
): { items: any[]; matched: number } {
  let matched = 0;
  const enriched = items.map(item => {
    const match = findMatchingFr24Item(item, publicItems, direction);
    const fr24Id = normalizeFr24Id(match?.flight?._fr24Id);
    if (!fr24Id || normalizeFr24Id(item?.flight?._fr24Id) === fr24Id) return item;
    matched += 1;
    return attachFr24Id(item, fr24Id);
  });
  return { items: enriched, matched };
}

export function applyPublicFr24Ids(
  allArrivals: any[],
  allDepartures: any[],
  publicSchedule: PublicFr24Schedule,
): { allArrivals: any[]; allDepartures: any[]; matched: number } {
  const arrivals = enrichDirectionWithFr24Ids(allArrivals, publicSchedule.allArrivals, 'arrival');
  const departures = enrichDirectionWithFr24Ids(allDepartures, publicSchedule.allDepartures, 'departure');
  return {
    allArrivals: arrivals.items,
    allDepartures: departures.items,
    matched: arrivals.matched + departures.matched,
  };
}

export async function enrichFlightScheduleWithFr24Ids(
  airportCode: string,
  allArrivals: any[],
  allDepartures: any[],
): Promise<{ allArrivals: any[]; allDepartures: any[]; matched: number }> {
  const publicSchedule = await loadPublicFr24IdentitySchedule(airportCode);
  return applyPublicFr24Ids(allArrivals, allDepartures, publicSchedule);
}

export async function resolveFlightradar24IdForFlight(
  airportCode: string,
  item: any,
  direction: FlightDirection,
): Promise<string | null> {
  const existing = normalizeFr24Id(item?.flight?._fr24Id);
  if (existing) return existing;
  const publicSchedule = await loadPublicFr24IdentitySchedule(airportCode);
  const candidates = direction === 'arrival' ? publicSchedule.allArrivals : publicSchedule.allDepartures;
  return normalizeFr24Id(findMatchingFr24Item(item, candidates, direction)?.flight?._fr24Id) ?? null;
}

export const fr24ApiProvider: FlightScheduleProvider = {
  id: 'fr24Api',
  label: 'FlightRadar24 API',
  supports: ({ fr24ApiKey }) => Boolean(fr24ApiKey),
  unavailableMessage: () => 'FlightRadar24 API key non configurata',
  fetch: async ({ airportCode, airport, fr24ApiKey, signal }) => {
    if (!fr24ApiKey) throw new Error('FR24_API_KEY_MISSING');

    const live = await fetchOfficialFr24LiveSchedule(airportCode, airport, fr24ApiKey, signal);
    return {
      allArrivals: [],
      allDepartures: [],
      liveUpdates: { arrivals: live.allArrivals, departures: live.allDepartures },
    };
  },
};

export const fr24PublicProvider: FlightScheduleProvider = {
  id: 'fr24Public',
  label: 'FlightRadar24 public',
  supports: () => true,
  fetch: async ({ airportCode, signal }) => fetchPublicFr24Schedule(airportCode, signal),
};

// Legacy export kept for older imports.
export const fr24Provider = fr24PublicProvider;
