import {
  getFlightBestTs,
  getFlightMergeKey,
  getFlightScheduledTs,
  isFlightAirlineMatch,
  type FlightDirection,
} from './flightScheduleAdapter';

export type UnifiedFlightListEntry = {
  item: any;
  direction: FlightDirection;
  key: string;
};

function isSameLocalDay(timestamp: number, day: Date): boolean {
  const actual = new Date(timestamp * 1000);
  return actual.getFullYear() === day.getFullYear()
    && actual.getMonth() === day.getMonth()
    && actual.getDate() === day.getDate();
}

function getEntrySortTs(entry: UnifiedFlightListEntry): number {
  return getFlightBestTs(entry.item, entry.direction)
    ?? getFlightScheduledTs(entry.item, entry.direction)
    ?? Number.MAX_SAFE_INTEGER;
}

export function compareUnifiedFlightsChronologically(
  left: UnifiedFlightListEntry,
  right: UnifiedFlightListEntry,
): number {
  const timeDifference = getEntrySortTs(left) - getEntrySortTs(right);
  return timeDifference || left.key.localeCompare(right.key);
}

/**
 * Builds one operational timeline while keeping the movement direction on each
 * row. Arrivals and departures deliberately remain distinct services, even
 * when they share a flight number.
 */
export function buildUnifiedFlightList(
  arrivals: any[],
  departures: any[],
  selectedDate: Date,
): UnifiedFlightListEntry[] {
  const seen = new Set<string>();
  const entries: UnifiedFlightListEntry[] = [];

  const appendDirection = (items: any[], direction: FlightDirection) => {
    for (const item of items) {
      const timestamp = getFlightBestTs(item, direction);
      if (!timestamp || !isSameLocalDay(timestamp, selectedDate)) continue;

      const key = `${direction}:${getFlightMergeKey(item, direction)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ item, direction, key });
    }
  };

  appendDirection(arrivals, 'arrival');
  appendDirection(departures, 'departure');
  return entries.sort(compareUnifiedFlightsChronologically);
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
