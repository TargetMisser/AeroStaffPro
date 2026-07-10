import { getBestArrivalTs, getBestDepartureTs } from './flightTimes';
import { isFlightServiceMatch, type FlightDirection } from './flightScheduleAdapter';

export type PinnedFlightTab = 'arrivals' | 'departures';

export type PinnedFlightReconciliation =
  | {
    kind: 'keep';
    item: any;
    tab: PinnedFlightTab;
    flightId: string;
  }
  | {
    kind: 'clear';
    reason: 'invalid' | 'missing';
  }
  | {
    kind: 'clear';
    reason: 'expired';
    item: any;
    tab: PinnedFlightTab;
  };

/**
 * Reconcile a stored pin against a freshly loaded flight pool.
 *
 * The stored copy is only a snapshot: always replace it before evaluating
 * expiry so an updated ETA/ETD can extend the pin beyond its original time.
 */
export function reconcilePinnedFlight(
  pinned: any,
  pool: any[],
  nowSec: number,
): PinnedFlightReconciliation {
  const tab: PinnedFlightTab = pinned?._pinTab === 'arrivals' ? 'arrivals' : 'departures';
  const flightId = pinned?.flight?.identification?.number?.default;
  if (typeof flightId !== 'string' || !flightId) return { kind: 'clear', reason: 'invalid' };

  const direction: FlightDirection = tab === 'arrivals' ? 'arrival' : 'departure';
  const updated = pool.find(item => isFlightServiceMatch(pinned, item, direction));
  if (!updated) return { kind: 'clear', reason: 'missing' };

  const item = {
    ...pinned,
    ...updated,
    _pinTab: tab,
    _pinnedAt: pinned._pinnedAt ?? nowSec * 1000,
  };
  const bestTs = tab === 'arrivals' ? getBestArrivalTs(item) : getBestDepartureTs(item);
  if (bestTs != null && bestTs < nowSec) return { kind: 'clear', reason: 'expired', item, tab };

  const refreshedFlightId = updated?.flight?.identification?.number?.default;
  return {
    kind: 'keep',
    item,
    tab,
    flightId: typeof refreshedFlightId === 'string' && refreshedFlightId ? refreshedFlightId : flightId,
  };
}
