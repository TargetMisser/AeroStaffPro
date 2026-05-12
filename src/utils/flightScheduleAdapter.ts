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

const AIRLINE_MATCH_ALIASES: Record<string, string[]> = {
  ryanair: ['ryanair', 'fr', 'ryr'],
  easyjet: ['easyjet', 'easy jet', 'u2', 'ec', 'ds', 'eju', 'ezy', 'ezs'],
  wizz: ['wizz', 'wizz air', 'w6', 'w4', 'w9', 'wzz', 'wmt', 'wuk'],
  volotea: ['volotea', 'v7'],
  vueling: ['vueling', 'vy'],
  transavia: ['transavia', 'transavia france', 'transavia holland', 'hv', 'to', 'tra', 'tvf'],
  'aer lingus': ['aer lingus', 'ei'],
  'british airways': ['british airways', 'ba', 'baw'],
  sas: ['sas', 'scandinavian', 'sk', 'sas'],
  scandinavian: ['sas', 'scandinavian', 'sk', 'sas'],
  flydubai: ['flydubai', 'fz', 'fdb'],
  aeroitalia: ['aeroitalia', 'xz'],
  'air arabia maroc': ['air arabia maroc', '3o', 'mac'],
  'air arabia': ['air arabia', 'g9', 'abz'],
  'air dolomiti': ['air dolomiti', 'en', 'dla'],
  buzz: ['buzz', 'rr', 'rys'],
  dhl: ['dhl', 'qy', 'bcs'],
  eurowings: ['eurowings', 'ew', 'ewg'],
  'ita airways': ['ita airways', 'az', 'ity'],
  lufthansa: ['lufthansa', 'lh', 'dlh'],
};

function normalizeAirlineText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactAirlineText(value: unknown): string {
  return normalizeAirlineText(value).replace(/\s+/g, '');
}

function getFlightNumberAirlinePrefix(item: any): string {
  const flightNumber = getFlightNumber(item).toUpperCase().replace(/[\s\-_]/g, '');
  return flightNumber.match(/^([A-Z0-9]{2,3}?)(?=\d)/)?.[1] ?? '';
}

function getFlightAirlineIdentifiers(item: any): string[] {
  const airline = item?.flight?.airline ?? {};
  return [
    airline.name,
    airline.code?.iata,
    airline.code?.icao,
    airline.iata,
    airline.icao,
    getFlightNumberAirlinePrefix(item),
    getFlightNumber(item),
  ].filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map(value => String(value));
}

function airlineIdentifierMatchesAlias(identifier: string | number, alias: string): boolean {
  const normalizedIdentifier = normalizeAirlineText(identifier);
  const compactIdentifier = compactAirlineText(identifier);
  const normalizedAlias = normalizeAirlineText(alias);
  const compactAlias = compactAirlineText(alias);
  if (!normalizedIdentifier || !normalizedAlias || !compactAlias) return false;

  if (compactAlias.length <= 3) {
    return normalizedIdentifier.split(' ').includes(compactAlias) || compactIdentifier === compactAlias;
  }

  return compactIdentifier.includes(compactAlias);
}

export function isFlightAirlineMatch(item: any, airlineKey: string): boolean {
  const normalizedKey = normalizeAirlineText(airlineKey);
  if (!normalizedKey) return false;

  const aliases = AIRLINE_MATCH_ALIASES[normalizedKey] ?? [normalizedKey];
  const identifiers = getFlightAirlineIdentifiers(item);
  return identifiers.some(identifier =>
    aliases.some(alias => airlineIdentifierMatchesAlias(identifier, alias)),
  );
}

export function filterFlightsByAirlines(items: any[], allowedList: string[]): any[] {
  if (allowedList.length === 0) {
    return items;
  }

  return items.filter(item => allowedList.some(key => isFlightAirlineMatch(item, key)));
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

function normalizeFlightIdentityPart(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function getFlightRemoteAirportKey(item: any, direction: FlightDirection): string {
  const airport = direction === 'arrival'
    ? item?.flight?.airport?.origin
    : item?.flight?.airport?.destination;
  return normalizeFlightIdentityPart(
    readUsefulAirportText(airport?.code?.iata)
      ?? readUsefulAirportText(airport?.iata)
      ?? readUsefulAirportText(airport?.code?.icao)
      ?? readUsefulAirportText(airport?.icao)
      ?? readUsefulAirportText(airport?.name)
      ?? '',
  );
}

function getFlightServiceDateKey(item: any, direction: FlightDirection): string {
  const ts = getFlightScheduledTs(item, direction) ?? getFlightBestTs(item, direction);
  if (!ts) return '';

  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return '';

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function getFlightMergeKey(item: any, direction: FlightDirection): string {
  const flightNumber = normalizeFlightIdentityPart(getFlightNumber(item));
  if (!flightNumber) {
    return getFlightStableKey(item, direction);
  }

  const remoteAirport = getFlightRemoteAirportKey(item, direction) || 'AIRPORT_UNKNOWN';
  const serviceDate = getFlightServiceDateKey(item, direction) || 'DATE_UNKNOWN';
  return [flightNumber, direction, remoteAirport, serviceDate].join('_');
}

export function mergeFlightLists(cached: any[], fresh: any[], direction: FlightDirection): any[] {
  const map = new Map<string, any>();
  for (const item of cached) {
    map.set(getFlightMergeKey(item, direction), item);
  }
  for (const item of fresh) {
    map.set(getFlightMergeKey(item, direction), item);
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
