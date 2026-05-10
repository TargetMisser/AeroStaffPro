import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALLOWED_AIRLINES, AIRLINE_DISPLAY_NAMES } from './airlineOps';

export type AirportPreset = {
  code: string;
  name: string;
  city: string;
  icao?: string;
};

export type AirportInfo = AirportPreset & {
  isCustom: boolean;
};

export const AIRPORT_STORAGE_KEY = 'aerostaff_airport_code_v1';
export const AIRPORT_AIRLINES_STORAGE_KEY = 'aerostaff_airport_airlines_v1';
export const DEFAULT_AIRPORT_CODE = 'PSA';

export const AIRPORT_PRESETS: AirportPreset[] = [
  { code: 'PSA', name: 'Pisa International', city: 'Pisa', icao: 'LIRP' },
  { code: 'FCO', name: 'Rome Fiumicino', city: 'Rome', icao: 'LIRF' },
  { code: 'CIA', name: 'Rome Ciampino', city: 'Rome', icao: 'LIRA' },
  { code: 'MXP', name: 'Milan Malpensa', city: 'Milan', icao: 'LIMC' },
  { code: 'LIN', name: 'Milan Linate', city: 'Milan', icao: 'LIML' },
  { code: 'BGY', name: 'Bergamo Orio al Serio', city: 'Bergamo', icao: 'LIME' },
  { code: 'BLQ', name: 'Bologna Guglielmo Marconi', city: 'Bologna', icao: 'LIPE' },
  { code: 'VCE', name: 'Venice Marco Polo', city: 'Venice', icao: 'LIPZ' },
  { code: 'FLR', name: 'Florence Peretola', city: 'Florence', icao: 'LIRQ' },
  { code: 'NAP', name: 'Naples International', city: 'Naples', icao: 'LIRN' },
  { code: 'CTA', name: 'Catania Fontanarossa', city: 'Catania', icao: 'LICC' },
  { code: 'PMO', name: 'Palermo Falcone Borsellino', city: 'Palermo', icao: 'LICJ' },
];

export const AIRPORT_AIRLINES: Record<string, string[]> = {
  PSA: ['ryanair', 'easyjet', 'wizz', 'aer lingus', 'transavia', 'volotea'],
  FCO: ['ryanair', 'easyjet', 'wizz', 'aer lingus', 'british airways', 'sas', 'flydubai', 'volotea', 'vueling', 'transavia'],
  CIA: ['ryanair', 'easyjet', 'wizz'],
  MXP: ['ryanair', 'easyjet', 'wizz', 'aer lingus', 'british airways', 'flydubai', 'vueling', 'volotea'],
  LIN: ['british airways', 'aer lingus', 'sas'],
  BGY: ['ryanair', 'wizz', 'easyjet', 'vueling', 'volotea'],
  BLQ: ['ryanair', 'easyjet', 'wizz', 'vueling', 'volotea', 'transavia'],
  VCE: ['ryanair', 'easyjet', 'wizz', 'british airways', 'volotea', 'vueling'],
  FLR: ['ryanair', 'easyjet', 'volotea', 'vueling'],
  NAP: ['ryanair', 'easyjet', 'wizz', 'volotea', 'vueling'],
  CTA: ['ryanair', 'easyjet', 'wizz', 'volotea', 'vueling'],
  PMO: ['ryanair', 'easyjet', 'wizz', 'volotea', 'vueling'],
};

const airportAirlinesCache: Record<string, string[]> = Object.fromEntries(
  Object.entries(AIRPORT_AIRLINES).map(([code, airlines]) => [code, [...airlines]]),
);

function normalizeAirlineKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactAirlineKey(value: string | null | undefined): string {
  return normalizeAirlineKey(value).replace(/\s+/g, '');
}

