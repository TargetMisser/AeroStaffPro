import { AIRLINE_DISPLAY_NAMES } from '../airlineOps';
import { fetchStaffMonitorData, type StaffMonitorFlight } from '../staffMonitor';
import type { FlightScheduleProvider } from './types';

const STAFF_MONITOR_AIRPORT = 'PSA';

type AirlineMeta = {
  name: string;
  iata: string;
  prefixes: string[];
};

const AIRLINE_BY_FLIGHT_PREFIX: AirlineMeta[] = [
  { name: AIRLINE_DISPLAY_NAMES.ryanair, iata: 'FR', prefixes: ['FR', 'RYR'] },
  { name: AIRLINE_DISPLAY_NAMES.easyjet, iata: 'U2', prefixes: ['U2', 'EC', 'DS', 'EJU', 'EZS', 'EZY'] },
  { name: AIRLINE_DISPLAY_NAMES.wizz, iata: 'W6', prefixes: ['W6', 'W4', 'W9'] },
  { name: AIRLINE_DISPLAY_NAMES.volotea, iata: 'V7', prefixes: ['V7'] },
  { name: AIRLINE_DISPLAY_NAMES.vueling, iata: 'VY', prefixes: ['VY'] },
  { name: AIRLINE_DISPLAY_NAMES.transavia, iata: 'HV', prefixes: ['HV', 'TO'] },
  { name: AIRLINE_DISPLAY_NAMES['aer lingus'], iata: 'EI', prefixes: ['EI'] },
  { name: AIRLINE_DISPLAY_NAMES['british airways'], iata: 'BA', prefixes: ['BA'] },
  { name: AIRLINE_DISPLAY_NAMES.sas, iata: 'SK', prefixes: ['SK', 'SAS'] },
  { name: AIRLINE_DISPLAY_NAMES.flydubai, iata: 'FZ', prefixes: ['FZ'] },
  { name: 'Aeroitalia', iata: 'XZ', prefixes: ['XZ'] },
  { name: 'Air Arabia Maroc', iata: '3O', prefixes: ['3O'] },
  { name: 'Air Arabia', iata: 'G9', prefixes: ['G9'] },
  { name: 'Air Dolomiti', iata: 'EN', prefixes: ['EN'] },
  { name: 'Buzz', iata: 'RR', prefixes: ['RR'] },
  { name: 'DHL', iata: 'QY', prefixes: ['QY'] },
  { name: 'Eurowings', iata: 'EW', prefixes: ['EW'] },
  { name: 'ITA Airways', iata: 'AZ', prefixes: ['AZ'] },
  { name: 'Lufthansa', iata: 'LH', prefixes: ['LH'] },
];

function inferAirline(flightNumber: string): AirlineMeta {
  const normalized = flightNumber.toUpperCase().replace(/\s+/g, '');
  for (const airline of AIRLINE_BY_FLIGHT_PREFIX) {
    if (airline.prefixes.some(prefix => normalized.startsWith(prefix))) {
      return airline;
    }
  }

  const fallbackCode = normalized.match(/^([A-Z0-9]{2,3}?)(?=\d)/)?.[1] ?? normalized.slice(0, 2);
  return {
    name: fallbackCode ? `Compagnia ${fallbackCode}` : 'Sconosciuta',
    iata: fallbackCode,
    prefixes: [fallbackCode],
  };
}

export function parseStaffMonitorClock(value?: string, baseDate = new Date()): number | undefined {
  const match = value?.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return undefined;
  }

  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);

  /* The monitor only shows clock times for a rolling window of recent and
     upcoming flights. Anchoring them blindly to "today" turns yesterday's
     23:50 arrival, still on screen at 00:30, into a ghost flight tonight:
     pick whichever of yesterday/today/tomorrow is closest to now instead
     (ties favour the future, since the monitor is mostly forward-looking). */
  const dayMs = 24 * 60 * 60 * 1000;
  const nowMs = baseDate.getTime();
  let bestMs = date.getTime();
  for (const candidateMs of [bestMs - dayMs, bestMs + dayMs]) {
    const better = Math.abs(candidateMs - nowMs) < Math.abs(bestMs - nowMs)
      || (Math.abs(candidateMs - nowMs) === Math.abs(bestMs - nowMs) && candidateMs > bestMs);
    if (better) bestMs = candidateMs;
  }
  return Math.floor(bestMs / 1000);
}

