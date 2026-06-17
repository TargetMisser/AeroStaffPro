/**
 * Live arrival ETA + departure status overlay from open ADS-B data
 * (adsb.lol / airplanes.live).
 *
 * StaffMonitor's estimated times update only when the airport FIDS does; the
 * actual aircraft position tells the truth much earlier (it's the same raw
 * data FlightRadar24 uses). We match airport flights to live aircraft by
 * registration (primary, exact airframe) or callsign (fallback) and, for
 * arrivals, replace the estimated arrival with distance/groundspeed plus an
 * approach allowance. For departures we detect the wheels-up moment: an
 * airframe already airborne and climbing outbound has left, so we stamp a real
 * departure time before the FIDS catches up.
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
/** mirror of the inbound test for departures: an outbound aircraft's track must
    point roughly away from the field, which separates a departure climbing out
    from the arrival of the same airframe minutes earlier */
const MAX_OUTBOUND_TRACK_DEVIATION_DEG = 80;
/** below this distance the field→aircraft bearing is too noisy to tell an
    outbound climb from an arrival on short final, so don't guess a takeoff */
const MIN_OUTBOUND_DISTANCE_NM = 1.5;
/** a just-departed aircraft is still near the field; beyond this it has either
    been gone long enough for the FIDS to catch up or it's a same-registration
    aircraft on a different leg passing through — either way the straight-line
    elapsed estimate is no longer trustworthy, so don't claim a takeoff */
const MAX_DEPARTURE_DISTANCE_NM = 60;

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

/**
 * Seconds since takeoff for an aircraft that has just departed the airport and
 * is climbing outbound, or null when the data can't support that conclusion.
 * Mirrors estimateEtaSeconds but requires the track to point AWAY from the
 * field, so an arrival of the same airframe on short final never reads as a
 * fresh departure.
 */
