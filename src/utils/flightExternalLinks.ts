function normalizeFlightradar24Id(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{6,16}$/.test(normalized) ? normalized : null;
}

export function getFlightradar24FlightId(item: any): string | null {
  return normalizeFlightradar24Id(item?.flight?._fr24Id);
}

/** Keep an exact FR24 leg id through cache/provider refreshes that lack one. */
export function mergeFlightExternalLinkMetadata(cachedItem: any, freshItem: any): any {
  const fr24Id = getFlightradar24FlightId(freshItem) ?? getFlightradar24FlightId(cachedItem);
  if (!fr24Id) return freshItem;
  return {
    ...freshItem,
    flight: {
      ...(freshItem?.flight ?? {}),
      _fr24Id: fr24Id,
    },
  };
}

export function buildFlightradar24FlightUrl(flightNumber: string, fr24Id?: unknown): string | null {
  // A flight-number-only URL is ambiguous when FR24 has multiple occurrences
  // of the service. Only build a direct URL when the exact leg id is known;
  // callers can otherwise use the direction-specific airport board.
  const normalized = flightNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').toLowerCase();
  if (!normalized || normalized === 'na') return null;
  const normalizedId = normalizeFlightradar24Id(fr24Id);
  if (!normalizedId) return null;
  return `https://www.flightradar24.com/data/flights/${normalized}#${normalizedId}`;
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
