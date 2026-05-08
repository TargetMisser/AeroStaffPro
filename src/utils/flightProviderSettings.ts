import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const AIRLABS_API_KEY_SECURE_KEY = 'aerostaff_airlabs_api_key_v1';
const FR24_API_KEY_SECURE_KEY = 'aerostaff_fr24_api_key_v1';
const FLIGHT_PROVIDER_PREFERENCE_KEY = 'aerostaff_flight_provider_preference_v1';

export type FlightProviderPreference = 'auto' | 'staffMonitor' | 'airlabs' | 'fr24';

export const FLIGHT_PROVIDER_PREFERENCES: FlightProviderPreference[] = [
  'auto',
  'staffMonitor',
  'airlabs',
  'fr24',
];

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

export type ProviderApiKeyState = {
  configured: boolean;
  source: 'device' | 'build' | null;
  masked: string | null;
};

export type AirLabsKeyState = ProviderApiKeyState;
export type Fr24KeyState = ProviderApiKeyState;

export type FlightProviderSettingsState = {
  preference: FlightProviderPreference;
  airLabs: AirLabsKeyState;
  fr24: Fr24KeyState;
};

function sanitizeApiKey(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function getBuildAirLabsApiKey(): string {
  const value = typeof process !== 'undefined'
    ? process.env?.EXPO_PUBLIC_AIRLABS_API_KEY
    : undefined;
  return sanitizeApiKey(value);
}

function getBuildFr24ApiKey(): string {
  const value = typeof process !== 'undefined'
    ? process.env?.EXPO_PUBLIC_FR24_API_KEY
    : undefined;
  return sanitizeApiKey(value);
}

function maskApiKey(value: string | null | undefined): string | null {
  const key = sanitizeApiKey(value);
  if (!key) return null;
  if (key.length <= 8) return `${key.slice(0, 2)}••••`;
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export const maskAirLabsApiKey = maskApiKey;
export const maskFr24ApiKey = maskApiKey;

export async function getAirLabsApiKey(): Promise<string | null> {
  try {
    const stored = sanitizeApiKey(await SecureStore.getItemAsync(AIRLABS_API_KEY_SECURE_KEY));
    if (stored) return stored;
  } catch {}

  const buildKey = getBuildAirLabsApiKey();
  return buildKey || null;
}

export async function getFr24ApiKey(): Promise<string | null> {
  try {
    const stored = sanitizeApiKey(await SecureStore.getItemAsync(FR24_API_KEY_SECURE_KEY));
    if (stored) return stored;
  } catch {}

  const buildKey = getBuildFr24ApiKey();
  return buildKey || null;
}

export function isFlightProviderPreference(value: unknown): value is FlightProviderPreference {
  return typeof value === 'string'
    && FLIGHT_PROVIDER_PREFERENCES.includes(value as FlightProviderPreference);
}

export async function getFlightProviderPreference(): Promise<FlightProviderPreference> {
  try {
    const stored = await AsyncStorage.getItem(FLIGHT_PROVIDER_PREFERENCE_KEY);
    return isFlightProviderPreference(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export async function saveFlightProviderPreference(value: FlightProviderPreference): Promise<void> {
  await AsyncStorage.setItem(FLIGHT_PROVIDER_PREFERENCE_KEY, value);
}

export async function getAirLabsKeyState(): Promise<AirLabsKeyState> {
  try {
    const stored = sanitizeApiKey(await SecureStore.getItemAsync(AIRLABS_API_KEY_SECURE_KEY));
    if (stored) {
      return {
        configured: true,
        source: 'device',
        masked: maskApiKey(stored),
      };
    }
  } catch {}

  const buildKey = getBuildAirLabsApiKey();
  return {
    configured: Boolean(buildKey),
    source: buildKey ? 'build' : null,
    masked: maskApiKey(buildKey),
  };
}

export async function getFr24KeyState(): Promise<Fr24KeyState> {
  try {
    const stored = sanitizeApiKey(await SecureStore.getItemAsync(FR24_API_KEY_SECURE_KEY));
    if (stored) {
      return {
        configured: true,
        source: 'device',
        masked: maskApiKey(stored),
      };
    }
  } catch {}

  const buildKey = getBuildFr24ApiKey();
  return {
    configured: Boolean(buildKey),
    source: buildKey ? 'build' : null,
    masked: maskApiKey(buildKey),
  };
}

export async function getFlightProviderSettingsState(): Promise<FlightProviderSettingsState> {
  const [preference, airLabs, fr24] = await Promise.all([
    getFlightProviderPreference(),
    getAirLabsKeyState(),
    getFr24KeyState(),
  ]);

  return { preference, airLabs, fr24 };
}

export async function saveAirLabsApiKey(value: string): Promise<void> {
  const key = sanitizeApiKey(value);
  if (!key) {
    await clearAirLabsApiKey();
    return;
  }

  await SecureStore.setItemAsync(AIRLABS_API_KEY_SECURE_KEY, key);
}

export async function clearAirLabsApiKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AIRLABS_API_KEY_SECURE_KEY);
  } catch {}
}

export async function saveFr24ApiKey(value: string): Promise<void> {
  const key = sanitizeApiKey(value);
  if (!key) {
    await clearFr24ApiKey();
    return;
  }

  await SecureStore.setItemAsync(FR24_API_KEY_SECURE_KEY, key);
}

export async function clearFr24ApiKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(FR24_API_KEY_SECURE_KEY);
  } catch {}
}
