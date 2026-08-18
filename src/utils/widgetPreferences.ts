export const WIDGET_PREFERENCES_KEY = 'aerostaff_widget_preferences_v2';

export type WidgetDisplayMode = 'auto' | 'shift' | 'pinned' | 'load';

export type WidgetPreferences = {
  mode: WidgetDisplayMode;
  workloadWindowMinutes: 60 | 90 | 120;
  showDataAge: boolean;
};

export const DEFAULT_WIDGET_PREFERENCES: WidgetPreferences = {
  mode: 'auto',
  workloadWindowMinutes: 90,
  showDataAge: true,
};

export function parseWidgetPreferences(raw: string | null | undefined): WidgetPreferences {
  if (!raw) return DEFAULT_WIDGET_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<WidgetPreferences>;
    const mode: WidgetDisplayMode = ['auto', 'shift', 'pinned', 'load'].includes(parsed.mode ?? '')
      ? parsed.mode as WidgetDisplayMode
      : DEFAULT_WIDGET_PREFERENCES.mode;
    const workloadWindowMinutes = [60, 90, 120].includes(Number(parsed.workloadWindowMinutes))
      ? Number(parsed.workloadWindowMinutes) as 60 | 90 | 120
      : DEFAULT_WIDGET_PREFERENCES.workloadWindowMinutes;
    return {
      mode,
      workloadWindowMinutes,
      showDataAge: parsed.showDataAge !== false,
    };
  } catch {
    return DEFAULT_WIDGET_PREFERENCES;
  }
}

export type WidgetSelectableFlight = {
  departureTs: number;
  isPinned?: boolean;
};

export type WidgetFlightSelection<T> = {
  flights: T[];
  workloadCount: number;
  workloadLevel: 'calm' | 'busy' | 'peak';
  modeLabel: string;
};

export function selectWidgetFlights<T extends WidgetSelectableFlight>(
  flights: T[],
  preferences: WidgetPreferences,
  nowSeconds = Date.now() / 1000,
): WidgetFlightSelection<T> {
  const sortedFlights = [...flights].sort((left, right) => left.departureTs - right.departureTs);
  const firstUpcoming = sortedFlights.find(flight => flight.departureTs >= nowSeconds);
  const immediateWindowEnd = nowSeconds + preferences.workloadWindowMinutes * 60;
  // For tomorrow's shift (or a long gap), measure the first upcoming block
  // instead of displaying a misleading zero-load badge.
  const windowStart = firstUpcoming && firstUpcoming.departureTs > immediateWindowEnd
    ? firstUpcoming.departureTs
    : nowSeconds;
  const windowEnd = windowStart + preferences.workloadWindowMinutes * 60;
  const workloadFlights = sortedFlights.filter(flight => flight.departureTs >= windowStart && flight.departureTs <= windowEnd);
  const workloadCount = workloadFlights.length;
  const workloadLevel = workloadCount >= 5 ? 'peak' : workloadCount >= 3 ? 'busy' : 'calm';

  if (preferences.mode === 'pinned') {
    const pinned = sortedFlights.find(flight => flight.isPinned);
    return {
      flights: pinned ? [pinned] : sortedFlights.slice(0, 1),
      workloadCount,
      workloadLevel,
      modeLabel: pinned ? 'Volo pinnato' : 'Prossimo volo',
    };
  }

  if (preferences.mode === 'load') {
    return {
      flights: (workloadFlights.length > 0 ? workloadFlights : sortedFlights).slice(0, 3),
      workloadCount,
      workloadLevel,
      modeLabel: `Carico ${preferences.workloadWindowMinutes} min`,
    };
  }

  return {
    flights: sortedFlights,
    workloadCount,
    workloadLevel,
    modeLabel: preferences.mode === 'shift' ? 'Turno completo' : 'Automatico',
  };
}

export function getWidgetFreshness(
  updatedAtTs: number | undefined,
  nowMs = Date.now(),
  offline = false,
): 'fresh' | 'stale' | 'offline' {
  if (offline) return 'offline';
  if (!updatedAtTs || nowMs - updatedAtTs > 15 * 60 * 1000) return 'stale';
  return 'fresh';
}
