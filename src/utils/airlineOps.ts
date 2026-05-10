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

export function getAirlineOps(name: string): AirlineOps {
  const lower = name.toLowerCase();
  return AIRLINE_OPS.find(({ key }) => lower.includes(key))?.ops ?? DEFAULT_OPS;
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
  const lower = name.toLowerCase();
  for (const [k, c] of Object.entries(AIRLINE_COLORS)) if (lower.includes(k)) return c;
  return '#2563EB';
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
