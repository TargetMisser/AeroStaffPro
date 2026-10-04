import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { secureWipeAsyncStorageItem } from './secureWipe';
import { getErrorMessage } from './errorUtils';
import { sanitizeNotificationSettings } from './flightNotificationSettings';

const BACKUP_VERSION = 2;

const PASSWORDS_KEY = 'aerostaff_passwords_v1';
const PIN_KEY = 'aerostaff_pin_v1';
const PIN_ENABLED_KEY = 'aerostaff_pin_enabled_v1';

// Only non-sensitive data is exported. Passwords and PINs stay in SecureStore.
const SAFE_BACKUP_KEYS = [
  'aerostaff_notepad_v1',
  'aerostaff_handover_v1',
  'aerostaff_compensation_rules_v1',
  'aerostaff_widget_preferences_v2',
  'aerostaff_phonebook_v1',
  'aerostaff_airport_code_v1',
  'aerostaff_airport_airlines_v1',
  'aerostaff_airport_profiles_v1',
  'aerostaff_active_profile_id_v1',
  'aerostaff_language_v1',
  'aerostaff_theme_mode',
  'aerostaff_flight_filter_v1',
  'aerostaff_flight_provider_preference_v1',
  'manuals_data_v2',
  '@shift_import_name',
  'aerostaff_notif_enabled',
  'aerostaff_notif_settings_v1',
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

// Screens trust the shape of these keys, so a hand-edited or corrupted backup
// must not reach storage as-is: repair what can be repaired, drop the rest.
const JSON_IMPORT_SANITIZERS: Record<string, (parsed: unknown) => unknown> = {
  aerostaff_notif_settings_v1: parsed => (isPlainObject(parsed) ? sanitizeNotificationSettings(parsed) : null),
  aerostaff_phonebook_v1: parsed => (Array.isArray(parsed) ? parsed.filter(isPlainObject) : null),
  aerostaff_airport_profiles_v1: parsed => (Array.isArray(parsed) ? parsed.filter(isPlainObject) : null),
  aerostaff_airport_airlines_v1: parsed => (Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : null),
  manuals_data_v2: parsed => (Array.isArray(parsed)
    ? parsed.filter(isPlainObject).map(airline => ({
      ...airline,
      sections: Array.isArray(airline.sections) ? airline.sections.filter(isPlainObject) : [],
    }))
    : null),
};

export function safeImportValue(key: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const sanitize = JSON_IMPORT_SANITIZERS[key];
  if (!sanitize) return value;
  try {
    const sanitized = sanitize(JSON.parse(value));
    return sanitized == null ? null : JSON.stringify(sanitized);
  } catch {
    return null;
  }
}

export type BackupResult = { ok: true } | { ok: false; error: string };

async function importLegacySensitiveData(data: Record<string, unknown>): Promise<number> {
  let imported = 0;
  let hasImportedPin = false;

  const legacyPasswords = data[PASSWORDS_KEY];
  if (typeof legacyPasswords === 'string' && legacyPasswords.trim()
    && isPasswordList(legacyPasswords) && !(await hasStoredPasswords())) {
    await SecureStore.setItemAsync(PASSWORDS_KEY, legacyPasswords);
    // Only scrub the plaintext copy once the secret is confirmed durably in
    // the keychain. A silently-failed SecureStore write must not lead us to
    // destroy the only remaining copy of the user's passwords.
    if ((await SecureStore.getItemAsync(PASSWORDS_KEY)) === legacyPasswords) {
      await secureWipeAsyncStorageItem(PASSWORDS_KEY);
      imported += 1;
    }
  }

  const legacyPin = data[PIN_KEY];
  if (typeof legacyPin === 'string' && legacyPin.trim()) {
    await SecureStore.setItemAsync(PIN_KEY, legacyPin);
    // Same guard as the passwords above: confirm the keychain write before
    // wiping the plaintext PIN so a failed write can't lose it.
    if ((await SecureStore.getItemAsync(PIN_KEY)) === legacyPin) {
      await secureWipeAsyncStorageItem(PIN_KEY);
      hasImportedPin = true;
      imported += 1;
    }
  }

  // An import may turn the PIN on (when it brought a PIN with it) but never
  // off: v1 backups carry "pin enabled: true" with the PIN itself already in
  // SecureStore (null in the file), which used to silently disable the lock.
  const legacyPinEnabled = data[PIN_ENABLED_KEY];
  if (legacyPinEnabled === 'true' && hasImportedPin) {
    await AsyncStorage.setItem(PIN_ENABLED_KEY, 'true');
    imported += 1;
  }

  return imported;
}

function isPasswordList(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isPlainObject);
  } catch {
    return false;
  }
}

// Never replace a vault that already holds passwords with a backup's copy.
// If the current vault can't be read, treat it as occupied: overwriting an
// unreadable vault is exactly how passwords get lost.
async function hasStoredPasswords(): Promise<boolean> {
  try {
    const current = await SecureStore.getItemAsync(PASSWORDS_KEY);
    if (!current) return false;
    const parsed = JSON.parse(current);
    return !Array.isArray(parsed) || parsed.length > 0;
  } catch {
    return true;
  }
}

export async function exportBackup(): Promise<BackupResult> {
  try {
    const pairs = await AsyncStorage.multiGet(SAFE_BACKUP_KEYS);
    const data: Record<string, string | null> = {};
    for (const [key, value] of pairs) data[key] = value;

    const payload = JSON.stringify({ version: BACKUP_VERSION, exportedAt: Date.now(), data }, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `AeroStaffPro-backup-${dateStr}.json`;

    // Ask user to choose a folder via SAF
    const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perms.granted) return { ok: false, error: 'Permesso negato' };

    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      perms.directoryUri,
      filename,
      'application/json',
    );
    await FileSystem.writeAsStringAsync(fileUri, payload, { encoding: FileSystem.EncodingType.UTF8 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getErrorMessage(e, 'Errore sconosciuto') };
  }
}

export async function importBackup(): Promise<BackupResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (result.canceled) return { ok: false, error: 'Annullato' };

    const uri = result.assets[0].uri;
    const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'File non valido' };
    }

    if (!parsed.version || !parsed.data || typeof parsed.data !== 'object') {
      return { ok: false, error: 'Formato backup non riconosciuto' };
    }

    const data = parsed.data as Record<string, unknown>;
    const pairs: [string, string][] = Object.entries(data)
      .filter(([key]) => SAFE_BACKUP_KEYS.includes(key))
      .flatMap(([key, val]) => {
        const value = safeImportValue(key, val);
        return value === null ? [] : [[key, value] as [string, string]];
      });
    // Secrets have not been exported since v2; only v1 files may carry them.
    const importedLegacySensitive = Number(parsed.version) < BACKUP_VERSION
      ? await importLegacySensitiveData(data)
      : 0;

    if (pairs.length === 0 && importedLegacySensitive === 0) {
      return { ok: false, error: 'Nessun dato trovato nel backup' };
    }

    if (pairs.length > 0) {
      await AsyncStorage.multiSet(pairs);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getErrorMessage(e, 'Errore sconosciuto') };
  }
}
