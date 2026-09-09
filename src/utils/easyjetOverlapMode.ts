import { isFlightAirlineMatch } from './flightScheduleAdapter';

export function isFlightEasyJet(item: any): boolean {
  return isFlightAirlineMatch(item, 'easyjet');
}
