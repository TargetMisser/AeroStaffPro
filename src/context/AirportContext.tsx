import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AIRPORT_STORAGE_KEY,
  DEFAULT_AIRPORT_CODE,
  getAirportAirlines,
  getAirportInfo,
  getStoredAirportAirlineMap,
  getStoredAirportCode,
  normalizeAirportCode,
  type AirportInfo,
} from '../utils/airportSettings';

const PROFILE_STORAGE_KEY = 'aerostaff_airport_profiles_v1';
const ACTIVE_PROFILE_STORAGE_KEY = 'aerostaff_active_profile_id_v1';
const FLIGHT_FILTER_STORAGE_KEY = 'aerostaff_flight_filter_v1';

export type AirportProfile = {
  id: string;
  name: string;
  airportCode: string;
  airlines: string[];
  createdAt: number;
  updatedAt: number;
};

type SaveProfileInput = {
  id?: string;
  name: string;
  airportCode: string;
  airlines: string[];
  activate?: boolean;
};

type AirportContextValue = {
  airportCode: string;
  airport: AirportInfo;
  setAirportCode: (code: string) => Promise<void>;
  isLoading: boolean;
  profiles: AirportProfile[];
  activeProfile: AirportProfile | null;
  activeProfileId: string | null;
  profileInitials: string;
  switchProfile: (profileId: string) => Promise<void>;
  saveProfile: (input: SaveProfileInput) => Promise<AirportProfile>;
  deleteProfile: (profileId: string) => Promise<void>;
  setSelectedAirlines: (airlines: string[]) => Promise<void>;
};

function makeProfileId(): string {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)));
}

