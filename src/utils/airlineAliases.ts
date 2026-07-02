/*---------------------------------------------------------------------------*\
| Tabella unica degli alias compagnia (nomi, codici IATA/ICAO, brand del      |
| gruppo). Era duplicata in flightScheduleAdapter, airportSettings e         |
| airlineOps con piccole divergenze: qualunque nuovo alias va aggiunto SOLO  |
| qui. L'ordine delle chiavi conta per la canonicalizzazione: le voci più    |
| specifiche (es. "air arabia maroc") devono precedere quelle generiche      |
| ("air arabia"), perché la prima regola che combacia vince.                 |
\*---------------------------------------------------------------------------*/
export const AIRLINE_ALIASES: Record<string, string[]> = {
  ryanair: ['ryanair', 'fr', 'ryr'],
  easyjet: ['easyjet', 'easy jet', 'easyjet europe', 'easyjet switzerland', 'easyjet uk', 'u2', 'ec', 'ds', 'eju', 'ezy', 'ezs'],
  wizz: ['wizz', 'wizz air', 'wizz air malta', 'wizz air uk', 'wizz air abu dhabi', 'w6', 'w4', 'w9', 'wzz', 'wmt', 'wuk'],
  volotea: ['volotea', 'v7'],
  vueling: ['vueling', 'vy'],
  transavia: ['transavia', 'transavia france', 'transavia holland', 'transavia airlines', 'hv', 'to', 'tra', 'tvf'],
  'aer lingus': ['aer lingus', 'ei'],
  'british airways': ['british airways', 'ba', 'baw'],
  sas: ['sas', 'scandinavian', 'sk'],
  scandinavian: ['sas', 'scandinavian', 'sk'],
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

export function normalizeAirlineText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function compactAirlineText(value: unknown): string {
  return normalizeAirlineText(value).replace(/\s+/g, '');
}

/* Gli alias corti (codici IATA/ICAO, max 3 caratteri) combaciano solo come
   parola intera o valore esatto, per non far scattare "fr" dentro "france";
   quelli lunghi combaciano come sottostringa compatta ("easyjet" dentro
   "easyjet europe"). */
export function airlineAliasMatches(value: unknown, alias: string): boolean {
  const normalizedValue = normalizeAirlineText(value);
  const normalizedAlias = normalizeAirlineText(alias);
  const compactAlias = compactAirlineText(alias);
  if (!normalizedValue || !normalizedAlias || !compactAlias) return false;

  if (compactAlias.length <= 3) {
    return normalizedValue.split(' ').includes(compactAlias) || compactAirlineText(value) === compactAlias;
  }

  return compactAirlineText(value).includes(compactAlias);
}

export function canonicalAirlineKey(value: unknown): string {
  const normalized = normalizeAirlineText(value);
  if (!normalized) return '';

  for (const [key, aliases] of Object.entries(AIRLINE_ALIASES)) {
    if (aliases.some(alias => airlineAliasMatches(normalized, alias))) {
      return key;
    }
  }

  return normalized;
}