function alignEstimatedTime(scheduledTs: number | undefined, estimatedTs: number | undefined): number | undefined {
  if (!scheduledTs || !estimatedTs) return estimatedTs;
  const halfDay = 12 * 60 * 60;
  if (estimatedTs < scheduledTs - halfDay) return estimatedTs + 24 * 60 * 60;
  if (estimatedTs > scheduledTs + halfDay) return estimatedTs - 24 * 60 * 60;
  return estimatedTs;
}

function statusColor(statusText: string | undefined, scheduledTs: number | undefined, bestTs: number | undefined): string {
  const status = (statusText ?? '').toLowerCase();
  if (/cancel|annull/.test(status)) return 'red';
  if (/ritar|delay/.test(status)) return 'yellow';
  if (/imbarco|boarding|atterr|landed|decoll|partit|take/.test(status)) return 'green';
  if (scheduledTs && bestTs && bestTs - scheduledTs > 5 * 60) return 'yellow';
  return 'gray';
}

function hasRealEvent(statusText: string | undefined, direction: 'arrivals' | 'departures'): boolean {
  const status = (statusText ?? '').toLowerCase();
  return direction === 'arrivals'
    ? /atterr|landed/.test(status)
    : /decoll|partit|take/.test(status);
}

function airportEndpoint(name: string, iata?: string, icao?: string) {
  return {
    name,
    code: {
      ...(iata ? { iata } : {}),
      ...(icao ? { icao } : {}),
    },
  };
}

function staffMonitorFlightToScheduleItem(
  item: StaffMonitorFlight,
  direction: 'arrivals' | 'departures',
  airportCode: string,
  airportName: string,
  airportIcao: string | undefined,
  now: Date,
): any | null {
  const scheduledTs = parseStaffMonitorClock(item.scheduledTime, now);
  if (!scheduledTs) return null;

  const estimatedTs = alignEstimatedTime(scheduledTs, parseStaffMonitorClock(item.estimatedTime, now));
  const effectiveTs = estimatedTs ?? scheduledTs;
  const timeField = direction === 'arrivals' ? 'arrival' : 'departure';
  const airline = inferAirline(item.flightNumber);
  const routeName = item.route ?? 'N/A';
  const homeAirport = airportEndpoint(airportName, airportCode, airportIcao);
  const remoteAirport = airportEndpoint(routeName);

  // A real touchdown time is the strongest "the aircraft is here" signal: in the
  // live PSA feed `state` is often blank even after landing, so the status-text
  // check below would otherwise never flag an arrival as landed.
  const landedTs = direction === 'arrivals'
    ? alignEstimatedTime(scheduledTs, parseStaffMonitorClock(item.landedTime, now))
    : undefined;
  const hasLanded = landedTs !== undefined;
  const realTs = landedTs ?? (hasRealEvent(item.status, direction) ? effectiveTs : undefined);
  const statusText = item.status
    || (hasLanded ? 'Atterrato' : estimatedTs && estimatedTs !== scheduledTs ? 'Stimato' : 'Scheduled');

  return {
    flight: {
      identification: {
        id: `staffmonitor_${direction}_${item.flightNumber}_${scheduledTs}`,
        number: { default: item.flightNumber },
      },
      airline: {
        name: airline.name,
        code: { iata: airline.iata },
      },
      aircraft: {
        registration: item.registration,
        model: { code: item.aircraftType },
      },
      airport: direction === 'arrivals'
        ? { origin: remoteAirport, destination: homeAirport }
        : { origin: homeAirport, destination: remoteAirport },
      time: {
        scheduled: { [timeField]: scheduledTs },
        estimated: estimatedTs ? { [timeField]: estimatedTs } : {},
        real: realTs ? { [timeField]: realTs } : {},
      },
      status: {
        text: statusText,
        generic: { status: { color: hasLanded ? 'green' : statusColor(item.status, scheduledTs, effectiveTs) } },
      },
      _source: 'staffMonitor',
    },
  };
}

export const staffMonitorProvider: FlightScheduleProvider = {
  id: 'staffMonitor',
  label: 'StaffMonitor PSA',
  supports: ({ airportCode }) => airportCode === STAFF_MONITOR_AIRPORT,
  fetch: async ({ airportCode, airport, now = new Date() }) => {
    const [departures, arrivals] = await Promise.all([
      fetchStaffMonitorData('D'),
      fetchStaffMonitorData('A'),
    ]);

    return {
      allArrivals: arrivals
        .map(item => staffMonitorFlightToScheduleItem(item, 'arrivals', airportCode, airport.name, airport.icao, now))
        .filter((item): item is any => item !== null),
      allDepartures: departures
        .map(item => staffMonitorFlightToScheduleItem(item, 'departures', airportCode, airport.name, airport.icao, now))
        .filter((item): item is any => item !== null),
    };
  },
};