function parseJsonOr<T>(raw: string | null, fallback: T): unknown {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sanitizeAirlines(airportCode: string, airlines: string[] | undefined, fallbackToAirportDefaults = false): string[] {
  const allowed = getAirportAirlines(airportCode);
  if (!Array.isArray(airlines)) {
    return fallbackToAirportDefaults ? [...allowed] : [];
  }

  const next = uniqueStrings(airlines).filter(key => allowed.includes(key));
  if (next.length > 0) {
    return next;
  }

  return airlines.length === 0 && !fallbackToAirportDefaults ? [] : [...allowed];
}

function sanitizeProfileName(name: string, airportCode: string): string {
  const trimmed = name.trim();
  if (trimmed) {
    return trimmed;
  }

  const airport = getAirportInfo(airportCode);
  return airport.isCustom ? airport.code : airport.city;
}

function sanitizeProfile(raw: Partial<AirportProfile>, fallbackAirportCode = DEFAULT_AIRPORT_CODE): AirportProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const airportCode = normalizeAirportCode(typeof raw.airportCode === 'string' && raw.airportCode
    ? raw.airportCode
    : fallbackAirportCode);
  if (!airportCode) {
    return null;
  }

  const now = Date.now();
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : makeProfileId();

  return {
    id,
    name: sanitizeProfileName(typeof raw.name === 'string' ? raw.name : '', airportCode),
    airportCode,
    airlines: sanitizeAirlines(
      airportCode,
      Array.isArray(raw.airlines) ? raw.airlines : undefined,
      !Array.isArray(raw.airlines),
    ),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

function getProfileInitials(profile: AirportProfile | null): string {
  if (!profile) {
    return 'MR';
  }

  const parts = profile.name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  const compact = profile.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (compact.length >= 2) {
    return compact.slice(0, 2);
  }

  return profile.airportCode.slice(0, 2);
}

function createDefaultProfile(airportCode: string, airlines: string[] | undefined, fallbackToAirportDefaults = true): AirportProfile {
  const now = Date.now();
  const airport = getAirportInfo(airportCode);

  return {
    id: makeProfileId(),
    name: airport.isCustom ? airport.code : airport.city,
    airportCode,
    airlines: sanitizeAirlines(airportCode, airlines, fallbackToAirportDefaults),
    createdAt: now,
    updatedAt: now,
  };
}

const defaultAirport = getAirportInfo(DEFAULT_AIRPORT_CODE);

const AirportContext = createContext<AirportContextValue>({
  airportCode: defaultAirport.code,
  airport: defaultAirport,
  setAirportCode: async () => {},
  isLoading: false,
  profiles: [],
  activeProfile: null,
  activeProfileId: null,
  profileInitials: 'MR',
  switchProfile: async () => {},
  saveProfile: async () => createDefaultProfile(DEFAULT_AIRPORT_CODE, getAirportAirlines(DEFAULT_AIRPORT_CODE)),
  deleteProfile: async () => {},
  setSelectedAirlines: async () => {},
});

export function AirportProvider({ children }: { children: React.ReactNode }) {
  const [airportCode, setAirportCodeState] = useState(DEFAULT_AIRPORT_CODE);
  const [profiles, setProfiles] = useState<AirportProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hydrateFailed = useRef(false);

  const commitState = useCallback(async (nextProfiles: AirportProfile[], preferredActiveProfileId?: string | null) => {
    const activeProfile = nextProfiles.find(profile => profile.id === preferredActiveProfileId) ?? nextProfiles[0] ?? null;
    const nextAirportCode = activeProfile?.airportCode ?? DEFAULT_AIRPORT_CODE;
    const nextAirlines = activeProfile?.airlines ?? getAirportAirlines(nextAirportCode);

    setProfiles(nextProfiles);
    setActiveProfileId(activeProfile?.id ?? null);
    setAirportCodeState(nextAirportCode);

    const writes: [string, string][] = [
      [AIRPORT_STORAGE_KEY, nextAirportCode],
      [FLIGHT_FILTER_STORAGE_KEY, JSON.stringify(nextAirlines)],
    ];
    if (!hydrateFailed.current) {
      writes.push([PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles)]);
    }

    if (activeProfile?.id && !hydrateFailed.current) {
      writes.push([ACTIVE_PROFILE_STORAGE_KEY, activeProfile.id]);
    }

    await AsyncStorage.multiSet(writes);
  }, []);

  useEffect(() => {
    let mounted = true;

    const hydrate = async () => {
      try {
        await getStoredAirportAirlineMap();
        const [storedAirportCode, filterRaw, profilesRaw, activeProfileRaw] = await Promise.all([
          getStoredAirportCode(),
          AsyncStorage.getItem(FLIGHT_FILTER_STORAGE_KEY),
          AsyncStorage.getItem(PROFILE_STORAGE_KEY),
          AsyncStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY),
        ]);

        const fallbackAirportCode = normalizeAirportCode(storedAirportCode) || DEFAULT_AIRPORT_CODE;
        const filterParsed = parseJsonOr(filterRaw, []);
        const storedFilter = Array.isArray(filterParsed) ? uniqueStrings(filterParsed) : [];
        const profilesParsed = parseJsonOr(profilesRaw, null);
        if (profilesRaw != null && !Array.isArray(profilesParsed)) {
          // Stored profiles exist but can't be read: never replace them with a default.
          throw new Error('AIRPORT_PROFILES_UNREADABLE');
        }
        const parsedProfiles = Array.isArray(profilesParsed) ? (profilesParsed as Partial<AirportProfile>[]) : [];
        // One broken entry must not cost the user every other profile.
        const sanitizedProfiles = parsedProfiles
          .map(profile => {
            try {
              return sanitizeProfile(profile, fallbackAirportCode);
            } catch {
              return null;
            }
          })
          .filter((profile): profile is AirportProfile => profile !== null);
        const nextProfiles = sanitizedProfiles.length > 0
          ? sanitizedProfiles.map(profile => ({
              ...profile,
              airlines: sanitizeAirlines(profile.airportCode, profile.airlines, false),
            }))
          : [createDefaultProfile(fallbackAirportCode, storedFilter, filterRaw === null)];
        const activeProfile = nextProfiles.find(profile => profile.id === activeProfileRaw) ?? nextProfiles[0];

        if (!mounted) {
          return;
        }

        setProfiles(nextProfiles);
        setActiveProfileId(activeProfile.id);
        setAirportCodeState(activeProfile.airportCode);

        await AsyncStorage.multiSet([
          [PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles)],
          [ACTIVE_PROFILE_STORAGE_KEY, activeProfile.id],
          [AIRPORT_STORAGE_KEY, activeProfile.airportCode],
          [FLIGHT_FILTER_STORAGE_KEY, JSON.stringify(activeProfile.airlines)],
        ]);
      } catch {
        // The in-memory fallback keeps the app usable, but must never be written
        // over the stored profiles (see commitState).
        hydrateFailed.current = true;
        if (!mounted) {
          return;
        }

        const fallback = createDefaultProfile(DEFAULT_AIRPORT_CODE, getAirportAirlines(DEFAULT_AIRPORT_CODE));
        setProfiles([fallback]);
        setActiveProfileId(fallback.id);
        setAirportCodeState(fallback.airportCode);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    hydrate().catch(() => {
      if (mounted) {
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const activeProfile = useMemo(
    () => profiles.find(profile => profile.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  const setAirportCode = useCallback(async (code: string) => {
    if (!activeProfileId) {
      return;
    }

    const normalizedCode = normalizeAirportCode(code);
    if (!normalizedCode) {
      throw new Error('INVALID_AIRPORT_CODE');
    }

    const now = Date.now();
    const nextProfiles = profiles.map(profile => {
      if (profile.id !== activeProfileId) {
        return profile;
      }

      return {
        ...profile,
        airportCode: normalizedCode,
        airlines: sanitizeAirlines(normalizedCode, profile.airlines),
        updatedAt: now,
      };
    });

    await commitState(nextProfiles, activeProfileId);
  }, [activeProfileId, commitState, profiles]);

  const setSelectedAirlines = useCallback(async (airlines: string[]) => {
    if (!activeProfileId) {
      return;
    }

    const now = Date.now();
    const nextProfiles = profiles.map(profile => {
      if (profile.id !== activeProfileId) {
        return profile;
      }

      return {
        ...profile,
        airlines: sanitizeAirlines(profile.airportCode, airlines),
        updatedAt: now,
      };
    });

    await commitState(nextProfiles, activeProfileId);
  }, [activeProfileId, commitState, profiles]);

  const switchProfile = useCallback(async (profileId: string) => {
    if (!profiles.some(profile => profile.id === profileId)) {
      throw new Error('PROFILE_NOT_FOUND');
    }

    await commitState(profiles, profileId);
  }, [commitState, profiles]);

  const saveProfile = useCallback(async (input: SaveProfileInput) => {
    const now = Date.now();
    const existing = input.id
      ? profiles.find(profile => profile.id === input.id) ?? null
      : null;
    const nextProfile = sanitizeProfile({
      id: input.id,
      name: input.name,
      airportCode: input.airportCode,
      airlines: input.airlines,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    if (!nextProfile) {
      throw new Error('INVALID_PROFILE');
    }

    const nextProfiles = existing
      ? profiles.map(profile => profile.id === existing.id ? nextProfile : profile)
      : [...profiles, nextProfile];
    const nextActiveProfileId = input.activate === false
      ? activeProfileId ?? nextProfile.id
      : nextProfile.id;

    await commitState(nextProfiles, nextActiveProfileId);
    return nextProfile;
  }, [activeProfileId, commitState, profiles]);

  const deleteProfile = useCallback(async (profileId: string) => {
    if (profiles.length <= 1) {
      throw new Error('LAST_PROFILE');
    }

    const nextProfiles = profiles.filter(profile => profile.id !== profileId);
    const nextActiveProfileId = activeProfileId === profileId
      ? nextProfiles[0]?.id ?? null
      : activeProfileId;

    await commitState(nextProfiles, nextActiveProfileId);
  }, [activeProfileId, commitState, profiles]);

  const airport = useMemo(() => getAirportInfo(airportCode), [airportCode]);
  const profileInitials = useMemo(() => getProfileInitials(activeProfile), [activeProfile]);

  return (
    <AirportContext.Provider
      value={{
        airportCode,
        airport,
        setAirportCode,
        isLoading,
        profiles,
        activeProfile,
        activeProfileId,
        profileInitials,
        switchProfile,
        saveProfile,
        deleteProfile,
        setSelectedAirlines,
      }}
    >
      {children}
    </AirportContext.Provider>
  );
}

export function useAirport() {
  return useContext(AirportContext);
}
