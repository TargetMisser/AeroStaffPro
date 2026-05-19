export const FLIGHT_AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
export const FLIGHT_FOREGROUND_REFRESH_STALE_MS = 60 * 1000;

export function shouldRefreshFlightsOnAppActive({
  isFocused,
  airportLoading,
  lastRefreshAttemptAt,
  nowMs,
  staleMs = FLIGHT_FOREGROUND_REFRESH_STALE_MS,
}: {
  isFocused: boolean;
  airportLoading: boolean;
  lastRefreshAttemptAt: number;
  nowMs: number;
  staleMs?: number;
}): boolean {
  if (!isFocused || airportLoading) return false;
  if (!lastRefreshAttemptAt || lastRefreshAttemptAt <= 0) return true;
  return nowMs - lastRefreshAttemptAt >= staleMs;
}
