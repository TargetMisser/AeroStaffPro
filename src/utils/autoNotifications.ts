import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchAirportScheduleRaw } from './fr24api';
import { getFlightAirportLabel, isFlightAirlineMatch } from './flightScheduleAdapter';
import { getBestArrivalTs, getBestDepartureTs } from './flightTimes';
import {
  showShiftOngoingNotification,
  dismissShiftOngoingNotification,
  syncShiftOngoingExpiry,
} from './shiftOngoingNotification';
import {
  appendNotificationDebugEvent,
  createNotificationScheduleCheck,
  LAST_SCHEDULE_KEY,
  NOTIF_ENABLED_KEY,
  NOTIF_SETTINGS_KEY,
  runNotificationScheduleExclusive,
} from './notificationDiagnostics';
import { sanitizeNotificationSettings } from './flightNotificationSettings';
import { scheduleShiftNotifications } from './flightNotificationScheduler';
import { devError } from './devLog';
import { getErrorMessage } from './errorUtils';

const FLIGHT_FILTER_STORAGE_KEY = 'aerostaff_flight_filter_v1';

function normalizeAirline(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

function isFlightCoveredByProfile(item: any, selectedAirlines: string[]): boolean {
  if (selectedAirlines.length === 0) {
    return false;
  }

  return selectedAirlines.some(key => isFlightAirlineMatch(item, key));
}

function parseSelectedAirlines(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeAirline).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Schedule today's shift using the same preferences and scheduler as the Flights tab.
 * Called once on app startup. Skips if already scheduled today.
 */
export async function autoScheduleNotifications(): Promise<number> {
  const isCurrent = createNotificationScheduleCheck();
  try {
    // Dismiss ongoing shift notification if shift has ended
    await syncShiftOngoingExpiry();

    const notificationsEnabled = (await AsyncStorage.getItem(NOTIF_ENABLED_KEY)) === 'true';
    if (!notificationsEnabled) {
      await appendNotificationDebugEvent({
        source: 'auto',
        type: 'skip_disabled',
        message: 'Startup scheduler skipped because flight notifications are disabled.',
      });
      return 0;
    }

    // Skip if already scheduled today
    const todayKey = toLocalDateKey(new Date());
    const lastSchedule = await AsyncStorage.getItem(LAST_SCHEDULE_KEY);
    if (lastSchedule === todayKey) {
      await appendNotificationDebugEvent({
        source: 'auto',
        type: 'skip_already_scheduled',
        message: 'Startup scheduler skipped because today was already scheduled.',
        meta: { todayKey },
      });
      return 0;
    }

    // Request notification permission
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      await appendNotificationDebugEvent({
        source: 'auto',
        type: 'skip_permission',
        message: 'Startup scheduler skipped because notification permission is missing.',
        meta: { status },
      });
      return 0;
    }

    // Get calendar and find today's work shift
    const { status: calStatus } = await Calendar.requestCalendarPermissionsAsync();
    if (calStatus !== 'granted') {
      await appendNotificationDebugEvent({
        source: 'auto',
        type: 'skip_calendar_permission',
        message: 'Startup scheduler skipped because calendar permission is missing.',
        meta: { status: calStatus },
      });
      return 0;
    }

    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const cal = cals.find(c => c.allowsModifications && c.isPrimary) || cals.find(c => c.allowsModifications);
    if (!cal) {
      await appendNotificationDebugEvent({
        source: 'auto',
        type: 'skip_calendar_missing',
        message: 'Startup scheduler skipped because no writable calendar was found.',
      });
      return 0;
    }

    const nowDate = new Date();
    const today = new Date(nowDate); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const endOfDay = new Date(today); endOfDay.setHours(23, 59, 59, 999);
    // Android calendar queries require an event to be fully contained in the
    // requested interval. Include yesterday for a currently active 22:00-06:00
    // shift and tomorrow so a night shift beginning today is returned too.
    const queryEnd = new Date(endOfDay); queryEnd.setDate(queryEnd.getDate() + 1);
    const events = await Calendar.getEventsAsync([cal.id], yesterday, queryEnd);
    const workEvents = events
      .filter(event => event.title.trim() === 'Lavoro')
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    const currentWork = workEvents.find(event => (
      new Date(event.startDate).getTime() <= nowDate.getTime()
      && new Date(event.endDate).getTime() > nowDate.getTime()
    ));
    const todayWork = workEvents.find(event => {
      const start = new Date(event.startDate);
      return start >= today && start <= endOfDay;
    });
    const shiftEvent = currentWork ?? todayWork;
    if (!shiftEvent) {
      await dismissShiftOngoingNotification();
      await appendNotificationDebugEvent({
        source: 'auto',
        type: 'skip_no_shift',
        message: 'Startup scheduler skipped because no work shift was found today.',
      });
      return 0;
    }

    const shiftStart = new Date(shiftEvent.startDate).getTime() / 1000;
    const shiftEnd = new Date(shiftEvent.endDate).getTime() / 1000;

    // Fetch departures and arrivals from FR24 using the selected airport
    const { departures: allDepartures, arrivals: allArrivals } = await fetchAirportScheduleRaw();

    const selectedAirlinesRaw = await AsyncStorage.getItem(FLIGHT_FILTER_STORAGE_KEY);
    const selectedAirlines = parseSelectedAirlines(selectedAirlinesRaw);
    const settingsRaw = await AsyncStorage.getItem(NOTIF_SETTINGS_KEY);
    let parsedSettings: unknown;
    try { parsedSettings = JSON.parse(settingsRaw ?? 'null'); } catch {}
    const settings = sanitizeNotificationSettings(parsedSettings);
    const locale = (await AsyncStorage.getItem('aerostaff_language_v1')) === 'en' ? 'en-GB' : 'it-IT';
    if (!isCurrent()) return 0;

    // Filter departures during shift
    const shiftDepartures = allDepartures.filter((item: any) => {
      const ts = getBestDepartureTs(item);
      return ts
        && ts >= shiftStart
        && ts <= shiftEnd;
    });

    // Filter arrivals during shift
    const shiftArrivals = allArrivals.filter((item: any) => {
      const ts = getBestArrivalTs(item);
      return ts
        && ts >= shiftStart
        && ts <= shiftEnd;
    });

    // ── Persistent ongoing shift notification ──────────────────────────────────
    const now = Date.now() / 1000;
    const shiftStartDate = new Date(shiftStart * 1000);
    const shiftEndDate   = new Date(shiftEnd   * 1000);
    const fmt = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const shiftLabel = `${fmt(shiftStartDate)}–${fmt(shiftEndDate)}`;

    if (now >= shiftStart && now <= shiftEnd) {
      const profileDepartures = shiftDepartures.filter((item: any) => isFlightCoveredByProfile(item, selectedAirlines));
      const upcoming = profileDepartures
        .filter((f: any) => (getBestDepartureTs(f) ?? 0) > now)
        .sort((a: any, b: any) =>
          (getBestDepartureTs(a) ?? 0) - (getBestDepartureTs(b) ?? 0),
        );
      const next = upcoming[0];
      let flightInfo: string;
      if (next) {
        const depTs = getBestDepartureTs(next) as number;
        const fn    = next.flight?.identification?.number?.default ?? '';
        const dest  = getFlightAirportLabel(next.flight?.airport?.destination, '');
        const time  = new Date(depTs * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        flightInfo  = `Prossima: ${fn} per ${dest} alle ${time} · ${profileDepartures.length} voli oggi`;
      } else {
        flightInfo = `${profileDepartures.length} voli · Nessuna partenza imminente`;
      }
      await showShiftOngoingNotification(shiftLabel, flightInfo, shiftEnd);
    } else if (now > shiftEnd) {
      await dismissShiftOngoingNotification();
    }
    // ───────────────────────────────────────────────────────────────────────────


    const count = await scheduleShiftNotifications(
      shiftArrivals, shiftDepartures, shiftEnd, locale, settings, selectedAirlines, isCurrent,
    );
    if (!isCurrent()) return 0;
    await runNotificationScheduleExclusive('auto', 'complete startup schedule', async () => {
      if (isCurrent()) await AsyncStorage.setItem(LAST_SCHEDULE_KEY, todayKey);
    });
    if (!isCurrent()) return 0;
    await appendNotificationDebugEvent({
      source: 'auto',
      type: 'schedule',
      message: 'Startup scheduler completed.',
      scheduled: count,
      meta: {
        arrivals: shiftArrivals.length,
        departures: shiftDepartures.length,
        todayKey,
      },
    });
    return count;
  } catch (e) {
    await appendNotificationDebugEvent({
      source: 'auto',
      type: 'error',
      message: 'Startup scheduler failed.',
      meta: { error: getErrorMessage(e) },
    });
    devError('autoScheduleNotifications error:', e);
    return 0;
  }
}
