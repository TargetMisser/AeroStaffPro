import { isFlightAirlineMatch } from './flightScheduleAdapter';

export const MIN_NOTIF_MINUTES = 1;
export const MAX_NOTIF_MINUTES = 90;

export type FlightNotificationSettings = {
  onlyTrackedAirlines: boolean;
  includeArrivals: boolean;
  includeDepartures: boolean;
  includeShiftEnd: boolean;
  sticky: boolean;
  arrivalLeadMinutes: number;
  departureLeadMinutes: number;
};

export const DEFAULT_NOTIFICATION_SETTINGS: FlightNotificationSettings = {
  onlyTrackedAirlines: true,
  includeArrivals: true,
  includeDepartures: false,
  includeShiftEnd: true,
  sticky: false,
  arrivalLeadMinutes: 15,
  departureLeadMinutes: 10,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeNotificationSettings(value: unknown): FlightNotificationSettings {
  const raw = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
  const num = (field: string, fallback: number) => {
    const v = raw[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return clamp(Math.round(v), MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES);
  };

  return {
    onlyTrackedAirlines: typeof raw.onlyTrackedAirlines === 'boolean'
      ? raw.onlyTrackedAirlines
      : DEFAULT_NOTIFICATION_SETTINGS.onlyTrackedAirlines,
    includeArrivals: typeof raw.includeArrivals === 'boolean'
      ? raw.includeArrivals
      : DEFAULT_NOTIFICATION_SETTINGS.includeArrivals,
    includeDepartures: typeof raw.includeDepartures === 'boolean'
      ? raw.includeDepartures
      : DEFAULT_NOTIFICATION_SETTINGS.includeDepartures,
    includeShiftEnd: typeof raw.includeShiftEnd === 'boolean'
      ? raw.includeShiftEnd
      : DEFAULT_NOTIFICATION_SETTINGS.includeShiftEnd,
    sticky: typeof raw.sticky === 'boolean'
      ? raw.sticky
      : DEFAULT_NOTIFICATION_SETTINGS.sticky,
    arrivalLeadMinutes: num('arrivalLeadMinutes', DEFAULT_NOTIFICATION_SETTINGS.arrivalLeadMinutes),
    departureLeadMinutes: num('departureLeadMinutes', DEFAULT_NOTIFICATION_SETTINGS.departureLeadMinutes),
  };
}

export function shouldNotifyAirline(
  item: any,
  settings: FlightNotificationSettings,
  selectedAirlines: string[],
): boolean {
  if (!settings.onlyTrackedAirlines || selectedAirlines.length === 0) {
    return true;
  }
  return selectedAirlines.some(key => isFlightAirlineMatch(item, key));
}

export function sameAirlineKeys(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
