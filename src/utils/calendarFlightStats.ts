import { getFlightBestTs } from './flightScheduleAdapter';

type CalendarShiftEvent = {
  title: string;
  startDate: string | Date;
  endDate: string | Date;
};

type CalendarEventsByDay = Record<string, CalendarShiftEvent[]>;

function readEventTs(value: string | Date): number {
  const ts = new Date(value).getTime() / 1000;
  return Number.isFinite(ts) ? ts : 0;
}

export function buildCalendarFlightCountsFromCache(
  eventsData: CalendarEventsByDay,
  departures: any[],
  arrivals: any[],
): Record<string, number> {
  const allFlights = [
    ...departures.map(item => ({ item, direction: 'departure' as const })),
    ...arrivals.map(item => ({ item, direction: 'arrival' as const })),
  ];
  const counts: Record<string, number> = {};

  for (const [iso, events] of Object.entries(eventsData)) {
    const work = events.find(event => event.title.includes('Lavoro'));
    if (!work) {
      continue;
    }

    const shiftStart = readEventTs(work.startDate);
    const shiftEnd = readEventTs(work.endDate);
    if (!shiftStart || !shiftEnd || shiftEnd <= shiftStart) {
      continue;
    }

    const count = allFlights.filter(({ item, direction }) => {
      const ts = getFlightBestTs(item, direction);
      return !!ts && ts >= shiftStart && ts <= shiftEnd;
    }).length;

    counts[iso] = count;
  }

  return counts;
}
