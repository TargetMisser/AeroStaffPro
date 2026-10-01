import { getAirlineOps, getDepartureGateWindow } from './airlineOps';
import { getFlightAirportLabel, getFlightNumber, isFlightServiceMatch } from './flightScheduleAdapter';
import type { HandoverEntry } from './handover';

export type HomeShiftWindow = { start: number; end: number };
export type HomeActivityKind = 'checkInOpen' | 'checkInClose' | 'gateOpen' | 'gateClose';
export type HomeActivity = {
  kind: HomeActivityKind;
  at: number;
  flightNumber: string;
  destination: string;
  isPinned: boolean;
};

/** Operational reminders follow STD and the existing airline rules, not ETA/ETD. */
export function getNextHomeActivity(
  departures: any[],
  shift: HomeShiftWindow | null,
  pinnedFlight: any,
  nowSec: number,
): HomeActivity | null {
  if (shift && (!Number.isFinite(shift.start) || !Number.isFinite(shift.end)
    || shift.end <= shift.start || shift.end < nowSec)) return null;
  const candidates: HomeActivity[] = [];
  for (const item of departures) {
    const flight = item?.flight;
    const std = flight?.time?.scheduled?.departure;
    const flightNumber = getFlightNumber(item);
    if (typeof std !== 'number' || !Number.isFinite(std) || std <= 0 || !flightNumber) continue;
    const status = `${flight?.status?.text ?? ''} ${flight?.status?.generic?.status?.text ?? ''}`;
    if (/cancel|annull|departed|decollat|landed|atterrat|divert/i.test(status)) continue;
    const real = flight?.time?.real?.departure;
    if (typeof real === 'number' && real > 0 && real <= nowSec) continue;
    const isPinned = !!pinnedFlight && pinnedFlight._pinTab !== 'arrivals'
      && isFlightServiceMatch(pinnedFlight, item, 'departure');
    // Without a work shift, only show a departure the user explicitly follows.
    if (!shift && !isPinned) continue;
    const ops = getAirlineOps([
      flight.airline?.name, flight.airline?.code?.iata, flight.airline?.code?.icao,
    ].filter(Boolean).join(' '));
    const gate = getDepartureGateWindow(std, ops);
    const events: [HomeActivityKind, number][] = [
      ['checkInOpen', std - ops.checkInOpen * 60],
      ['checkInClose', std - ops.checkInClose * 60],
      ['gateOpen', gate.openTs],
      ['gateClose', gate.closeTs],
    ];
    for (const [kind, at] of events) {
      if (at < nowSec || (shift && (at < shift.start || at >= shift.end))) continue;
      candidates.push({ kind, at, flightNumber, isPinned,
        destination: getFlightAirportLabel(flight.airport?.destination, '—') });
    }
  }
  return candidates.sort((a, b) => a.at - b.at || Number(b.isPinned) - Number(a.isPinned)
    || a.flightNumber.localeCompare(b.flightNumber))[0] ?? null;
}

export function getOpenHomeHandovers(entries: HandoverEntry[], date: string): HandoverEntry[] {
  return entries.filter(entry => entry.shiftDate === date
    && !entry.checklist.includes('Consegna completata'))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getHomeCountdownMinutes(at: number, nowSec: number): number {
  return Math.max(0, Math.ceil((at - nowSec) / 60));
}
