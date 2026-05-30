import { isFlightAirlineMatch, getFlightBestTs } from './flightScheduleAdapter';

export function isFlightEasyJet(item: any): boolean {
  return isFlightAirlineMatch(item, 'easyjet');
}

/**
 * Filters the list of arrivals to find easyJet arrival flights for the same local day as today (or specified reference date).
 */
export function getEasyJetArrivalsForDay(arrivals: any[], referenceDate = new Date()): any[] {
  return arrivals.filter(item => {
    if (!isFlightEasyJet(item)) return false;
    const ts = getFlightBestTs(item, 'arrival');
    if (!ts) return false;
    const date = new Date(ts * 1000);
    return date.getFullYear() === referenceDate.getFullYear() &&
           date.getMonth() === referenceDate.getMonth() &&
           date.getDate() === referenceDate.getDate();
  });
}

/**
 * Checks if easyJet arrival flights overlap: arrival times within 2 hours of each other.
 */
export function checkEasyJetOverlap(arrivals: any[]): {
  isActive: boolean;
  overlappingFlights: any[];
} {
  const easyJetArrivals = getEasyJetArrivalsForDay(arrivals)
    .sort((a, b) => {
      const tsA = getFlightBestTs(a, 'arrival') || 0;
      const tsB = getFlightBestTs(b, 'arrival') || 0;
      return tsA - tsB;
    });

  if (easyJetArrivals.length < 2) {
    return { isActive: false, overlappingFlights: [] };
  }

  const overlappingSet = new Set<any>();

  // Compare every pair to see if they overlap within 2 hours (7200 seconds)
  for (let i = 0; i < easyJetArrivals.length; i++) {
    const tsA = getFlightBestTs(easyJetArrivals[i], 'arrival');
    if (!tsA) continue;
    for (let j = i + 1; j < easyJetArrivals.length; j++) {
      const tsB = getFlightBestTs(easyJetArrivals[j], 'arrival');
      if (!tsB) continue;
      if (Math.abs(tsA - tsB) <= 2 * 60 * 60) {
        overlappingSet.add(easyJetArrivals[i]);
        overlappingSet.add(easyJetArrivals[j]);
      }
    }
  }

  const overlappingFlights = Array.from(overlappingSet).sort((a, b) => {
    const tsA = getFlightBestTs(a, 'arrival') || 0;
    const tsB = getFlightBestTs(b, 'arrival') || 0;
    return tsA - tsB;
  });

  return {
    isActive: overlappingFlights.length >= 2,
    overlappingFlights,
  };
}
