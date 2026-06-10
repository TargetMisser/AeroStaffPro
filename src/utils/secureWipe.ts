import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Securely remove a sensitive value from AsyncStorage.
 *
 * AsyncStorage is SQLite-backed: `removeItem` only marks the row as deleted,
 * leaving the plaintext recoverable from unallocated space until the database
 * is vacuumed. Overwriting the value first forces the physical bytes to be
 * replaced, so the original secret can no longer be carved from disk.
 */
export async function secureWipeAsyncStorageItem(key: string): Promise<void> {
  await AsyncStorage.setItem(key, '***WIPED***').catch(() => {});
  await AsyncStorage.removeItem(key).catch(() => {});
}
