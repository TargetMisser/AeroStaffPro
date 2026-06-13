/**
 * Live arrival ETA overlay from open ADS-B data (adsb.lol / airplanes.live).
 *
 * StaffMonitor's estimated times update only when the airport FIDS does; the
 * actual aircraft position tells the truth much earlier (it's the same raw
 * data FlightRadar24 uses). We match airport arrivals to live aircraft by
 * registration (primary, exact airframe) or callsign (fallback) and replace
 * the estimated arrival with distance/groundspeed plus an approach allowance.
 *
 * No API key, no scraping: both endpoints are public ADS-B aggregators.
 */

export type AdsbAircraft = {
  registration?: string;
  callsign?: string;
  lat?: number;
  lon?: number;
  groundSpeedKt?: number;
  /** barometric altitude in feet, or the string 'ground' while taxiing */
  altitude?: number | 'ground';
  /** true track over ground, degrees */
  track?: number;
};

const ADSB_ENDPOINTS = [
  'https://api.adsb.lol/v2/point',
  'https://api.airplanes.live/v2/point',
];

/* Both aggregators sit behind anti-bot edges that can reply with a non-JSON
   challenge page to requests without a browser-like User-Agent (the same
   class of issue staffMonitor.ts works around with FETCH_HEADERS). Without
   this, fetch() resolves "ok" but res.json() throws, the overlay silently
   no-ops, and the FIDS times never get replaced. */
const ADSB_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json',
};

export const ADSB_RADIUS_NM = 250;
const MIN_GROUNDSPEED_KT = 80;
const MAX_GROUNDSPEED_KT = 620;
/** allowance for the approach pattern: descent, vectoring, final */
const APPROACH_BUFFER_SECONDS = 5 * 60;
/** ignore matches whose computed ETA is absurdly far from the schedule */
const MAX_SCHEDULE_DEVIATION_SECONDS = 3 * 60 * 60;
/** the aircraft must be flying roughly toward the airport, not away from it
    (the same registration flies the outbound rotation minutes later) */
const MAX_INBOUND_TRACK_DEVIATION_DEG = 80;

/** ICAO callsign prefix -> IATA flight number prefix for the PSA airlines. */
const CALLSIGN_PREFIX_TO_IATA: Record<string, string> = {
  RYR: 'FR',
  RUK: 'RK',
  EZY: 'U2',
  EJU: 'U2',
  EZS: 'U2',
  WZZ: 'W6',
  WMT: 'W4',
  WUK: 'W9',
  VOE: 'V7',
  VLG: 'VY',
  TRA: 'HV',
  TVF: 'TO',
  EIN: 'EI',
  BAW: 'BA',
  SAS: 'SK',
  FDB: 'FZ',
  MAC: '3O',
  ABY: 'G9',
  DLA: 'EN',
  RYS: 'RR',
  BCS: 'QY',
  EWG: 'EW',
  ITY: 'AZ',
  DLH: 'LH',
};

export function normalizeRegistration(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeCallsignToFlightNumber(value: unknown): string {
  if (typeof value !== 'string') return '';
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = compact.match(/^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/);
  if (!match) return compact;
  const [, prefix, suffix] = match;
  const iata = CALLSIGN_PREFIX_TO_IATA[prefix];
  if (!iata) return compact;
  // Only numeric suffixes map to flight numbers (RYR1234 -> FR1234);
  // alphanumeric callsigns (RYR52GT) don't correspond to the IATA number.
  if (!/^\d+$/.test(suffix)) return '';
  return `${iata}${suffix.replace(/^0+(?=\d)/, '')}`;
}

export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusNm = 3440.065;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusNm * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDifferenceDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Seconds until landing for an airborne aircraft heading to the airport,
 * or null when the data can't support an estimate.
 */
export function estimateEtaSeconds(
  aircraft: AdsbAircraft,
  airportLat: number,
  airportLon: number,
): number | null {
  if (aircraft.altitude === 'ground') return null;
  const { lat, lon, groundSpeedKt, track } = aircraft;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (typeof groundSpeedKt !== 'number'
    || groundSpeedKt < MIN_GROUNDSPEED_KT
    || groundSpeedKt > MAX_GROUNDSPEED_KT) {
    return null;
  }

  const distanceNm = haversineNm(lat, lon, airportLat, airportLon);
  if (distanceNm > ADSB_RADIUS_NM) return null;

  if (typeof track === 'number' && distanceNm > 8) {
    const inbound = bearingDeg(lat, lon, airportLat, airportLon);
    if (angleDifferenceDeg(track, inbound) > MAX_INBOUND_TRACK_DEVIATION_DEG) {
      return null;
    }
  }

  const cruiseSeconds = (distanceNm / groundSpeedKt) * 3600;
  return Math.round(cruiseSeconds + APPROACH_BUFFER_SECONDS);
}

function readFlightRegistration(item: any): string {
  return normalizeRegistration(item?.flight?.aircraft?.registration);
}

function readFlightNumberIdentity(item: any): string {
  const raw = String(item?.flight?.identification?.number?.default ?? '');
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z][A-Z0-9]{1,2}?)0+(?=\d)/, '$1');
}

