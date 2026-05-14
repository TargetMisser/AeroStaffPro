export type HexColor = `#${string}`;

export type AirlineOps = {
  checkInOpen: number;
  checkInClose: number;
  gateOpen: number;
  gateClose: number;
};

export const DEFAULT_OPS: AirlineOps = { checkInOpen: 120, checkInClose: 40, gateOpen: 30, gateClose: 20 };

export const AIRLINE_OPS: Array<{ key: string; ops: AirlineOps }> = [
  { key: 'ryanair',         ops: { checkInOpen: 150, checkInClose: 40, gateOpen: 30, gateClose: 20 } },
  { key: 'easyjet',         ops: { checkInOpen: 120, checkInClose: 40, gateOpen: 30, gateClose: 20 } },
  { key: 'wizz',            ops: { checkInOpen: 120, checkInClose: 40, gateOpen: 30, gateClose: 15 } },
  { key: 'volotea',         ops: { checkInOpen: 120, checkInClose: 40, gateOpen: 30, gateClose: 20 } },
  { key: 'vueling',         ops: { checkInOpen: 120, checkInClose: 45, gateOpen: 35, gateClose: 20 } },
  { key: 'transavia',       ops: { checkInOpen: 120, checkInClose: 40, gateOpen: 30, gateClose: 20 } },
  { key: 'aer lingus',      ops: { checkInOpen: 150, checkInClose: 40, gateOpen: 30, gateClose: 20 } },
  { key: 'british airways', ops: { checkInOpen: 180, checkInClose: 45, gateOpen: 45, gateClose: 20 } },
  { key: 'sas',             ops: { checkInOpen: 120, checkInClose: 40, gateOpen: 30, gateClose: 20 } },
  { key: 'scandinavian',    ops: { checkInOpen: 120, checkInClose: 40, gateOpen: 30, gateClose: 20 } },
  { key: 'flydubai',        ops: { checkInOpen: 180, checkInClose: 60, gateOpen: 40, gateClose: 20 } },
];

const AIRLINE_ALIASES: Record<string, string[]> = {
  ryanair: ['ryanair', 'fr', 'ryr'],
  easyjet: ['easyjet', 'easy jet', 'u2', 'ec', 'ds', 'eju', 'ezy', 'ezs'],
  wizz: ['wizz', 'wizz air', 'w6', 'w4', 'w9', 'wzz', 'wmt', 'wuk'],
  volotea: ['volotea', 'v7'],
  vueling: ['vueling', 'vy'],
  transavia: ['transavia', 'transavia france', 'transavia holland', 'hv', 'to', 'tra', 'tvf'],
  'aer lingus': ['aer lingus', 'ei'],
  'british airways': ['british airways', 'ba', 'baw'],
  sas: ['sas', 'scandinavian', 'sk'],
  flydubai: ['flydubai', 'fz', 'fdb'],
  aeroitalia: ['aeroitalia', 'xz'],
  'air arabia maroc': ['air arabia maroc', '3o', 'mac'],
  'air arabia': ['air arabia', 'g9', 'abz'],
  'air dolomiti': ['air dolomiti', 'en', 'dla'],
  buzz: ['buzz', 'rr', 'rys'],
  dhl: ['dhl', 'qy', 'bcs'],
  eurowings: ['eurowings', 'ew', 'ewg'],
  'ita airways': ['ita airways', 'ita', 'az', 'ity'],
  lufthansa: ['lufthansa', 'lh', 'dlh'],
};

function normalizeAirlineText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactAirlineText(value: unknown): string {
  return normalizeAirlineText(value).replace(/\s+/g, '');
}

function airlineAliasMatches(value: string, alias: string): boolean {
  const normalizedAlias = normalizeAirlineText(alias);
  const compactAlias = compactAirlineText(alias);
  if (!value || !normalizedAlias || !compactAlias) return false;

  if (compactAlias.length <= 3) {
    return value.split(' ').includes(compactAlias) || compactAirlineText(value) === compactAlias;
  }

  return compactAirlineText(value).includes(compactAlias);
}

function canonicalAirlineKey(value: unknown): string {
  const normalized = normalizeAirlineText(value);
  if (!normalized) return '';

  for (const [key, aliases] of Object.entries(AIRLINE_ALIASES)) {
    if (aliases.some(alias => airlineAliasMatches(normalized, alias))) {
      return key;
    }
  }

  return normalized;
}

export function getAirlineOps(name: string): AirlineOps {
  const key = canonicalAirlineKey(name);
  return AIRLINE_OPS.find(item => item.key === key)?.ops
    ?? AIRLINE_OPS.find(item => key.includes(item.key))?.ops
    ?? DEFAULT_OPS;
}

export const AIRLINE_COLORS: Record<string, HexColor> = {
  'ryanair': '#073590', 'easyjet': '#FF6600', 'wizz': '#C6006E',
  'volotea': '#3C0F8B', 'vueling': '#FFB300', 'transavia': '#00A650',
  'aer lingus': '#006E44', 'british airways': '#075AAA',
  'sas': '#003E7E', 'scandinavian': '#003E7E', 'flydubai': '#CC1E42',
  'aeroitalia': '#1E5BFF', 'air arabia': '#D71920', 'air arabia maroc': '#C41230',
  'air dolomiti': '#0A4EA3', 'buzz': '#F4C400', 'dhl': '#FFCC00',
  'eurowings': '#651D88', 'ita airways': '#006B5B', 'lufthansa': '#05164D',
};

export function getAirlineColor(name: string): HexColor {
  const key = canonicalAirlineKey(name);
  const canonicalColor = AIRLINE_COLORS[key];
  if (canonicalColor) return canonicalColor;
  for (const [k, c] of Object.entries(AIRLINE_COLORS)) if (key.includes(k)) return c;
  return '#2563EB';
}

export function getAirlineDisplayName(value: unknown, fallback = 'Sconosciuta'): string {
  const key = canonicalAirlineKey(value);
  if (AIRLINE_DISPLAY_NAMES[key]) return AIRLINE_DISPLAY_NAMES[key];

  if (typeof value === 'string' || typeof value === 'number') {
    const raw = String(value).trim();
    if (raw) return raw;
  }

  return fallback;
}

export const AIRLINE_DISPLAY_NAMES: Record<string, string> = {
  'ryanair': 'Ryanair',
  'easyjet': 'easyJet',
  'wizz': 'Wizz Air',
  'volotea': 'Volotea',
  'vueling': 'Vueling',
  'transavia': 'Transavia',
  'aer lingus': 'Aer Lingus',
  'british airways': 'British Airways',
  'sas': 'SAS',
  'scandinavian': 'Scandinavian Airlines',
  'flydubai': 'flydubai',
  'aeroitalia': 'Aeroitalia',
  'air arabia': 'Air Arabia',
  'air arabia maroc': 'Air Arabia Maroc',
  'air dolomiti': 'Air Dolomiti',
  'buzz': 'Buzz',
  'dhl': 'DHL',
  'eurowings': 'Eurowings',
  'ita airways': 'ITA Airways',
  'lufthansa': 'Lufthansa',
};

export const ALLOWED_AIRLINES = [
  'ryanair', 'easyjet', 'wizz', 'volotea', 'vueling', 'transavia',
  'aer lingus', 'british airways', 'sas', 'scandinavian', 'flydubai',
];
