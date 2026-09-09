import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import type { HexColor } from '../utils/airlineOps';
import { getAirlineOps, getAirlineColor } from '../utils/airlineOps';
import { getStoredAirportCode, buildFr24ScheduleUrl, getStoredAirportAirlines, storeDetectedAirportAirlines, getAirportInfo } from '../utils/airportSettings';
import {
  filterFlightsByAirlines,
  getFlightAirportLabel,
  getFlightBestTs,
  getFlightScheduledTs,
  isFlightServiceMatch,
} from '../utils/flightScheduleAdapter';
import { staffMonitorProvider } from '../utils/flightProviders/staffMonitorProvider';
import { applyLiveDepartureStatus, fetchAdsbAircraft } from '../utils/liveArrivalEta';
import { ShiftWidget } from './ShiftWidget';
import { getStoredWidgetThemeProps } from './widgetTheme';
import {
  WIDGET_PREFERENCES_KEY,
  getWidgetFreshness,
  parseWidgetPreferences,
  selectWidgetFlights,
  type WidgetDisplayMode,
  type WidgetPreferences,
} from '../utils/widgetPreferences';

/** Key used by the main app (FlightScreen) to push pre-built widget data */
export const WIDGET_CACHE_KEY = 'widget_data_cache_v1';

/** Key used to store today's shift data so the widget can self-update */
export const WIDGET_SHIFT_KEY = 'widget_shift_v1';

const PINNED_FLIGHT_KEY = 'pinned_flight_v1';

export const WIDGET_REFRESH_TIMEOUT_MS = 6_000;

// ─── Types ──────────────────────────────────────────────────────────────────────
export type WidgetFlight = {
  flightNumber: string;
  destinationIata: string;
  departureTime: string;
  ciOpen: string;
  ciClose: string;
  gateOpen: string;
  gateClose: string;
  airlineColor: HexColor;
  departureTs: number;
  isPinned?: boolean;
  stand?: string;
  checkin?: string;
  gate?: string;
};

export type WidgetPresentation = {
  mode: WidgetDisplayMode;
  modeLabel: string;
  freshness: 'fresh' | 'stale' | 'offline';
  showDataAge: boolean;
  workloadCount: number;
  workloadWindowMinutes: number;
  workloadLevel: 'calm' | 'busy' | 'peak';
};

export type WidgetData =
  | { state: 'work'; shiftLabel: string; flights: WidgetFlight[]; updatedAt: string; updatedAtTs?: number; presentation?: WidgetPresentation }
  | { state: 'work_empty'; shiftLabel: string; updatedAt: string; updatedAtTs?: number; presentation?: WidgetPresentation }
  | { state: 'rest' }
  | { state: 'no_shift' }
  | { state: 'error' };

export type WidgetShiftWindow = {
  date: string;
  start: number;
  end: number;
};

export type WidgetShiftData = {
  date: string; // 'YYYY-MM-DD' — the day this shift data refers to
  shiftToday: { start: number; end: number } | null;
  isRestDay: boolean;
  nextShift?: WidgetShiftWindow | null;
};

async function readWidgetPreferences(): Promise<WidgetPreferences> {
  try {
    return parseWidgetPreferences(await AsyncStorage.getItem(WIDGET_PREFERENCES_KEY));
  } catch {
    return parseWidgetPreferences(null);
  }
}

function presentWidgetData(
  data: WidgetData,
  preferences: WidgetPreferences,
  offline = false,
): WidgetData {
  if (data.state !== 'work' && data.state !== 'work_empty') return data;
  const selection = selectWidgetFlights(data.state === 'work' ? data.flights : [], preferences);
  const presentation: WidgetPresentation = {
    mode: preferences.mode,
    modeLabel: selection.modeLabel,
    freshness: getWidgetFreshness(data.updatedAtTs, Date.now(), offline),
    showDataAge: preferences.showDataAge,
    workloadCount: selection.workloadCount,
    workloadWindowMinutes: preferences.workloadWindowMinutes,
    workloadLevel: selection.workloadLevel,
  };
  return data.state === 'work'
    ? { ...data, flights: selection.flights, presentation }
    : { ...data, presentation };
}