export function estimateSecondsSinceDeparture(
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
  if (typeof track !== 'number') return null;   // no heading -> can't tell inbound from outbound

  const distanceNm = haversineNm(lat, lon, airportLat, airportLon);
  if (distanceNm > MAX_DEPARTURE_DISTANCE_NM || distanceNm < MIN_OUTBOUND_DISTANCE_NM) return null;

  const outbound = bearingDeg(airportLat, airportLon, lat, lon);   // radial from field to aircraft
  if (angleDifferenceDeg(track, outbound) > MAX_OUTBOUND_TRACK_DEVIATION_DEG) return null;

  return Math.round((distanceNm / groundSpeedKt) * 3600);
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

/**
 * Overlay an actual-departure time onto departures whose aircraft is already
 * airborne and climbing outbound (returns new objects; inputs untouched).
 * Departures that already carry a real departure time are left alone.
 *
 * Matching is callsign-first — while airborne the aircraft carries THIS leg's
 * callsign, so it maps to the right flight — with registration as a fallback.
 * The outbound-geometry check in estimateSecondsSinceDeparture guards against
 * latching onto the inbound rotation of the same airframe, and the schedule
 * deviation guard rejects a match that belongs to a different rotation.
 */
export function applyLiveDepartureStatus(
  departures: any[],
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

  return departures.map(item => {
    if (item?.flight?.time?.real?.departure) return item;

    const reg = readFlightRegistration(item);
    const aircraft = byFlightNumber.get(readFlightNumberIdentity(item))
      || (reg ? byRegistration.get(reg) : undefined);
    if (!aircraft) return item;

    const elapsed = estimateSecondsSinceDeparture(aircraft, airportLat, airportLon);
    if (elapsed == null) return item;

    const departedAt = nowSeconds - elapsed;
    const scheduled = item?.flight?.time?.scheduled?.departure;
    if (typeof scheduled === 'number' && Math.abs(departedAt - scheduled) > MAX_SCHEDULE_DEVIATION_SECONDS) {
      return item;   // another rotation / wrong match
    }

    return {
      ...item,
      flight: {
        ...item.flight,
        time: {
          ...item.flight?.time,
          real: {
            ...item.flight?.time?.real,
            departure: departedAt,
          },
        },
        _departureStatusSource: 'adsb',
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

// ─── Origin-departure estimate ──────────────────────────────────────────────
// PSA's feed never carries the inbound flight's departure time from its origin.
// For an arrival matched to a live airborne aircraft we resolve its route
// (adsbdb: callsign -> origin airport + coords) and estimate the departure
// time from how far it has already flown at its current groundspeed. Approximate
// (climb is slower than cruise, so this can read a few minutes late) but real:
// "flight X, from airport Y, departed ~Z".

export type AircraftRoute = {
  originIata?: string;
  originIcao?: string;
  originName?: string;
  originLat: number;
  originLon: number;
  destIata?: string;
};

const ADSBDB_CALLSIGN_BASE = 'https://api.adsbdb.com/v0/callsign';
/** callsign -> route (or null when unknown); routes are stable within a day */
const ROUTE_CACHE = new Map<string, AircraftRoute | null>();
/** an aircraft must have flown at least this far for the elapsed estimate to be meaningful */
const MIN_DISTANCE_FLOWN_NM = 12;

export function _clearRouteCache(): void {
  ROUTE_CACHE.clear();
}

export async function fetchAircraftRoute(
  callsign: string | undefined,
  signal?: AbortSignal,
): Promise<AircraftRoute | null> {
  const cs = String(callsign ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cs) return null;
  if (ROUTE_CACHE.has(cs)) return ROUTE_CACHE.get(cs) ?? null;
  try {
    const res = await fetch(`${ADSBDB_CALLSIGN_BASE}/${cs}`, { headers: ADSB_FETCH_HEADERS, signal });
    if (!res.ok) { ROUTE_CACHE.set(cs, null); return null; }   // 404 = unknown callsign, cache the miss
    const json = await res.json();
    const origin = json?.response?.flightroute?.origin;
    const destination = json?.response?.flightroute?.destination;
    if (!origin || typeof origin.latitude !== 'number' || typeof origin.longitude !== 'number') {
      ROUTE_CACHE.set(cs, null);
      return null;
    }
    const route: AircraftRoute = {
      originIata: typeof origin.iata_code === 'string' ? origin.iata_code : undefined,
      originIcao: typeof origin.icao_code === 'string' ? origin.icao_code : undefined,
      originName: typeof origin.municipality === 'string' && origin.municipality
        ? origin.municipality
        : (typeof origin.name === 'string' ? origin.name : undefined),
      originLat: origin.latitude,
      originLon: origin.longitude,
      destIata: typeof destination?.iata_code === 'string' ? destination.iata_code : undefined,
    };
    ROUTE_CACHE.set(cs, route);
    return route;
  } catch {
    return null;   // transient error: don't poison the cache
  }
}

/** Seconds the aircraft has already been flying, from distance covered / current speed. */
export function estimateElapsedSeconds(
  aircraft: AdsbAircraft,
  originLat: number,
  originLon: number,
  airportLat: number,
  airportLon: number,
): number | null {
  if (aircraft.altitude === 'ground') return null;
  const { lat, lon, groundSpeedKt } = aircraft;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (typeof groundSpeedKt !== 'number'
    || groundSpeedKt < MIN_GROUNDSPEED_KT
    || groundSpeedKt > MAX_GROUNDSPEED_KT) {
    return null;
  }
  const totalNm = haversineNm(originLat, originLon, airportLat, airportLon);
  const remainingNm = haversineNm(lat, lon, airportLat, airportLon);
  const flownNm = totalNm - remainingNm;
  if (flownNm < MIN_DISTANCE_FLOWN_NM) return null;   // just off the ground / past the field
  return Math.round((flownNm / groundSpeedKt) * 3600);
}

/**
 * Fill the estimated origin-departure time on arrivals that don't already have
 * a departure time from a schedule provider. Matches arrivals to live aircraft
 * (registration, then callsign), resolves each route once (cached), and sets
 * `time.estimated.departure` + tags `_departureSource: 'adsb-estimate'`. Also
 * back-fills the origin airport code when the feed only had a free-text name.
 */
export async function applyLiveOriginDepartures(
  arrivals: any[],
  aircraftList: AdsbAircraft[],
  airportLat: number,
  airportLon: number,
  nowSeconds = Math.floor(Date.now() / 1000),
  routeLookup: (callsign: string | undefined, signal?: AbortSignal) => Promise<AircraftRoute | null> = fetchAircraftRoute,
): Promise<any[]> {
  const byRegistration = new Map<string, AdsbAircraft>();
  const byFlightNumber = new Map<string, AdsbAircraft>();
  for (const aircraft of aircraftList) {
    const reg = normalizeRegistration(aircraft.registration);
    if (reg && !byRegistration.has(reg)) byRegistration.set(reg, aircraft);
    const flightNumber = normalizeCallsignToFlightNumber(aircraft.callsign);
    if (flightNumber && !byFlightNumber.has(flightNumber)) byFlightNumber.set(flightNumber, aircraft);
  }

  // One airframe flies several rotations a day, so a live aircraft can match
  // several future arrivals (e.g. the 20:00 and the 23:25 Tirana flight on the
  // same reg). The departure estimate belongs ONLY to the leg it's flying now:
  // the arrival whose schedule is closest to its projected arrival (now + ETA).
  const bestByAircraft = new Map<AdsbAircraft, { index: number; deviation: number }>();
  arrivals.forEach((item, index) => {
    const time = item?.flight?.time;
    // already have a departure time from a schedule provider -> nothing to estimate
    if (time?.real?.departure || time?.scheduled?.departure || time?.estimated?.departure) return;
    if (time?.real?.arrival) return;   // already landed; departure no longer interesting
    const reg = readFlightRegistration(item);
    const aircraft = (reg && byRegistration.get(reg))
      || byFlightNumber.get(readFlightNumberIdentity(item));
    if (!aircraft || !aircraft.callsign) return;
    const eta = estimateEtaSeconds(aircraft, airportLat, airportLon);
    if (eta == null) return;
    const projectedArrival = nowSeconds + eta;
    const scheduled = time?.scheduled?.arrival;
    const deviation = typeof scheduled === 'number' ? Math.abs(projectedArrival - scheduled) : 0;
    if (deviation > MAX_SCHEDULE_DEVIATION_SECONDS) return;
    const current = bestByAircraft.get(aircraft);
    if (!current || deviation < current.deviation) {
      bestByAircraft.set(aircraft, { index, deviation });
    }
  });
  const tasks: Array<{ index: number; aircraft: AdsbAircraft }> = [];
  for (const [aircraft, best] of bestByAircraft) tasks.push({ index: best.index, aircraft });
  if (tasks.length === 0) return arrivals;

  const resolved = await Promise.all(tasks.map(async ({ index, aircraft }) => {
    const route = await routeLookup(aircraft.callsign);
    if (!route) return null;
    const elapsed = estimateElapsedSeconds(aircraft, route.originLat, route.originLon, airportLat, airportLon);
    if (elapsed == null) return null;
    return { index, departedAt: nowSeconds - elapsed, route };
  }));

  const byIndex = new Map<number, { departedAt: number; route: AircraftRoute }>();
  for (const r of resolved) if (r) byIndex.set(r.index, { departedAt: r.departedAt, route: r.route });
  if (byIndex.size === 0) return arrivals;

  return arrivals.map((item, index) => {
    const hit = byIndex.get(index);
    if (!hit) return item;
    const existingOrigin = item.flight?.airport?.origin;
    const needsOriginCode = !existingOrigin?.code?.iata && !existingOrigin?.code?.icao;
    const originOverride = needsOriginCode && (hit.route.originIata || hit.route.originIcao)
      ? {
          name: hit.route.originName || existingOrigin?.name,
          code: {
            ...(hit.route.originIata ? { iata: hit.route.originIata } : {}),
            ...(hit.route.originIcao ? { icao: hit.route.originIcao } : {}),
          },
        }
      : existingOrigin;
    return {
      ...item,
      flight: {
        ...item.flight,
        airport: { ...item.flight?.airport, origin: originOverride },
        time: {
          ...item.flight?.time,
          estimated: {
            ...item.flight?.time?.estimated,
            departure: hit.departedAt,
          },
        },
        _departureSource: 'adsb-estimate',
      },
    };
  });
}