const AIRLINE_CANONICAL_RULES: Array<{ canonical: string; needles: string[] }> = [
  { canonical: 'ryanair', needles: ['ryanair', 'fr', 'ryr'] },
  { canonical: 'easyjet', needles: ['easyjet', 'easy jet', 'easyjet europe', 'easyjet switzerland', 'easyjet uk', 'u2', 'ec', 'ds', 'eju', 'ezy', 'ezs'] },
  { canonical: 'wizz', needles: ['wizz', 'wizz air', 'wizz air malta', 'wizz air uk', 'wizz air abu dhabi', 'w6', 'w4', 'w9', 'wzz', 'wmt', 'wuk'] },
  { canonical: 'volotea', needles: ['volotea', 'v7'] },
  { canonical: 'vueling', needles: ['vueling', 'vy'] },
  { canonical: 'transavia', needles: ['transavia france', 'transavia holland', 'transavia airlines', 'transavia', 'hv', 'to', 'tra', 'tvf'] },
  { canonical: 'aer lingus', needles: ['aer lingus', 'ei'] },
  { canonical: 'british airways', needles: ['british airways', 'ba', 'baw'] },
  { canonical: 'sas', needles: ['sas', 'scandinavian', 'sk'] },
  { canonical: 'flydubai', needles: ['flydubai', 'fz', 'fdb'] },
  { canonical: 'aeroitalia', needles: ['aeroitalia', 'xz'] },
  { canonical: 'air arabia maroc', needles: ['air arabia maroc', '3o', 'mac'] },
  { canonical: 'air arabia', needles: ['air arabia', 'g9', 'abz'] },
  { canonical: 'air dolomiti', needles: ['air dolomiti', 'en', 'dla'] },
  { canonical: 'buzz', needles: ['buzz', 'rr', 'rys'] },
  { canonical: 'dhl', needles: ['dhl', 'qy', 'bcs'] },
  { canonical: 'eurowings', needles: ['eurowings', 'ew', 'ewg'] },
  { canonical: 'ita airways', needles: ['ita airways', 'ita', 'az', 'ity'] },
  { canonical: 'lufthansa', needles: ['lufthansa', 'lh', 'dlh'] },
];

function isGenericAirlinePlaceholder(value: string): boolean {
  return value === 'sconosciuta'
    || value === 'unknown'
    || value === 'n a'
    || value === 'na'
    || /^(compagnia|company|airline) [a-z0-9]{1,3}$/.test(value);
}

function isLikelyRawAirlineCode(value: string): boolean {
  return /^[a-z0-9]{1,3}$/.test(compactAirlineKey(value));
}

function airlineRuleMatches(value: string, needle: string): boolean {
  const normalizedNeedle = normalizeAirlineKey(needle);
  const compactNeedle = compactAirlineKey(needle);
  if (!normalizedNeedle || !compactNeedle) {
    return false;
  }

  if (compactNeedle.length <= 3) {
    return value.split(' ').includes(compactNeedle) || compactAirlineKey(value) === compactNeedle;
  }

  return compactAirlineKey(value).includes(compactNeedle);
}

function canonicalizeAirlineKey(value: string | null | undefined): string {
  const normalized = normalizeAirlineKey(value);
  if (!normalized) {
    return '';
  }

  if (isGenericAirlinePlaceholder(normalized)) {
    return '';
  }

  for (const rule of AIRLINE_CANONICAL_RULES) {
    if (rule.needles.some(needle => airlineRuleMatches(normalized, needle))) {
      return rule.canonical;
    }
  }

  if (isLikelyRawAirlineCode(normalized)) {
    return '';
  }

  return normalized;
}

function sortAirlineKeys(values: string[]): string[] {
  return [...values].sort((left, right) => {
    const leftLabel = AIRLINE_DISPLAY_NAMES[left] ?? left;
    const rightLabel = AIRLINE_DISPLAY_NAMES[right] ?? right;
    return leftLabel.localeCompare(rightLabel, 'en', { sensitivity: 'base' });
  });
}

function sanitizeAirlineList(values: string[], fallback: string[] = ALLOWED_AIRLINES): string[] {
  const unique = Array.from(new Set(values.map(canonicalizeAirlineKey).filter(Boolean)));
  if (unique.length === 0) {
    return [...fallback];
  }

  return sortAirlineKeys(unique);
}

function normalizeAirportAirlineMap(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([airportCode, airlines]) => {
      const normalizedCode = normalizeAirportCode(airportCode);
      if (!normalizedCode || !Array.isArray(airlines)) {
        return null;
      }

      const sanitizedAirlines = sanitizeAirlineList(airlines as string[], []);
      if (sanitizedAirlines.length === 0) {
        return null;
      }

      return [normalizedCode, sanitizedAirlines] as const;
    })
    .filter((entry): entry is readonly [string, string[]] => entry !== null);

  return Object.fromEntries(entries);
}

export function primeAirportAirlinesCache(map: Record<string, string[]>): void {
  Object.entries(normalizeAirportAirlineMap(map)).forEach(([airportCode, airlines]) => {
    airportAirlinesCache[airportCode] = airlines;
  });
}

export async function getStoredAirportAirlineMap(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem(AIRPORT_AIRLINES_STORAGE_KEY);
    const parsed = raw ? normalizeAirportAirlineMap(JSON.parse(raw)) : {};
    primeAirportAirlinesCache(parsed);
    return parsed;
  } catch {
    return {};
  }
}

export async function getStoredAirportAirlines(code: string | null | undefined): Promise<string[]> {
  const normalized = isValidAirportCode(code) ? normalizeAirportCode(code) : DEFAULT_AIRPORT_CODE;
  const stored = await getStoredAirportAirlineMap();
  return stored[normalized] ?? getAirportAirlines(normalized);
}