function markWidgetOffline(data: WidgetData): WidgetData {
  if (data.state !== 'work' && data.state !== 'work_empty') return data;
  return data.presentation
    ? { ...data, presentation: { ...data.presentation, freshness: 'offline' } }
    : data;
}

export function preserveCachedWidgetFlights(
  nextData: WidgetData,
  cachedData: WidgetData | null,
): WidgetData {
  if (
    nextData.state === 'work_empty'
    && cachedData?.state === 'work'
    && cachedData.shiftLabel === nextData.shiftLabel
    && cachedData.flights.length > 0
  ) {
    return cachedData;
  }
  return nextData;
}

export async function storeWidgetDataPreservingFlights(nextData: WidgetData): Promise<WidgetData> {
  let cachedData: WidgetData | null = null;
  if (nextData.state === 'work_empty') {
    try {
      const raw = await AsyncStorage.getItem(WIDGET_CACHE_KEY);
      cachedData = raw ? JSON.parse(raw) as WidgetData : null;
    } catch {}
  }

  const dataToStore = preserveCachedWidgetFlights(nextData, cachedData);
  await AsyncStorage.setItem(WIDGET_CACHE_KEY, JSON.stringify(dataToStore));
  return dataToStore;
}

function fmtTs(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toLocalIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

type ResolvedWidgetShift = {
  shift: WidgetShiftWindow;
  shiftLabel: string;
};

function resolveWidgetShift(shiftData: WidgetShiftData): ResolvedWidgetShift | 'rest' | null {
  const now = Date.now() / 1000;
  const todayIso = toLocalIso();
  const tomorrowIso = toLocalIso(addDays(new Date(), 1));
  const currentShift = shiftData.shiftToday
    ? { date: shiftData.date, start: shiftData.shiftToday.start, end: shiftData.shiftToday.end }
    : null;
  const nextShift = shiftData.nextShift ?? null;

  if (shiftData.date === todayIso) {
    if (currentShift && now <= currentShift.end) {
      return { shift: currentShift, shiftLabel: `${fmtTs(currentShift.start)} – ${fmtTs(currentShift.end)}` };
    }
    if ((!currentShift || now > currentShift.end) && nextShift && nextShift.date === tomorrowIso && nextShift.start > now) {
      return { shift: nextShift, shiftLabel: `Domani ${fmtTs(nextShift.start)} – ${fmtTs(nextShift.end)}` };
    }
    if (shiftData.isRestDay) return 'rest';
    return null;
  }

  // If the app wrote tomorrow's shift yesterday, use it after midnight until fresh data arrives.
  if (nextShift && nextShift.date === todayIso && now <= nextShift.end) {
    return { shift: nextShift, shiftLabel: `${fmtTs(nextShift.start)} – ${fmtTs(nextShift.end)}` };
  }

  return null;
}

/*---------------------------------------------------------------------------*\
| Lo snapshot turni (WIDGET_SHIFT_KEY) è scritto dall'app e copre solo oggi e |
| domani: se l'app non viene aperta per più di un giorno, il widget restava   |
| su "nessun turno" fino alla successiva apertura. Qui il task del widget     |
| rilegge da solo i turni dal calendario di sistema (stessa logica delle      |
| schermate) e riscrive lo snapshot. Solo verifica del permesso, mai prompt:  |
| in un contesto headless non c'è UI. In caso di errore si torna al vecchio   |
| comportamento basato sullo snapshot esistente.                              |
\*---------------------------------------------------------------------------*/
async function refreshShiftSnapshotFromCalendar(): Promise<WidgetShiftData | null> {
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== 'granted') return null;

    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const cal = cals.find(c => c.allowsModifications && c.isPrimary) || cals.find(c => c.allowsModifications);
    if (!cal) return null;

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = addDays(todayStart, -1);
    const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);
    const tomorrowStart = addDays(todayStart, 1);
    const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setHours(23, 59, 59, 999);
    // Android only returns events fully contained in the query window. Start
    // yesterday for an ongoing 22:00-06:00 shift and extend one day past
    // tomorrow so tomorrow's night shift is contained as well.
    const queryEnd = addDays(tomorrowEnd, 1);

    let shiftToday: { start: number; end: number } | null = null;
    let shiftTomorrow: { start: number; end: number } | null = null;
    const events = await Calendar.getEventsAsync([cal.id], yesterdayStart, queryEnd);
    const workEvents = events
      .filter(event => event.title.trim() === 'Lavoro')
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    const currentWork = workEvents.find(event => (
      new Date(event.startDate).getTime() <= now.getTime()
      && new Date(event.endDate).getTime() > now.getTime()
    ));
    const todayWork = workEvents.find(event => {
      const start = new Date(event.startDate);
      return start >= todayStart && start <= todayEnd;
    });
    const tomorrowWork = workEvents.find(event => {
      const start = new Date(event.startDate);
      return start >= tomorrowStart && start <= tomorrowEnd;
    });
    const activeOrTodayWork = currentWork ?? todayWork;

    if (activeOrTodayWork) {
      shiftToday = {
        start: new Date(activeOrTodayWork.startDate).getTime() / 1000,
        end: new Date(activeOrTodayWork.endDate).getTime() / 1000,
      };
    }
    if (tomorrowWork) {
      shiftTomorrow = {
        start: new Date(tomorrowWork.startDate).getTime() / 1000,
        end: new Date(tomorrowWork.endDate).getTime() / 1000,
      };
    }
    const isRestDay = !shiftToday && events.some(event => {
      if (event.title.trim() !== 'Riposo') return false;
      const start = new Date(event.startDate);
      return start >= todayStart && start <= todayEnd;
    });

    const snapshot: WidgetShiftData = {
      date: toLocalIso(todayStart),
      shiftToday,
      isRestDay,
      nextShift: shiftTomorrow ? { date: toLocalIso(tomorrowStart), ...shiftTomorrow } : null,
    };
    await AsyncStorage.setItem(WIDGET_SHIFT_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null;
  }
}

