import {
  DEFAULT_FLIGHT_RETENTION_SECONDS,
  getCanonicalFlightNumberIdentity,
  getFlightBestTs,
  getFlightMergeKey,
  getFlightScheduledTs,
  isFlightAirlineMatch,
  type FlightDirection,
} from './flightScheduleAdapter';

export type UnifiedFlightListEntry = {
  item: any;
  direction: 'departure';
  linkedArrival?: any;
  key: string;
};

type RegistrationHint = {
  flightNumber?: string;
  scheduledTime?: string;
  registration?: string;
};

type ArrivalCandidate = {
  item: any;
  key: string;
  registration: string;
  scheduledTs: number;
};

export const TURNAROUND_MATCH_WINDOW_SECONDS = 8 * 60 * 60;
const STAFF_MONITOR_CLOCK_TOLERANCE_MINUTES = 120;

function isSameLocalDay(timestamp: number, day: Date): boolean {
  const actual = new Date(timestamp * 1000);
  return actual.getFullYear() === day.getFullYear()
    && actual.getMonth() === day.getMonth()
    && actual.getDate() === day.getDate();
}

function getEntrySortTs(entry: UnifiedFlightListEntry): number {
  return getFlightScheduledTs(entry.item, entry.direction)
    ?? Number.MAX_SAFE_INTEGER;
}

function normalizeRegistration(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized || /^(NA|NONE|TBD|UNKNOWN|UNASSIGNED)$/.test(normalized)) return '';
  return normalized.length >= 4 ? normalized : '';
}

function readScheduledClockMinutes(value: unknown): number | undefined {
  const match = String(value ?? '').match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function circularClockDifferenceMinutes(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, 24 * 60 - direct);
}

function findHintRegistration(
  item: any,
  direction: FlightDirection,
  hints: RegistrationHint[],
): string {
  const flightNumber = getCanonicalFlightNumberIdentity(item?.flight?.identification?.number?.default);
  const scheduledTs = getFlightScheduledTs(item, direction);
  if (!flightNumber || !scheduledTs) return '';

  const scheduledDate = new Date(scheduledTs * 1000);
  const scheduledMinutes = scheduledDate.getHours() * 60 + scheduledDate.getMinutes();
  const candidates = hints
    .map(hint => ({
      hint,
      registration: normalizeRegistration(hint.registration),
      flightNumber: getCanonicalFlightNumberIdentity(hint.flightNumber),
      clockMinutes: readScheduledClockMinutes(hint.scheduledTime),
    }))
    .filter(candidate =>
      candidate.registration
      && candidate.flightNumber === flightNumber
      && candidate.clockMinutes !== undefined,
    )
    .map(candidate => ({
      ...candidate,
      difference: circularClockDifferenceMinutes(scheduledMinutes, candidate.clockMinutes!),
    }))
    .filter(candidate => candidate.difference <= STAFF_MONITOR_CLOCK_TOLERANCE_MINUTES)
    .sort((left, right) => left.difference - right.difference || left.registration.localeCompare(right.registration));

  const closest = candidates[0];
  if (!closest) return '';
  const equallyCloseRegistrations = new Set(
    candidates
      .filter(candidate => candidate.difference === closest.difference)
      .map(candidate => candidate.registration),
  );
  return equallyCloseRegistrations.size === 1 ? closest.registration : '';
}

function getFlightRegistration(
  item: any,
  direction: FlightDirection,
  hints: RegistrationHint[],
): string {
  return normalizeRegistration(item?.flight?.aircraft?.registration)
    || findHintRegistration(item, direction, hints);
}

export function compareUnifiedFlightsChronologically(
  left: UnifiedFlightListEntry,
  right: UnifiedFlightListEntry,
): number {
  const timeDifference = getEntrySortTs(left) - getEntrySortTs(right);
  return timeDifference || left.key.localeCompare(right.key);
}

/**
 * Builds one departure-centred operational timeline. Each departure is one
 * card; an inbound arrival is attached only when the exact aircraft
 * registration matches and its scheduled arrival precedes the scheduled
 * departure inside a plausible turnaround window. Estimates never influence
 * pairing, and an arrival can be consumed only once.
 */
