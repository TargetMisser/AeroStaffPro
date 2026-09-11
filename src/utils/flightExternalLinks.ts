import { preserveFreshArrivalEta } from './flightLiveUpdates';
import type { FlightDirection } from './flightScheduleAdapter';

function normalizeFlightradar24Id(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{6,16}$/.test(normalized) ? normalized : null;
}

function normalizeFlightradar24FlightNumber(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').toLowerCase();
  return normalized && normalized !== 'na' ? normalized : null;
}

export function getFlightradar24FlightId(item: any): string | null {
  return normalizeFlightradar24Id(item?.flight?._fr24Id);
}

/** A unified departure card must link to its inbound leg, never the outbound. */
export function getFlightradar24ArrivalTarget(
  item: any,
  linkedArrival: any | undefined,
  direction: 'arrival' | 'departure',
): any | null {
  return direction === 'arrival' ? item ?? null : linkedArrival ?? null;
}

/** Keep tracking metadata and fresh ETA through timetable-only refreshes. */
export function mergeFlightExternalLinkMetadata(cachedItem: any, freshItem: any, direction?: FlightDirection): any {
  if (direction === 'arrival') freshItem = preserveFreshArrivalEta(cachedItem, freshItem);
  const fr24Id = getFlightradar24FlightId(freshItem) ?? getFlightradar24FlightId(cachedItem);
  const cachedDeparture = cachedItem?.flight?.time?.real?.departure;
  const freshDeparture = freshItem?.flight?.time?.real?.departure;
  const preserveAdsbDeparture = cachedItem?.flight?._departureStatusSource === 'adsb'
    && typeof cachedDeparture === 'number'
    && typeof freshDeparture !== 'number';

  if (!fr24Id && !preserveAdsbDeparture) return freshItem;
  return {
    ...freshItem,
    flight: {
      ...(freshItem?.flight ?? {}),
      ...(fr24Id ? { _fr24Id: fr24Id } : {}),
      ...(preserveAdsbDeparture ? {
        time: {
          ...(freshItem?.flight?.time ?? {}),
          real: {
            ...(freshItem?.flight?.time?.real ?? {}),
            departure: cachedDeparture,
          },
        },
        _departureStatusSource: 'adsb',
      } : {}),
    },
  };
}

export function buildFlightradar24FlightUrl(flightNumber: string, fr24Id?: unknown): string | null {
  // A flight-number-only URL is ambiguous when FR24 has multiple occurrences
  // of the service. Only build a direct URL when the exact leg id is known;
  // callers can otherwise choose an explicit flight-page or airport fallback.
  const normalized = normalizeFlightradar24FlightNumber(flightNumber);
  if (!normalized) return null;
  const normalizedId = normalizeFlightradar24Id(fr24Id);
  if (!normalizedId) return null;
  return `https://www.flightradar24.com/data/flights/${normalized}#${normalizedId}`;
}

/** Flight-number page fallback when the exact inbound leg id is unavailable. */
export function buildFlightradar24FlightNumberUrl(flightNumber: string): string | null {
  const normalized = normalizeFlightradar24FlightNumber(flightNumber);
  return normalized ? `https://www.flightradar24.com/data/flights/${normalized}` : null;
}

/** Prefer an exact inbound leg; otherwise stay on that inbound flight number. */
export function buildFlightradar24FlightPageUrl(flightNumber: string, fr24Id?: unknown): string | null {
  return buildFlightradar24FlightUrl(flightNumber, fr24Id)
    ?? buildFlightradar24FlightNumberUrl(flightNumber);
}

export function buildFlightradar24AirportBoardUrl(
  airportCode: string,
  direction: 'arrival' | 'departure',
): string | null {
  const normalizedAirport = airportCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').toLowerCase();
  if (!/^[a-z0-9]{3,4}$/.test(normalizedAirport)) return null;
  const board = direction === 'arrival' ? 'arrivals' : 'departures';
  return `https://www.flightradar24.com/data/airports/${normalizedAirport}/${board}`;
}
