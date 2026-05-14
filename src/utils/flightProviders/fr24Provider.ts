import { buildFr24ScheduleUrl } from '../airportSettings';
import type { AirportInfo } from '../airportSettings';
import { getAirlineDisplayName } from '../airlineOps';
import { getCanonicalFlightNumberIdentity } from '../flightScheduleAdapter';
import type { FlightScheduleProvider } from './types';

const FR24_API_BASE = 'https://fr24api.flightradar24.com/api/live/flight-positions/full';

type Direction = 'arrivals' | 'departures';

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

function publicScheduleCounts(result: { allArrivals: any[]; allDepartures: any[] }): number {
  return result.allArrivals.length + result.allDepartures.length;
}

async function fetchPublicFr24Schedule(airportCode: string, signal?: AbortSignal) {
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

  return {
    allArrivals: (json.result?.response?.airport?.pluginData?.schedule?.arrivals?.data || []).map(normalizePublicScheduleItem),
    allDepartures: (json.result?.response?.airport?.pluginData?.schedule?.departures?.data || []).map(normalizePublicScheduleItem),
  };
}

function buildOfficialLiveUrl(airportCode: string, direction: Direction): string {
  const params = new URLSearchParams({
    airports: `${direction === 'arrivals' ? 'inbound' : 'outbound'}:${airportCode}`,
    limit: '300',
  });
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
): Promise<any[]> {
  const res = await fetch(buildOfficialLiveUrl(airportCode, direction), {
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

function normalizePublicScheduleItem(item: any): any {
  const flight = item?.flight;
  const airline = flight?.airline;
  if (!flight || !airline) return item;

  return {
    ...item,
    flight: {
      ...flight,
      airline: {
        ...airline,
        name: normalizeAirlineLabel(
          airline.name,
          airline.code?.iata,
          airline.code?.icao,
          flight.identification?.number?.default,
        ),
      },
    },
  };
}

function officialLiveFlightToScheduleItem(
  item: Record<string, any>,
  direction: Direction,
  airportCode: string,
  airport: AirportInfo,
): any | null {
  const flightNumber = String(item.flight ?? item.callsign ?? '').trim().toUpperCase();
  if (!flightNumber) return null;

  const etaTs = toUnixSeconds(item.eta);
  const positionTs = toUnixSeconds(item.timestamp);
  const timeField = direction === 'arrivals' ? 'arrival' : 'departure';
  const scheduledTs = direction === 'arrivals'
    ? etaTs ?? positionTs
    : positionTs;

  if (!scheduledTs) return null;

  const airlineCode = airlineCodeFromFlightNumber(flightNumber);
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
        estimated: etaTs ? { [timeField]: etaTs } : {},
        real: {},
      },
      status: {
        text: statusText,
        generic: { status: { color: direction === 'departures' ? 'green' : 'gray' } },
      },
      _source: 'fr24_api',
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

function flightNumberKey(item: any): string {
  return getCanonicalFlightNumberIdentity(item.flight?.identification?.number?.default);
}

function mergeLiveIntoScheduleItem(scheduleItem: any, liveItem: any, timeField: 'arrival' | 'departure'): any {
  const scheduleFlight = scheduleItem.flight ?? {};
  const liveFlight = liveItem.flight ?? {};
  const scheduleTime = scheduleFlight.time ?? {};
  const liveTime = liveFlight.time ?? {};
  const estimatedTs = liveTime.estimated?.[timeField];
  const realTs = liveTime.real?.[timeField];

  return {
    ...scheduleItem,
    flight: {
      ...scheduleFlight,
      airline: {
        ...(scheduleFlight.airline ?? {}),
        code: {
          ...(scheduleFlight.airline?.code ?? {}),
          ...(liveFlight.airline?.code ?? {}),
        },
        name: normalizeAirlineLabel(
          scheduleFlight.airline?.name,
          scheduleFlight.airline?.code?.iata,
          scheduleFlight.airline?.code?.icao,
          liveFlight.airline?.name,
          liveFlight.airline?.code?.iata,
          liveFlight.airline?.code?.icao,
          scheduleFlight.identification?.number?.default,
          liveFlight.identification?.number?.default,
        ),
      },
      aircraft: {
        ...(scheduleFlight.aircraft ?? {}),
        ...(liveFlight.aircraft ?? {}),
      },
      time: {
        ...scheduleTime,
        estimated: estimatedTs
          ? { ...(scheduleTime.estimated ?? {}), [timeField]: estimatedTs }
          : (scheduleTime.estimated ?? {}),
        real: realTs
          ? { ...(scheduleTime.real ?? {}), [timeField]: realTs }
          : (scheduleTime.real ?? {}),
      },
      status: liveFlight.status ?? scheduleFlight.status,
      _source: 'fr24_api_merged',
    },
  };
}

function mergeScheduleWithLive(schedule: any[], live: any[], timeField: 'arrival' | 'departure'): any[] {
  const result = [...schedule];
  const scheduleIndexByFlight = new Map<string, number>();

  schedule.forEach((item, index) => {
    const key = flightNumberKey(item);
    if (key && !scheduleIndexByFlight.has(key)) {
      scheduleIndexByFlight.set(key, index);
    }
  });

  for (const item of live) {
    const key = flightNumberKey(item);
    const existingIndex = key ? scheduleIndexByFlight.get(key) : undefined;
    if (existingIndex === undefined) {
      result.push(item);
      continue;
    }

    result[existingIndex] = mergeLiveIntoScheduleItem(result[existingIndex], item, timeField);
  }

  return result;
}

export const fr24ApiProvider: FlightScheduleProvider = {
  id: 'fr24Api',
  label: 'FlightRadar24 API',
  supports: ({ fr24ApiKey }) => Boolean(fr24ApiKey),
  unavailableMessage: () => 'FlightRadar24 API key non configurata',
  fetch: async ({ airportCode, airport, fr24ApiKey, signal }) => {
    if (!fr24ApiKey) throw new Error('FR24_API_KEY_MISSING');

    const [publicResult, liveResult] = await Promise.allSettled([
      fetchPublicFr24Schedule(airportCode, signal),
      fetchOfficialFr24LiveSchedule(airportCode, airport, fr24ApiKey, signal),
    ]);

    if (publicResult.status === 'fulfilled' && publicScheduleCounts(publicResult.value) > 0) {
      if (liveResult.status === 'fulfilled') {
        return {
          allArrivals: mergeScheduleWithLive(publicResult.value.allArrivals, liveResult.value.allArrivals, 'arrival'),
          allDepartures: mergeScheduleWithLive(publicResult.value.allDepartures, liveResult.value.allDepartures, 'departure'),
        };
      }

      return publicResult.value;
    }

    if (liveResult.status === 'fulfilled') {
      return liveResult.value;
    }

    const publicMessage = publicResult.status === 'rejected' ? String(publicResult.reason) : 'FR24_PUBLIC_EMPTY_SCHEDULE';
    const liveMessage = liveResult.status === 'rejected' ? String(liveResult.reason) : 'FR24_API_EMPTY_LIVE_POSITIONS';
    throw new Error(`FR24_API_AND_PUBLIC_FAILED API:${liveMessage} PUBLIC:${publicMessage}`);
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
