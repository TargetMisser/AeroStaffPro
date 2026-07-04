import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Securely remove a sensitive value from AsyncStorage.
 *
 * AsyncStorage is SQLite-backed: `removeItem` only marks the row as deleted,
 * leaving the plaintext recoverable from unallocated space until the database
 * is vacuumed. Overwriting the value first forces the physical bytes to be
 * replaced, so the original secret can no longer be carved from disk.
 *
 * Returns true only if the value was both overwritten AND removed. If the
 * overwrite fails we deliberately SKIP the delete: dropping the row without
 * scrubbing it first would leave the original plaintext carvable from disk,
 * which defeats the entire purpose of this function. Callers can use the
 * boolean to retry the migration rather than assume the secret was scrubbed.
 */
export async function secureWipeAsyncStorageItem(key: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, '***WIPED***');
  } catch {
    // Could not overwrite the plaintext bytes — leave the (now-stale) row in
    // place so the caller can retry instead of silently deleting an
    // un-scrubbed secret.
    return false;
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Bytes are already scrubbed; failing to drop the row is not a security
    // problem, but report it so the caller knows the wipe was only partial.
    return false;
  }
  return true;
}