/**
 * Overlay live ETAs onto arrival items (returns new objects; inputs untouched).
 * Flights already landed (real arrival time present) are left alone.
 */
export function applyLiveArrivalEtas(
  arrivals: any[],
  aircraftList: AdsbAircraft[],
  airportLat: number,
  airportLon: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): any[] {
  const byRegistration = new Map<string, AdsbAircraft>();
  const byFlightNumber = new Map<string, AdsbAircraft>();
  for (const aircraft of aircraftList) {
    const reg = normalizeRegistration(aircraft.registration);
    if (reg && !byRegistration.has(reg)) byRegistration.set(reg, aircraft);
    const flightNumber = normalizeCallsignToFlightNumber(aircraft.callsign);
    if (flightNumber && !byFlightNumber.has(flightNumber)) byFlightNumber.set(flightNumber, aircraft);
  }

  /* The same airframe flies several rotations a day, so one live aircraft can
     match multiple scheduled arrivals (FR1492 at 19:25 and FR8269 at 23:30 on
     the same 9H-QAG). The live ETA belongs to ONE flight only: the candidate
     whose schedule is closest to the computed arrival. */
  type Candidate = { index: number; estimatedArrival: number; deviation: number };
  const bestByAircraft = new Map<AdsbAircraft, Candidate>();

  arrivals.forEach((item, index) => {
    if (item?.flight?.time?.real?.arrival) return;

    const reg = readFlightRegistration(item);
    const aircraft = (reg && byRegistration.get(reg))
      || byFlightNumber.get(readFlightNumberIdentity(item));
    if (!aircraft) return;

    const etaSeconds = estimateEtaSeconds(aircraft, airportLat, airportLon);
    if (etaSeconds == null) return;

    const estimatedArrival = nowSeconds + etaSeconds;
    const scheduled = item?.flight?.time?.scheduled?.arrival;
    const deviation = typeof scheduled === 'number'
      ? Math.abs(estimatedArrival - scheduled)
      : 0;
    if (deviation > MAX_SCHEDULE_DEVIATION_SECONDS) return;   // another rotation

    const current = bestByAircraft.get(aircraft);
    if (!current || deviation < current.deviation) {
      bestByAircraft.set(aircraft, { index, estimatedArrival, deviation });
    }
  });

  const overlayByIndex = new Map<number, number>();
  for (const candidate of bestByAircraft.values()) {
    overlayByIndex.set(candidate.index, candidate.estimatedArrival);
  }

  return arrivals.map((item, index) => {
    const estimatedArrival = overlayByIndex.get(index);
    if (estimatedArrival == null) return item;

    return {
      ...item,
      flight: {
        ...item.flight,
        time: {
          ...item.flight?.time,
          estimated: {
            ...item.flight?.time?.estimated,
            arrival: estimatedArrival,
          },
        },
        _etaSource: 'adsb',
      },
    };
  });
}

function toAdsbAircraft(raw: any): AdsbAircraft {
  return {
    registration: typeof raw?.r === 'string' ? raw.r : undefined,
    callsign: typeof raw?.flight === 'string' ? raw.flight : undefined,
    lat: typeof raw?.lat === 'number' ? raw.lat : undefined,
    lon: typeof raw?.lon === 'number' ? raw.lon : undefined,
    groundSpeedKt: typeof raw?.gs === 'number' ? raw.gs : undefined,
    altitude: raw?.alt_baro === 'ground' ? 'ground'
      : typeof raw?.alt_baro === 'number' ? raw.alt_baro : undefined,
    track: typeof raw?.track === 'number' ? raw.track : undefined,
  };
}

export async function fetchAdsbAircraft(
  airportLat: number,
  airportLon: number,
  radiusNm = ADSB_RADIUS_NM,
  signal?: AbortSignal,
): Promise<AdsbAircraft[]> {
  let lastError: unknown = new Error('ADSB_NO_ENDPOINT');
  for (const base of ADSB_ENDPOINTS) {
    try {
      const res = await fetch(`${base}/${airportLat}/${airportLon}/${radiusNm}`, {
        headers: ADSB_FETCH_HEADERS,
        signal,
      });
      if (!res.ok) throw new Error(`ADSB_HTTP_${res.status}`);
      const json = await res.json();
      const list = Array.isArray(json?.ac) ? json.ac : [];
      return list.map(toAdsbAircraft);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
