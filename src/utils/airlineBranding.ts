import { AIRLINE_COLORS } from './airlineOps';

export const AIRLINE_IATA_CODES: Record<string, string> = {
  'ryanair': 'FR',
  'easyjet': 'U2',
  'wizz': 'W6',
  'volotea': 'V7',
  'vueling': 'VY',
  'transavia': 'TO',
  'aer lingus': 'EI',
  'british airways': 'BA',
  'sas': 'SK',
  'scandinavian': 'SK',
  'flydubai': 'FZ',
  'aeroitalia': 'XZ',
  'air arabia maroc': '3O',
  'air arabia': 'G9',
  'air dolomiti': 'EN',
  'buzz': 'RR',
  'dhl': 'QY',
  'eurowings': 'EW',
  'ita airways': 'AZ',
  'lufthansa': 'LH',
};

const FALLBACK_BRAND_COLORS = [
  '#2563EB',
  '#0EA5E9',
  '#06B6D4',
  '#14B8A6',
  '#22C55E',
  '#84CC16',
  '#F59E0B',
  '#F97316',
  '#D946EF',
  '#8B5CF6',
] as const;

export function normalizeAirlineKey(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stableBrandColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return FALLBACK_BRAND_COLORS[Math.abs(hash) % FALLBACK_BRAND_COLORS.length];
}

export function getAirlineBrandColor(key: string, label: string): string {
  const normalized = normalizeAirlineKey(`${key} ${label}`);
  for (const [needle, color] of Object.entries(AIRLINE_COLORS)) {
    if (normalized.includes(needle)) {
      return color;
    }
  }
  return stableBrandColor(normalized || key || label);
}

export function getAirlineIataCode(key: string, label: string): string {
  const normalized = normalizeAirlineKey(`${key} ${label}`);
  for (const [needle, code] of Object.entries(AIRLINE_IATA_CODES)) {
    if (normalized.includes(needle)) {
      return code;
    }
  }
  return '';
}

export function getAirlineMonogram(label: string): string {
  const words = label
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '??';
  }
  return words
    .slice(0, 2)
    .map(part => part[0] ?? '')
    .join('')
    .toUpperCase()
    .padEnd(2, '?')
    .slice(0, 2);
}

export function prettifyAirlineLabel(key: string): string {
  return key.replace(/\b\w/g, ch => ch.toUpperCase());
}

export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.trim().replace('#', '');
  const normalized = raw.length === 3
    ? raw.split('').map(ch => ch + ch).join('')
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(37,99,235,${alpha})`;
  }
  const int = parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mixHexColor(hex: string, target: string, amount: number): string {
  const parse = (value: string) => {
    const raw = value.trim().replace('#', '');
    const normalized = raw.length === 3
      ? raw.split('').map(ch => ch + ch).join('')
      : raw;
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
    const int = parseInt(normalized, 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255,
    };
  };
  const base = parse(hex);
  const mix = parse(target);
  if (!base || !mix) return hex;
  const clampAmount = clamp(amount, 0, 1);
  const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  const r = base.r + (mix.r - base.r) * clampAmount;
  const g = base.g + (mix.g - base.g) * clampAmount;
  const b = base.b + (mix.b - base.b) * clampAmount;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
