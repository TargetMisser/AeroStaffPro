export type FlightDirection = 'arrival' | 'departure';
export type FlightTimestampBucket = 'real' | 'estimated' | 'scheduled';

export type FlightSortOptions = {
  preferBestTime?: boolean;
};

export const DEFAULT_FLIGHT_RETENTION_SECONDS = 60 * 60;

function readFlightTs(item: any, bucket: FlightTimestampBucket, direction: FlightDirection): number | undefined {
  const value = item?.flight?.time?.[bucket]?.[direction];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function getFlightNumber(item: any): string {
  return String(item?.flight?.identification?.number?.default ?? '').trim();
}

export function getFlightAirlineName(item: any): string {
  return String(item?.flight?.airline?.name ?? '').trim();
}

function readUsefulAirportText(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  if (!text || text === '???' || /^n\/?a$/i.test(text) || text === '-') return undefined;
  return text;
}

export function getFlightAirportLabel(airport: any, fallback = 'N/A'): string {
  return readUsefulAirportText(airport?.code?.iata)
    ?? readUsefulAirportText(airport?.iata)
    ?? readUsefulAirportText(airport?.code?.icao)
    ?? readUsefulAirportText(airport?.icao)
    ?? readUsefulAirportText(airport?.name)
    ?? fallback;
}

export function getFlightScheduledTs(item: any, direction: FlightDirection): number | undefined {
  return readFlightTs(item, 'scheduled', direction);
}

export function getFlightEstimatedTs(item: any, direction: FlightDirection): number | undefined {
  return readFlightTs(item, 'estimated', direction);
}

export function getFlightRealTs(item: any, direction: FlightDirection): number | undefined {
  return readFlightTs(item, 'real', direction);
}

export function getFlightBestTs(item: any, direction: FlightDirection): number | undefined {
  return getFlightRealTs(item, direction)
    ?? getFlightEstimatedTs(item, direction)
    ?? getFlightScheduledTs(item, direction);
}

export function getFlightStableKey(item: any, direction: FlightDirection): string {
  const flightNumber = getFlightNumber(item);
  const scheduledTs = getFlightScheduledTs(item, direction);
  const bestTs = getFlightBestTs(item, direction);
  const id = item?.flight?.identification?.id;
  const timeKey = scheduledTs ?? bestTs ?? '';
  if (flightNumber || timeKey) {
    return `${flightNumber}_${timeKey}`;
  }
  return typeof id === 'string' && id ? id : JSON.stringify(item);
}

export function mergeFlightLists(cached: any[], fresh: any[], direction: FlightDirection): any[] {
  const map = new Map<string, any>();
  for (const item of cached) {
    map.set(getFlightStableKey(item, direction), item);
  }
  for (const item of fresh) {
    map.set(getFlightStableKey(item, direction), item);
  }
  return Array.from(map.values());
}

export function pruneExpiredFlights(
  items: any[],
  direction: FlightDirection,
  nowSeconds = Date.now() / 1000,
  retentionSeconds = DEFAULT_FLIGHT_RETENTION_SECONDS,
): any[] {
  const cutoff = nowSeconds - retentionSeconds;
  return items.filter(item => {
    const ts = getFlightBestTs(item, direction);
    if (!ts) return true;
    return ts >= cutoff;
  });
}

export function compareFlightsChronologically(
  direction: FlightDirection,
  options: FlightSortOptions = {},
) {
  return (left: any, right: any): number => {
    const leftPrimary = options.preferBestTime
      ? getFlightBestTs(left, direction)
      : getFlightScheduledTs(left, direction);
    const rightPrimary = options.preferBestTime
      ? getFlightBestTs(right, direction)
      : getFlightScheduledTs(right, direction);
    const leftTs = leftPrimary ?? getFlightBestTs(left, direction) ?? Number.MAX_SAFE_INTEGER;
    const rightTs = rightPrimary ?? getFlightBestTs(right, direction) ?? Number.MAX_SAFE_INTEGER;
    if (leftTs !== rightTs) return leftTs - rightTs;

    const leftScheduled = getFlightScheduledTs(left, direction) ?? Number.MAX_SAFE_INTEGER;
    const rightScheduled = getFlightScheduledTs(right, direction) ?? Number.MAX_SAFE_INTEGER;
    if (leftScheduled !== rightScheduled) return leftScheduled - rightScheduled;

    return getFlightNumber(left).localeCompare(getFlightNumber(right));
  };
}
