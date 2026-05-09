import {
  getFlightBestTs,
  getFlightScheduledTs,
  type FlightDirection,
} from './flightScheduleAdapter';

export function getScheduledFlightTs(item: any, direction: FlightDirection): number | undefined {
  return getFlightScheduledTs(item, direction);
}

export function getBestFlightTs(item: any, direction: FlightDirection): number | undefined {
  return getFlightBestTs(item, direction);
}

export function getBestArrivalTs(item: any): number | undefined {
  return getBestFlightTs(item, 'arrival');
}

export function getBestDepartureTs(item: any): number | undefined {
  return getBestFlightTs(item, 'departure');
}
