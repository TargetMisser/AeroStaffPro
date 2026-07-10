export type CurrentRequestCheck = () => boolean;

export type AsyncStringStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * Applies a storage mutation only for the request that is still current.
 *
 * If the request becomes stale while the native storage write is in flight,
 * restore the previous value only when nobody else has replaced our value in
 * the meantime. This prevents a completed fetch for the old airport from
 * clearing or refreshing the global pin after an airport switch.
 */
export async function updateStorageForCurrentRequest(
  storage: AsyncStringStorage,
  key: string,
  nextValue: string | null,
  previousValue: string | null,
  isCurrent: CurrentRequestCheck,
): Promise<boolean> {
  if (!isCurrent()) return false;

  // The request token protects airport changes, while this comparison also
  // protects a newer user action (for example pinning another flight) that may
  // have happened after the fetch read `previousValue`.
  const valueBeforeMutation = await storage.getItem(key);
  if (!isCurrent() || valueBeforeMutation !== previousValue) return false;

  if (nextValue == null) {
    await storage.removeItem(key);
  } else {
    await storage.setItem(key, nextValue);
  }

  if (isCurrent()) return true;

  // Compare before rolling back so a newer request/user action always wins.
  const storedAfterMutation = await storage.getItem(key);
  if (storedAfterMutation !== nextValue) return false;

  if (previousValue == null) {
    await storage.removeItem(key);
  } else {
    await storage.setItem(key, previousValue);
  }
  return false;
}

/** Restore a previous value only while the value written by this request owns the key. */
export async function restoreStorageValueIfUnchanged(
  storage: AsyncStringStorage,
  key: string,
  expectedValue: string | null,
  previousValue: string | null,
): Promise<void> {
  const currentValue = await storage.getItem(key);
  if (currentValue !== expectedValue) return;

  if (previousValue == null) {
    await storage.removeItem(key);
  } else {
    await storage.setItem(key, previousValue);
  }
}

/** Run sequential global effects while the originating fetch token is valid. */
export async function runEffectsForCurrentRequest(
  isCurrent: CurrentRequestCheck,
  effects: Array<() => Promise<unknown>>,
): Promise<boolean> {
  for (const effect of effects) {
    if (!isCurrent()) return false;
    await effect();
    if (!isCurrent()) return false;
  }
  return true;
}
