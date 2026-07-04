import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import type { HexColor } from '../utils/airlineOps';
import { getAirlineOps, getAirlineColor } from '../utils/airlineOps';
import { getStoredAirportCode, buildFr24ScheduleUrl, getStoredAirportAirlines, storeDetectedAirportAirlines, getAirportInfo } from '../utils/airportSettings';
import { filterFlightsByAirlines, getFlightAirportLabel, getFlightBestTs } from '../utils/flightScheduleAdapter';
import { staffMonitorProvider } from '../utils/flightProviders/staffMonitorProvider';
import { applyLiveDepartureStatus, fetchAdsbAircraft } from '../utils/liveArrivalEta';
import { ShiftWidget } from './ShiftWidget';
import { getStoredWidgetThemeProps } from './widgetTheme';

/** Key used by the main app (FlightScreen) to push pre-built widget data */
export const WIDGET_CACHE_KEY = 'widget_data_cache_v1';

/** Key used to store today's shift data so the widget can self-update */
export const WIDGET_SHIFT_KEY = 'widget_shift_v1';

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

export type WidgetData =
  | { state: 'work'; shiftLabel: string; flights: WidgetFlight[]; updatedAt: string }
  | { state: 'work_empty'; shiftLabel: string; updatedAt: string }
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

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);
    const tomorrowStart = addDays(todayStart, 1);
    const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setHours(23, 59, 59, 999);

    let shiftToday: { start: number; end: number } | null = null;
    let shiftTomorrow: { start: number; end: number } | null = null;
    let isRestDay = false;
    const events = await Calendar.getEventsAsync([cal.id], todayStart, tomorrowEnd);
    for (const e of events) {
      if (e.title.includes('Riposo')) {
        const evtDay = new Date(e.startDate);
        if (evtDay >= todayStart && evtDay <= todayEnd) isRestDay = true;
        continue;
      }
      if (!e.title.includes('Lavoro')) continue;
      const start = new Date(e.startDate).getTime() / 1000;
      const end = new Date(e.endDate).getTime() / 1000;
      const evtDay = new Date(e.startDate);
      if (evtDay >= todayStart && evtDay <= todayEnd) {
        shiftToday = { start, end };
        isRestDay = false;
      } else if (evtDay >= tomorrowStart && evtDay <= tomorrowEnd) {
        shiftTomorrow = { start, end };
      }
    }

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

async function readShiftSnapshot(): Promise<WidgetShiftData | null> {
  const shiftRaw = await AsyncStorage.getItem(WIDGET_SHIFT_KEY);
  let shiftData: WidgetShiftData | null = shiftRaw ? JSON.parse(shiftRaw) : null;
  if (!shiftData || shiftData.date !== toLocalIso()) {
    shiftData = (await refreshShiftSnapshotFromCalendar()) ?? shiftData;
  }
  return shiftData;
}

// ─── Read cached data written by the main app ──────────────────────────────────
export async function getWidgetData(): Promise<WidgetData> {
  try {
    const shiftData = await readShiftSnapshot();

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
          if ((data.state === 'work' || data.state === 'work_empty') && data.shiftLabel === shiftLabel) return data;
        }
        // Cache is stale or missing — show work_empty until periodic update runs.
        return { state: 'work_empty', shiftLabel, updatedAt: '' };
      }
    }

    // Shift key is missing or from a different day — fall back to cache.
    const cached = await AsyncStorage.getItem(WIDGET_CACHE_KEY);
    if (!cached) return { state: 'error' };
    const data: WidgetData = JSON.parse(cached);
    // Rest/no_shift cached but shift key is stale → treat as no_shift.
    if (data.state === 'rest' || data.state === 'no_shift') return { state: 'no_shift' };
    return data;
  } catch {}
  return { state: 'error' };
}

async function renderThemedWidget(props: WidgetTaskHandlerProps, data: WidgetData): Promise<void> {
  const { themeMode, themeSnapshot } = await getStoredWidgetThemeProps();
  props.renderWidget(
    <ShiftWidget
      data={data}
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
        const ts = getFlightBestTs(item, 'departure');
        if (ts == null) return false;
        const airline = item.flight?.airline?.name || '';
        const ops = getAirlineOps(airline);
        const ciO = ts - ops.checkInOpen * 60, ciC = ts - ops.checkInClose * 60;
        const gO = ts - ops.gateOpen * 60, gC = ts - ops.gateClose * 60;
        return (ciO <= activeShift.end && ciC >= activeShift.start) || (gO <= activeShift.end && gC >= activeShift.start);
      })
      .map(item => {
        const ts = getFlightBestTs(item, 'departure')!;
        const airline = item.flight?.airline?.name || 'Sconosciuta';
        const ops = getAirlineOps(airline);
        const fn = item.flight?.identification?.number?.default || 'N/A';
        return {
          flightNumber: fn,
          destinationIata: getFlightAirportLabel(item.flight?.airport?.destination, 'N/A'),
          departureTs: ts,
          departureTime: fmtTs(ts),
          ciOpen: fmtOff(ts, ops.checkInOpen), ciClose: fmtOff(ts, ops.checkInClose),
          gateOpen: fmtOff(ts, ops.gateOpen), gateClose: fmtOff(ts, ops.gateClose),
          airlineColor: getAirlineColor(airline),
        };
      })
      .sort((a, b) => a.departureTs - b.departureTs);

    const freshData: WidgetData = wFlights.length === 0
      ? { state: 'work_empty', shiftLabel, updatedAt: nowHH }
      : { state: 'work', shiftLabel, flights: wFlights, updatedAt: nowHH };

    // Update the cache with fresh data
    await AsyncStorage.setItem(WIDGET_CACHE_KEY, JSON.stringify(freshData));
    return freshData;
  } catch {
    return getWidgetData();
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