export function buildUnifiedFlightList(
  arrivals: any[],
  departures: any[],
  selectedDate: Date,
  arrivalRegistrationHints: RegistrationHint[] = [],
  departureRegistrationHints: RegistrationHint[] = [],
): UnifiedFlightListEntry[] {
  const seenDepartures = new Set<string>();
  const entries: UnifiedFlightListEntry[] = [];

  for (const item of departures) {
    const timestamp = getFlightScheduledTs(item, 'departure');
    if (!timestamp || item?.flight?._scheduledSynthetic === true) continue;

    const key = `departure:${getFlightMergeKey(item, 'departure')}`;
    if (seenDepartures.has(key)) continue;
    seenDepartures.add(key);
    entries.push({ item, direction: 'departure', key });
  }

  entries.sort(compareUnifiedFlightsChronologically);

  const seenArrivals = new Set<string>();
  const arrivalsByRegistration = new Map<string, ArrivalCandidate[]>();
  for (const item of arrivals) {
    const scheduledTs = getFlightScheduledTs(item, 'arrival');
    const registration = getFlightRegistration(item, 'arrival', arrivalRegistrationHints);
    const key = `arrival:${getFlightMergeKey(item, 'arrival')}`;
    if (!scheduledTs || item?.flight?._scheduledSynthetic === true || !registration || seenArrivals.has(key)) continue;
    seenArrivals.add(key);

    const candidates = arrivalsByRegistration.get(registration) ?? [];
    candidates.push({ item, key, registration, scheduledTs });
    arrivalsByRegistration.set(registration, candidates);
  }

  for (const candidates of arrivalsByRegistration.values()) {
    candidates.sort((left, right) => right.scheduledTs - left.scheduledTs || left.key.localeCompare(right.key));
  }

  const usedArrivals = new Set<string>();
  const consumedArrivalWatermarkByRegistration = new Map<string, number>();
  for (const entry of entries) {
    const departureTs = getFlightScheduledTs(entry.item, 'departure');
    const registration = getFlightRegistration(entry.item, 'departure', departureRegistrationHints);
    if (!departureTs || !registration) continue;

    const consumedArrivalWatermark = consumedArrivalWatermarkByRegistration.get(registration);
    const match = (arrivalsByRegistration.get(registration) ?? []).find(candidate => {
      if (usedArrivals.has(candidate.key)) return false;
      if (consumedArrivalWatermark !== undefined && candidate.scheduledTs <= consumedArrivalWatermark) {
        return false;
      }
      const turnaroundSeconds = departureTs - candidate.scheduledTs;
      return turnaroundSeconds >= 0 && turnaroundSeconds <= TURNAROUND_MATCH_WINDOW_SECONDS;
    });
    if (!match) continue;

    usedArrivals.add(match.key);
    consumedArrivalWatermarkByRegistration.set(registration, match.scheduledTs);
    entry.linkedArrival = match.item;
  }

  return entries.filter(entry => {
    const scheduledTs = getFlightScheduledTs(entry.item, 'departure');
    return Boolean(scheduledTs && isSameLocalDay(scheduledTs, selectedDate));
  });
}

/**
 * Hides completed cards without removing them from the rotation matcher. The
 * best/live timestamp is used only for list lifecycle; STD remains the sole
 * header, ordering and operational-calculation anchor.
 */
export function filterActiveUnifiedFlights(
  entries: UnifiedFlightListEntry[],
  nowSeconds = Date.now() / 1000,
  retentionSeconds = DEFAULT_FLIGHT_RETENTION_SECONDS,
): UnifiedFlightListEntry[] {
  const cutoff = nowSeconds - retentionSeconds;
  return entries.filter(entry => {
    const lifecycleTs = getFlightBestTs(entry.item, 'departure');
    return lifecycleTs == null || lifecycleTs >= cutoff;
  });
}

export function filterUnifiedFlightsByAirlines(
  entries: UnifiedFlightListEntry[],
  allowedAirlines: string[],
): UnifiedFlightListEntry[] {
  if (allowedAirlines.length === 0) return [];
  return entries.filter(entry =>
    allowedAirlines.some(airline => isFlightAirlineMatch(entry.item, airline)),
  );
}
