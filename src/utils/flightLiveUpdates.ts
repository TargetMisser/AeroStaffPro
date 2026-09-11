import { isFlightServiceMatch, getCanonicalFlightNumberIdentity, type FlightDirection } from './flightScheduleAdapter';

export type FlightLiveUpdates = { arrivals: any[]; departures: any[] };
export const LIVE_ETA_MAX_AGE_MS = 3 * 60 * 1000;

export function isLiveEtaFresh(item: any, nowMs = Date.now()): boolean {
  const observedAt = item?.flight?._etaObservedAt;
  return typeof observedAt === 'number' && Number.isFinite(observedAt)
    && observedAt <= nowMs + 30_000 && nowMs - observedAt <= LIVE_ETA_MAX_AGE_MS;
}

function shouldApplyArrivalEta(current: any, update: any): boolean {
  const incoming = update?.flight ?? {};
  const existing = current?.flight ?? {};
  // Refresh snapshots also contain unchanged timetable rows. They are not
  // observations and must never be relabelled as FR24 or replace a live ETA.
  return (incoming._etaSource === 'fr24_api' || incoming._etaSource === 'adsb')
    && typeof incoming.time?.estimated?.arrival === 'number' && Number.isFinite(incoming.time.estimated.arrival)
    && !(incoming._etaSource === 'adsb' && existing._etaSource === 'fr24_api' && isLiveEtaFresh(current))
    && ((incoming._etaSource === 'fr24_api' && existing._etaSource !== 'fr24_api' && isLiveEtaFresh(update))
      || !existing._etaObservedAt || (incoming._etaObservedAt ?? 0) >= existing._etaObservedAt);
}

/** Preserve a recent observation across a timetable-only refresh of the same service. */
export function preserveFreshArrivalEta(cached: any, fresh: any): any {
  if (fresh?.flight?.time?.real?.arrival || !isLiveEtaFresh(cached) || !shouldApplyArrivalEta(fresh, cached)) return fresh;
  const previous = cached.flight;
  const next = fresh.flight;
  const registration = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (previous._fr24Id && next._fr24Id && previous._fr24Id !== next._fr24Id) return fresh;
  if (registration(previous.aircraft?.registration) && registration(next.aircraft?.registration)
    && registration(previous.aircraft.registration) !== registration(next.aircraft.registration)) return fresh;
  return { ...fresh, flight: { ...next,
    time: { ...next.time, estimated: { ...next.time?.estimated, arrival: previous.time.estimated.arrival } },
    _etaSource: previous._etaSource,
    _etaObservedAt: previous._etaObservedAt,
  } };
}

// Live positions carry ETA/observation times, never an airport timetable.
// Apply them only to an identified scheduled service, retaining its STA/STD.
export function applyFlightLiveUpdates(schedule: any[], live: any[], direction: FlightDirection): any[] {
  const result = [...schedule];
  for (const update of live) {
    const incoming = update?.flight ?? {};
    const matches = result.map((item, index) => ({ item, index })).filter(({ item }) => {
      const flight = item?.flight ?? {};
      if (flight.time?.real?.[direction]) return false;
      if (isFlightServiceMatch(item, update, direction)) return true;
      // A delayed ETA can cross midnight or move beyond the normal timetable
      // tolerance. Require the tracking ID, or matching airframe and route,
      // before relaxing that guard. Ambiguous rotations are rejected below.
      if (incoming._fr24Id && incoming._fr24Id === flight._fr24Id
        && getCanonicalFlightNumberIdentity(incoming.identification?.number?.default)
          === getCanonicalFlightNumberIdentity(flight.identification?.number?.default)) return true;
      const registration = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const scheduled = flight.time?.scheduled?.[direction];
      const liveTime = incoming.time?.estimated?.[direction] ?? incoming.time?.scheduled?.[direction];
      if (!registration(flight.aircraft?.registration)
        || registration(flight.aircraft.registration) !== registration(incoming.aircraft?.registration)
        || typeof scheduled !== 'number' || typeof liveTime !== 'number'
        || Math.abs(liveTime - scheduled) > 8 * 60 * 60) return false;
      return isFlightServiceMatch(item, { ...update, flight: { ...incoming,
        time: { ...incoming.time, scheduled: { ...incoming.time?.scheduled, [direction]: scheduled } },
      } }, direction);
    });
    if (matches.length !== 1) continue;
    const { item, index } = matches[0];
    const flight = item.flight;
    const eta = direction === 'arrival' ? incoming.time?.estimated?.arrival : undefined;
    const newerEta = direction === 'arrival' && shouldApplyArrivalEta(item, update);
    result[index] = {
      ...item,
      flight: {
        ...flight,
        aircraft: { ...flight.aircraft, ...Object.fromEntries(
          Object.entries(incoming.aircraft ?? {}).filter(([, value]) => value != null),
        ) },
        _fr24Id: incoming._fr24Id ?? flight._fr24Id,
        ...(newerEta ? {
          time: { ...flight.time, estimated: { ...flight.time?.estimated, arrival: eta } },
          _etaSource: incoming._etaSource,
          _etaObservedAt: incoming._etaObservedAt,
        } : {}),
      },
    };
  }
  return result;
}
