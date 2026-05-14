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

function getAirportDisplayLabel(value: unknown, preferCode = false): string | undefined {
  const text = readUsefulAirportText(value);
  if (!text) return undefined;

  const normalized = normalizeFlightIdentityPart(text);
  const alias = REMOTE_AIRPORT_ALIASES[normalized];
  if (alias) return alias;

  if (preferCode || /^[A-Z]{3}$/.test(normalized)) {
    return normalized;
  }

  return text;
}

export function getFlightAirportLabel(airport: any, fallback = 'N/A'): string {
  return getAirportDisplayLabel(airport?.code?.iata, true)
    ?? getAirportDisplayLabel(airport?.iata, true)
    ?? getAirportDisplayLabel(airport?.code?.icao, true)
    ?? getAirportDisplayLabel(airport?.icao, true)
    ?? getAirportDisplayLabel(airport?.name)
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

const FLIGHT_NUMBER_PREFIX_ALIASES: Record<string, string> = {
  EC: 'U2',
  DS: 'U2',
  EJU: 'U2',
  EZS: 'U2',
  EZY: 'U2',
};

export function getCanonicalFlightNumberIdentity(value: unknown): string {
  const normalized = normalizeFlightIdentityPart(value);
  const match = normalized.match(/^([A-Z0-9]{2,3}?)(\d+)$/);
  if (!match) return normalized;

  const [, prefix, digits] = match;
  const canonicalPrefix = FLIGHT_NUMBER_PREFIX_ALIASES[prefix] ?? prefix;
  return `${canonicalPrefix}${digits.replace(/^0+(?=\d)/, '')}`;
}

type AirportIdentityConfidence = 'code' | 'name' | 'unknown';

type FlightMergeIdentity = {
  flightNumber: string;
  remoteAirport: string;
  remoteAirportConfidence: AirportIdentityConfidence;
  serviceDate: string;
};

const REMOTE_AIRPORT_ALIASES: Record<string, string> = {
  AMSTERDAM: 'AMS',
  AMSTERDAMSCHIPHOL: 'AMS',
  SCHIPHOL: 'AMS',
  EHAM: 'AMS',
  LONDONGATWICK: 'LGW',
  GATWICK: 'LGW',
  EGKK: 'LGW',
  LONDONSTANSTED: 'STN',
  STANSTED: 'STN',
  EGSS: 'STN',
  LONDONLUTON: 'LTN',
  LUTON: 'LTN',
  EGGW: 'LTN',
  PARISORLY: 'ORY',
  ORLY: 'ORY',
  LFPO: 'ORY',
  BRUSSELSSOUTHCHARLEROI: 'CRL',
  BRUSSELSCHARLEROI: 'CRL',
  CHARLEROI: 'CRL',
  EBCI: 'CRL',
  TIRANA: 'TIA',
  TIRANAINTERNATIONAL: 'TIA',
  LATI: 'TIA',
};

function canonicalizeAirportIdentity(value: unknown): string {
  const normalized = normalizeFlightIdentityPart(value);
  return REMOTE_AIRPORT_ALIASES[normalized] ?? normalized;
}

function getRemoteAirport(item: any, direction: FlightDirection): any {
  return direction === 'arrival'
    ? item?.flight?.airport?.origin
    : item?.flight?.airport?.destination;
}

function getFlightRemoteAirportIdentity(item: any, direction: FlightDirection): {
  key: string;
  confidence: AirportIdentityConfidence;
} {
  const airport = getRemoteAirport(item, direction);
  const airportCode = readUsefulAirportText(airport?.code?.iata)
    ?? readUsefulAirportText(airport?.iata)
    ?? readUsefulAirportText(airport?.code?.icao)
    ?? readUsefulAirportText(airport?.icao);
  if (airportCode) {
    return { key: canonicalizeAirportIdentity(airportCode), confidence: 'code' };
  }

  const airportName = readUsefulAirportText(airport?.name);
  if (airportName) {
    const key = canonicalizeAirportIdentity(airportName);
    const confidence = REMOTE_AIRPORT_ALIASES[normalizeFlightIdentityPart(airportName)] ? 'code' : 'name';
    return { key, confidence };
  }

  return { key: '', confidence: 'unknown' };
}

function getFlightMergeIdentity(item: any, direction: FlightDirection): FlightMergeIdentity {
  const remoteAirport = getFlightRemoteAirportIdentity(item, direction);
  return {
    flightNumber: getCanonicalFlightNumberIdentity(getFlightNumber(item)),
    remoteAirport: remoteAirport.key || 'AIRPORT_UNKNOWN',
    remoteAirportConfidence: remoteAirport.confidence,
    serviceDate: getFlightServiceDateKey(item, direction) || 'DATE_UNKNOWN',
  };
}

function areFlightTimesCompatible(left: any, right: any, direction: FlightDirection): boolean {
  const leftTs = getFlightBestTs(left, direction) ?? getFlightScheduledTs(left, direction);
  const rightTs = getFlightBestTs(right, direction) ?? getFlightScheduledTs(right, direction);
  if (!leftTs || !rightTs) return true;

  return Math.abs(leftTs - rightTs) <= 2 * 60 * 60;
}

function isLikelySameFlight(left: any, right: any, direction: FlightDirection): boolean {
  const leftIdentity = getFlightMergeIdentity(left, direction);
  const rightIdentity = getFlightMergeIdentity(right, direction);

  if (!leftIdentity.flightNumber || leftIdentity.flightNumber !== rightIdentity.flightNumber) return false;
  if (leftIdentity.serviceDate !== rightIdentity.serviceDate) return false;
  if (leftIdentity.remoteAirport === rightIdentity.remoteAirport) return true;

  const bothHaveReliableCodes = leftIdentity.remoteAirportConfidence === 'code'
    && rightIdentity.remoteAirportConfidence === 'code';
  const bothOnlyHaveNames = leftIdentity.remoteAirportConfidence === 'name'
    && rightIdentity.remoteAirportConfidence === 'name';
  if (bothHaveReliableCodes || bothOnlyHaveNames) return false;

  return areFlightTimesCompatible(left, right, direction);
}

function findMergeCandidateKey(map: Map<string, any>, item: any, direction: FlightDirection): string | undefined {
  const exactKey = getFlightMergeKey(item, direction);
  if (map.has(exactKey)) {
    return exactKey;
  }

  for (const [candidateKey, candidate] of map) {
    if (isLikelySameFlight(candidate, item, direction)) {
      return candidateKey;
    }
  }

  return undefined;
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
  const identity = getFlightMergeIdentity(item, direction);
  if (!identity.flightNumber) {
    return getFlightStableKey(item, direction);
  }

  return [
    identity.flightNumber,
    direction,
    identity.remoteAirport,
    identity.serviceDate,
  ].join('_');
}

export function mergeFlightLists(cached: any[], fresh: any[], direction: FlightDirection): any[] {
  const map = new Map<string, any>();
  for (const item of cached) {
    map.set(getFlightMergeKey(item, direction), item);
  }
  for (const item of fresh) {
    const nextKey = getFlightMergeKey(item, direction);
    const existingKey = findMergeCandidateKey(map, item, direction);
    if (existingKey && existingKey !== nextKey) {
      map.delete(existingKey);
    }
    map.set(nextKey, item);
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
