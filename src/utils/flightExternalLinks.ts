export function buildFlightradar24FlightUrl(flightNumber: string): string | null {
  // FR24 expects the published flight number. Do not use StaffMonitor's
  // normalizer here: it intentionally strips leading zeros for table matching.
  const normalized = flightNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').toLowerCase();
  if (!normalized || normalized === 'na') return null;
  return `https://www.flightradar24.com/data/flights/${normalized}`;
}