export function extractAirportAirlinesFromSchedule(...sources: unknown[]): string[] {
  const detected = sources.flatMap(source => {
    if (!Array.isArray(source)) {
      return [];
    }

    return source
      .flatMap(item => {
        if (typeof item === 'string') {
          return [item];
        }

        const airline = item?.flight?.airline ?? {};
        const flightNumber = String(item?.flight?.identification?.number?.default ?? '')
          .toUpperCase()
          .replace(/[\s\-_]/g, '');
        const flightPrefix = flightNumber.match(/^([A-Z0-9]{2,3}?)(?=\d)/)?.[1] ?? '';

        return [
          airline.name,
          airline.code?.iata,
          airline.code?.icao,
          airline.iata,
          airline.icao,
          flightPrefix,
        ];
      })
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
  });

  return sanitizeAirlineList(detected, []);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function storeDetectedAirportAirlines(code: string | null | undefined, ...sources: unknown[]): Promise<string[]> {
  const normalizedCode = isValidAirportCode(code) ? normalizeAirportCode(code) : DEFAULT_AIRPORT_CODE;
  const detected = extractAirportAirlinesFromSchedule(...sources);
  const fallback = AIRPORT_AIRLINES[normalizedCode] ?? ALLOWED_AIRLINES;
  const currentStoredMap = await getStoredAirportAirlineMap();
  const current = currentStoredMap[normalizedCode] ?? getAirportAirlines(normalizedCode);
  const next = sanitizeAirlineList([...fallback, ...current, ...detected], fallback);

  airportAirlinesCache[normalizedCode] = next;

  if (arraysEqual(next, currentStoredMap[normalizedCode] ?? [])) {
    return next;
  }

  await AsyncStorage.setItem(
    AIRPORT_AIRLINES_STORAGE_KEY,
    JSON.stringify({
      ...currentStoredMap,
      [normalizedCode]: next,
    }),
  );

  return next;
}

export function getAirportAirlines(code: string | null | undefined): string[] {
  const normalized = isValidAirportCode(code) ? normalizeAirportCode(code) : DEFAULT_AIRPORT_CODE;
  return airportAirlinesCache[normalized] ?? AIRPORT_AIRLINES[normalized] ?? ALLOWED_AIRLINES;
}

const AIRPORT_MAP = Object.fromEntries(
  AIRPORT_PRESETS.map(airport => [airport.code, airport] as const),
) as Record<string, AirportPreset>;

export function normalizeAirportCode(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
}

export function isValidAirportCode(value: string | null | undefined): boolean {
  return /^[A-Z]{3}$/.test(normalizeAirportCode(value));
}

export function getAirportInfo(code: string | null | undefined): AirportInfo {
  const normalized = isValidAirportCode(code) ? normalizeAirportCode(code) : DEFAULT_AIRPORT_CODE;
  const preset = AIRPORT_MAP[normalized];
  if (preset) return { ...preset, isCustom: false };
  return {
    code: normalized,
    name: 'Aeroporto personalizzato',
    city: normalized,
    isCustom: true,
  };
}

export function formatAirportSettingLabel(code: string | null | undefined): string {
  const airport = getAirportInfo(code);
  return airport.isCustom
    ? `${airport.code} · Aeroporto personalizzato`
    : `${airport.code} · ${airport.name}`;
}

export function formatAirportHeader(code: string | null | undefined): string {
  const airport = getAirportInfo(code);
  if (airport.isCustom) return `Aeroporto selezionato · ${airport.code}`;
  return airport.icao
    ? `${airport.name} · ${airport.code} / ${airport.icao}`
    : `${airport.name} · ${airport.code}`;
}

export function buildFr24ScheduleUrl(code: string | null | undefined): string {
  const normalized = isValidAirportCode(code) ? normalizeAirportCode(code) : DEFAULT_AIRPORT_CODE;
  return `https://api.flightradar24.com/common/v1/airport.json?code=${normalized.toLowerCase()}&plugin[]=schedule&page=1&limit=100`;
}

export async function getStoredAirportCode(): Promise<string> {
  const stored = await AsyncStorage.getItem(AIRPORT_STORAGE_KEY);
  return isValidAirportCode(stored) ? normalizeAirportCode(stored) : DEFAULT_AIRPORT_CODE;
}

export async function setStoredAirportCode(code: string): Promise<string> {
  const normalized = normalizeAirportCode(code);
  if (!isValidAirportCode(normalized)) {
    throw new Error('INVALID_AIRPORT_CODE');
  }
  await AsyncStorage.setItem(AIRPORT_STORAGE_KEY, normalized);
  return normalized;
}
