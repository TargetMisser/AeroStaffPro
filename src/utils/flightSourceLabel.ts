const COMPACT_SOURCE_PARTS: Record<string, string> = {
  'flightradar24 api': 'FR24 API',
  'staffmonitor psa': 'StaffMonitor',
  'cache giornaliera': 'Cache',
};

export function formatFlightSourceLabel(sourceLabel: string): string {
  const seen = new Set<string>();

  return sourceLabel
    .split(' + ')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => COMPACT_SOURCE_PARTS[part.toLowerCase()] ?? part)
    .filter(part => {
      const key = part.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .join(' + ');
}
