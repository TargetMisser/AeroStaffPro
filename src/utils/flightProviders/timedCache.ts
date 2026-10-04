/**
 * Drop entries older than `maxAgeMs` (and malformed ones). Provider caches are
 * keyed per airport and day, so without pruning they grow on every new day
 * until AsyncStorage reads of the whole blob start failing.
 */
export function pruneTimedCache<T extends { savedAt?: unknown }>(
  cache: Record<string, T> | null | undefined,
  maxAgeMs: number,
  now = Date.now(),
): Record<string, T> {
  const next: Record<string, T> = {};
  if (!cache || typeof cache !== 'object') return next;
  for (const [key, entry] of Object.entries(cache)) {
    if (entry && typeof entry.savedAt === 'number' && now - entry.savedAt <= maxAgeMs) next[key] = entry;
  }
  return next;
}