async function readShiftSnapshot(refreshFromCalendar = false): Promise<WidgetShiftData | null> {
  const shiftRaw = await AsyncStorage.getItem(WIDGET_SHIFT_KEY);
  let shiftData: WidgetShiftData | null = shiftRaw ? JSON.parse(shiftRaw) : null;
  if (refreshFromCalendar || !shiftData || shiftData.date !== toLocalIso()) {
    shiftData = (await refreshShiftSnapshotFromCalendar()) ?? shiftData;
  }
  return shiftData;
}

// ─── Read cached data written by the main app ──────────────────────────────────
export async function getWidgetData({ refreshShiftSnapshot = false }: { refreshShiftSnapshot?: boolean } = {}): Promise<WidgetData> {
  try {
    const preferences = await readWidgetPreferences();
    const shiftData = await readShiftSnapshot(refreshShiftSnapshot);

    if (shiftData) {
      const resolved = resolveWidgetShift(shiftData);
      if (resolved === 'rest') return { state: 'rest' };
      if (resolved) {
        const { shiftLabel } = resolved;

        // It's a work day — return cached flight data only if it matches the active shift.
        // A stale current-shift cache must not override the automatic next-day handoff.
        const cached = await AsyncStorage.getItem(WIDGET_CACHE_KEY);
        if (cached) {
          const data: WidgetData = JSON.parse(cached);
          if ((data.state === 'work' || data.state === 'work_empty') && data.shiftLabel === shiftLabel) {
            return presentWidgetData(data, preferences);
          }
        }
        // Cache is stale or missing — show work_empty until periodic update runs.
        return presentWidgetData({ state: 'work_empty', shiftLabel, updatedAt: '' }, preferences);
      }
      // An empty current snapshot must not resurrect flights from an undone import.
      if (shiftData.date === toLocalIso()) return { state: 'no_shift' };
    }

    // Shift key is missing or from a different day — fall back to cache.
    const cached = await AsyncStorage.getItem(WIDGET_CACHE_KEY);
    if (!cached) return { state: 'error' };
    const data: WidgetData = JSON.parse(cached);
    // Rest/no_shift cached but shift key is stale → treat as no_shift.
    if (data.state === 'rest' || data.state === 'no_shift') return { state: 'no_shift' };
    return presentWidgetData(data, preferences);
  } catch {}
  return { state: 'error' };
}

