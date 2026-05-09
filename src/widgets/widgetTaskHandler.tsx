import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import type { HexColor } from '../utils/airlineOps';
import { getAirlineOps, getAirlineColor } from '../utils/airlineOps';
import { getStoredAirportCode, buildFr24ScheduleUrl, getStoredAirportAirlines, storeDetectedAirportAirlines } from '../utils/airportSettings';
import { getFlightBestTs } from '../utils/flightScheduleAdapter';
import { ShiftWidget } from './ShiftWidget';
import { getStoredWidgetThemeProps } from './widgetTheme';

/** Key used by the main app (FlightScreen) to push pre-built widget data */
export const WIDGET_CACHE_KEY = 'widget_data_cache_v1';

/** Key used to store today's shift data so the widget can self-update */
export const WIDGET_SHIFT_KEY = 'widget_shift_v1';

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
    if (shiftData.isRestDay) return 'rest';
    if (currentShift && now <= currentShift.end) {
      return { shift: currentShift, shiftLabel: `${fmtTs(currentShift.start)} – ${fmtTs(currentShift.end)}` };
    }
    if (currentShift && now > currentShift.end && nextShift && nextShift.date === tomorrowIso && nextShift.start > now) {
      return { shift: nextShift, shiftLabel: `Domani ${fmtTs(nextShift.start)} – ${fmtTs(nextShift.end)}` };
    }
    return null;
  }

  // If the app wrote tomorrow's shift yesterday, use it after midnight until fresh data arrives.
  if (nextShift && nextShift.date === todayIso && now <= nextShift.end) {
    return { shift: nextShift, shiftLabel: `${fmtTs(nextShift.start)} – ${fmtTs(nextShift.end)}` };
  }

  return null;
}

// ─── Read cached data written by the main app ──────────────────────────────────
export async function getWidgetData(): Promise<WidgetData> {
  try {
    const shiftRaw = await AsyncStorage.getItem(WIDGET_SHIFT_KEY);

    if (shiftRaw) {
      const shiftData: WidgetShiftData = JSON.parse(shiftRaw);
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

// ─── Fetch fresh widget data from FR24 + cached shift key ─────────────────────
async function fetchFreshWidgetData(): Promise<WidgetData> {
  try {
    const shiftRaw = await AsyncStorage.getItem(WIDGET_SHIFT_KEY);
    if (!shiftRaw) return getWidgetData();

    const shiftData: WidgetShiftData = JSON.parse(shiftRaw);
    const resolved = resolveWidgetShift(shiftData);
    if (resolved === 'rest') return { state: 'rest' };
    if (!resolved) return { state: 'no_shift' };

    const activeShift = resolved.shift;
    const airportCode = await getStoredAirportCode();
    const allAirlines = await getStoredAirportAirlines(airportCode);
    const filterRaw = await AsyncStorage.getItem('aerostaff_flight_filter_v1');
    const allowedAirlines: string[] = filterRaw ? JSON.parse(filterRaw) : allAirlines;
    const url = buildFr24ScheduleUrl(airportCode);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let allDepartures: any[] = [];
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
      const json = await res.json();
      allDepartures = json.result?.response?.airport?.pluginData?.schedule?.departures?.data || [];
      await storeDetectedAirportAirlines(airportCode, allDepartures);
    } finally {
      clearTimeout(timer);
    }

    const fmtOff = (dep: number, off: number) => fmtTs(dep - off * 60);
    const nowHH = fmtTs(Date.now() / 1000);
    const shiftLabel = resolved.shiftLabel;

    const filteredDeps = allowedAirlines.length === 0
      ? allDepartures
      : allDepartures.filter(item =>
          allowedAirlines.some(key => (item.flight?.airline?.name || '').toLowerCase().includes(key)),
        );

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
          destinationIata: item.flight?.airport?.destination?.code?.iata || '???',
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

// ─── Task handler ───────────────────────────────────────────────────────────────
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_RESIZED': {
      const data = await getWidgetData();
      await renderThemedWidget(props, data);
      break;
    }

    case 'WIDGET_UPDATE': {
      // Fetch fresh data from FR24 + cached shift on periodic updates
      const data = await fetchFreshWidgetData();
      await renderThemedWidget(props, data);
      break;
    }

    case 'WIDGET_CLICK': {
      if (props.clickAction === 'REFRESH') {
        const data = await fetchFreshWidgetData();
        await renderThemedWidget(props, data);
      }
      break;
    }

    case 'WIDGET_DELETED':
    default:
      break;
  }
}