async function renderThemedWidget(props: WidgetTaskHandlerProps, data: WidgetData): Promise<void> {
  const { themeMode, themeSnapshot } = await getStoredWidgetThemeProps();
  props.renderWidget(
    <ShiftWidget
      data={data}
      width={props.widgetInfo.width}
      height={props.widgetInfo.height}
      themeMode={themeMode}
      themeSnapshot={themeSnapshot}
    />,
  );
}

async function withWidgetRefreshTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('WIDGET_REFRESH_TIMEOUT')), WIDGET_REFRESH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Fetch fresh widget data from the live provider + cached shift key ────────
export async function fetchFreshWidgetData(): Promise<WidgetData> {
  try {
    const preferences = await readWidgetPreferences();
    const shiftData = await readShiftSnapshot();
    if (!shiftData) return getWidgetData();

    const resolved = resolveWidgetShift(shiftData);
    if (resolved === 'rest') return { state: 'rest' };
    if (!resolved) return { state: 'no_shift' };

    const activeShift = resolved.shift;
    const airportCode = await getStoredAirportCode();
    const allAirlines = await getStoredAirportAirlines(airportCode);
    const filterRaw = await AsyncStorage.getItem('aerostaff_flight_filter_v1');
    const allowedAirlines: string[] = filterRaw ? JSON.parse(filterRaw) : allAirlines;
    const pinnedRaw = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
    let pinnedDeparture: any | null = null;
    if (pinnedRaw) {
      try {
        const storedPin = JSON.parse(pinnedRaw);
        if (storedPin?._pinTab !== 'arrivals') pinnedDeparture = storedPin;
      } catch {}
    }

    // Source departures from the real provider (StaffMonitor) where supported,
    // so the background widget refresh actually works. The previous FR24 public
    // endpoint returns 403, so the periodic morning update never got fresh data.
    // FR24 public stays as the fallback for airports StaffMonitor doesn't cover.
    const airportInfo = getAirportInfo(airportCode);
    let allDepartures: any[] = [];
    if (staffMonitorProvider.supports({ airportCode, airport: airportInfo, now: new Date() })) {
      const result = await staffMonitorProvider.fetch({ airportCode, airport: airportInfo, now: new Date() });
      allDepartures = result.allDepartures;
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(buildFr24ScheduleUrl(airportCode), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
        const json = await res.json();
        allDepartures = json.result?.response?.airport?.pluginData?.schedule?.departures?.data || [];
      } finally {
        clearTimeout(timer);
      }
    }
    await storeDetectedAirportAirlines(airportCode, allDepartures);

    // Live takeoff detection from open ADS-B (best-effort, one extra call).
    // Marks departures whose aircraft is already airborne and outbound as
    // departed, so the widget shows the real time instead of only the FIDS
    // estimate. Skips the costly per-aircraft route lookups used on the full
    // Voli screen — the background refresh stays one cheap request. If ADS-B
    // doesn't answer in time the StaffMonitor times are kept as-is.
    if (airportInfo.latitude != null && airportInfo.longitude != null) {
      const adsbController = new AbortController();
      const adsbTimer = setTimeout(() => adsbController.abort(), 6000);
      try {
        const aircraft = await fetchAdsbAircraft(
          airportInfo.latitude,
          airportInfo.longitude,
          undefined,
          adsbController.signal,
        );
        allDepartures = applyLiveDepartureStatus(allDepartures, aircraft, airportInfo.latitude, airportInfo.longitude);
      } catch {
        // best-effort: keep StaffMonitor times when ADS-B is unavailable
      } finally {
        clearTimeout(adsbTimer);
      }
    }

    const fmtOff = (dep: number, off: number) => fmtTs(dep - off * 60);
    const nowHH = fmtTs(Date.now() / 1000);
    const shiftLabel = resolved.shiftLabel;

    const filteredDeps = filterFlightsByAirlines(allDepartures, allowedAirlines);

    const wFlights: WidgetFlight[] = filteredDeps
      .filter(item => {
        const scheduledTs = getFlightScheduledTs(item, 'departure');
        if (scheduledTs == null) return false;
        const airline = item.flight?.airline?.name || '';
        const ops = getAirlineOps(airline);
        const ciO = scheduledTs - ops.checkInOpen * 60, ciC = scheduledTs - ops.checkInClose * 60;
        const gO = scheduledTs - ops.gateOpen * 60, gC = scheduledTs - ops.gateClose * 60;
        return (ciO <= activeShift.end && ciC >= activeShift.start) || (gO <= activeShift.end && gC >= activeShift.start);
      })
      .map(item => {
        const departureTs = getFlightBestTs(item, 'departure')!;
        const scheduledTs = getFlightScheduledTs(item, 'departure')!;
        const airline = item.flight?.airline?.name || 'Sconosciuta';
        const ops = getAirlineOps(airline);
        const fn = item.flight?.identification?.number?.default || 'N/A';
        return {
          flightNumber: fn,
          destinationIata: getFlightAirportLabel(item.flight?.airport?.destination, 'N/A'),
          departureTs,
          departureTime: fmtTs(departureTs),
          ciOpen: fmtOff(scheduledTs, ops.checkInOpen), ciClose: fmtOff(scheduledTs, ops.checkInClose),
          gateOpen: fmtOff(scheduledTs, ops.gateOpen), gateClose: fmtOff(scheduledTs, ops.gateClose),
          airlineColor: getAirlineColor(airline),
          isPinned: pinnedDeparture != null
            && isFlightServiceMatch(pinnedDeparture, item, 'departure'),
        };
      })
      .sort((a, b) => a.departureTs - b.departureTs);

    const updatedAtTs = Date.now();
    const freshData: WidgetData = wFlights.length === 0
      ? { state: 'work_empty', shiftLabel, updatedAt: nowHH, updatedAtTs }
      : { state: 'work', shiftLabel, flights: wFlights, updatedAt: nowHH, updatedAtTs };

    // A temporarily empty provider response must not erase a valid snapshot
    // for the same shift. Shift changes still replace it because the labels differ.
    const stored = await storeWidgetDataPreservingFlights(freshData);
    return presentWidgetData(stored, preferences);
  } catch {
    return markWidgetOffline(await getWidgetData());
  }
}

async function renderCachedThenRefresh(props: WidgetTaskHandlerProps): Promise<void> {
  const cached = await getWidgetData();
  await renderThemedWidget(props, cached);

  try {
    const fresh = await withWidgetRefreshTimeout(fetchFreshWidgetData());
    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
      await renderThemedWidget(props, fresh);
    }
  } catch {
    // The cached widget is already painted; keep it on transient refresh failures.
  }
}

// ─── Task handler ───────────────────────────────────────────────────────────────
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_RESIZED':
    case 'WIDGET_UPDATE': {
      await renderCachedThenRefresh(props);
      break;
    }

    case 'WIDGET_CLICK': {
      if (props.clickAction === 'REFRESH') {
        await renderCachedThenRefresh(props);
      }
      break;
    }

    case 'WIDGET_DELETED':
    default:
      break;
  }
}
