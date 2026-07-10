import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { getAirlineOps } from './airlineOps';
import { getFlightAirportLabel } from './flightScheduleAdapter';
import { getBestArrivalTs, getBestDepartureTs, getScheduledFlightTs } from './flightTimes';
import { shouldNotifyAirline, type FlightNotificationSettings } from './flightNotificationSettings';
import { isFlightEasyJet } from './easyjetOverlapMode';
import type { CurrentRequestCheck } from './currentRequestEffects';
import {
  appendNotificationDebugEvent,
  buildNotificationData,
  cancelAeroStaffScheduledNotifications,
  dedupeAeroStaffScheduledNotifications,
  NOTIF_IDS_KEY,
  PINNED_NOTIF_IDS_KEY,
  runNotificationScheduleExclusive,
} from './notificationDiagnostics';

const ALWAYS_CURRENT: CurrentRequestCheck = () => true;

async function discardNewNotificationsIfStale(
  isCurrent: CurrentRequestCheck,
  ids: string[],
  storageKey?: string,
): Promise<boolean> {
  if (isCurrent()) return false;

  for (const id of ids) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
  }

  if (storageKey) {
    try {
      const stored = await AsyncStorage.getItem(storageKey);
      if (stored === JSON.stringify(ids)) await AsyncStorage.removeItem(storageKey);
    } catch {}
  }
  return true;
}

export async function cancelPreviousNotifications(
  reason = 'flight shift reschedule',
  logEmpty = false,
  isCurrent: CurrentRequestCheck = ALWAYS_CURRENT,
) {
  return cancelAeroStaffScheduledNotifications({
    includeShift: true,
    includePinned: false,
    reason,
    source: 'flights',
    logEmpty,
    isCurrent,
  });
}

export async function scheduleShiftNotifications(
  shiftArrivals: any[],
  shiftDepartures: any[],
  shiftEnd: number,
  locale: string,
  settings: FlightNotificationSettings,
  selectedAirlines: string[],
  isCurrent: CurrentRequestCheck = ALWAYS_CURRENT,
): Promise<number> {
  return runNotificationScheduleExclusive('flights', 'shift notification schedule', async () => {
    if (!isCurrent()) return 0;
    await cancelPreviousNotifications('flight shift reschedule', false, isCurrent);
    if (!isCurrent()) return 0;
    const now = Date.now() / 1000;
    const newIds: string[] = [];
    const canNotify = (item: any) => shouldNotifyAirline(item, settings, selectedAirlines);

    if (settings.includeArrivals) {
      for (const item of shiftArrivals) {
        if (await discardNewNotificationsIfStale(isCurrent, newIds)) return 0;
        if (!canNotify(item)) continue;
        const ts = getBestArrivalTs(item);
        if (!ts) continue;
        const secondsUntilNotify = ts - settings.arrivalLeadMinutes * 60 - now;
        if (secondsUntilNotify <= 0) continue;

        const flightNumber = item.flight?.identification?.number?.default || 'N/A';
        const airline = item.flight?.airline?.name || 'Sconosciuta';
        const origin = getFlightAirportLabel(item.flight?.airport?.origin, 'N/A');
        const isEasyJet = isFlightEasyJet(item);
        const arrivalTime = new Date(ts * 1000).toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
          second: isEasyJet ? '2-digit' : undefined,
        });

        try {
          const id = await Notifications.scheduleNotificationAsync({
            content: {
              title: `Arrivo tra ${settings.arrivalLeadMinutes} min - ${flightNumber}`,
              body: `${airline} da ${origin} · atterraggio alle ${arrivalTime}`,
              sound: true,
              sticky: settings.sticky,
              autoDismiss: !settings.sticky,
              data: buildNotificationData({
                scheduler: 'flights',
                type: 'arrival_shift',
                flightNumber,
                ts,
              }),
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secondsUntilNotify), repeats: false },
          });
          newIds.push(id);
          if (await discardNewNotificationsIfStale(isCurrent, newIds)) return 0;
        } catch {
          // Skip just this notification and keep scheduling the rest, so a
          // single OS rejection can't abort the batch and orphan the IDs we
          // already created (they are persisted to NOTIF_IDS_KEY below).
        }
      }
    }

    if (settings.includeDepartures) {
      for (const item of shiftDepartures) {
        if (await discardNewNotificationsIfStale(isCurrent, newIds)) return 0;
        if (!canNotify(item)) continue;
        const ts = getBestDepartureTs(item);
        if (!ts) continue;
        const secondsUntilNotify = ts - settings.departureLeadMinutes * 60 - now;
        if (secondsUntilNotify <= 0) continue;

        const flightNumber = item.flight?.identification?.number?.default || 'N/A';
        const airline = item.flight?.airline?.name || 'Sconosciuta';
        const destination = getFlightAirportLabel(item.flight?.airport?.destination, 'N/A');
        const departureTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

        try {
          const id = await Notifications.scheduleNotificationAsync({
            content: {
              title: `Partenza tra ${settings.departureLeadMinutes} min - ${flightNumber}`,
              body: `${airline} → ${destination} · decollo alle ${departureTime}`,
              sound: true,
              sticky: settings.sticky,
              autoDismiss: !settings.sticky,
              data: buildNotificationData({
                scheduler: 'flights',
                type: 'departure_shift',
                flightNumber,
                ts,
              }),
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secondsUntilNotify), repeats: false },
          });
          newIds.push(id);
          if (await discardNewNotificationsIfStale(isCurrent, newIds)) return 0;
        } catch {
          // Skip just this notification and keep scheduling the rest, so a
          // single OS rejection can't abort the batch and orphan the IDs we
          // already created (they are persisted to NOTIF_IDS_KEY below).
        }
      }
    }

    if (settings.includeShiftEnd) {
      if (await discardNewNotificationsIfStale(isCurrent, newIds)) return 0;
      const secondsUntilEnd = shiftEnd - now;
      if (secondsUntilEnd > 0) {
        const endTime = new Date(shiftEnd * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        try {
          const endId = await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Turno terminato',
              body: `Buon lavoro! Il tuo turno delle ${endTime} è concluso.`,
              sound: true,
              sticky: settings.sticky,
              autoDismiss: !settings.sticky,
              data: buildNotificationData({
                scheduler: 'flights',
                type: 'shift_end',
                ts: shiftEnd,
              }),
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secondsUntilEnd), repeats: false },
          });
          newIds.push(endId);
          if (await discardNewNotificationsIfStale(isCurrent, newIds)) return 0;
        } catch {
          // Best-effort: a failed shift-end notification must not abort the
          // batch or orphan the flight notifications already scheduled above.
        }
      }
    }

    if (await discardNewNotificationsIfStale(isCurrent, newIds)) return 0;
    await AsyncStorage.setItem(NOTIF_IDS_KEY, JSON.stringify(newIds));
    if (await discardNewNotificationsIfStale(isCurrent, newIds, NOTIF_IDS_KEY)) return 0;
    await dedupeAeroStaffScheduledNotifications({
      includeShift: true,
      includePinned: false,
      reason: 'flight shift schedule complete',
      source: 'flights',
    });
    if (await discardNewNotificationsIfStale(isCurrent, newIds, NOTIF_IDS_KEY)) return 0;
    await appendNotificationDebugEvent({
      source: 'flights',
      type: 'schedule',
      message: 'Flight tab scheduled shift notifications.',
      scheduled: newIds.length,
      meta: {
        arrivals: shiftArrivals.length,
        departures: shiftDepartures.length,
        selectedAirlines: selectedAirlines.length,
        settings,
      },
    });
    if (await discardNewNotificationsIfStale(isCurrent, newIds, NOTIF_IDS_KEY)) return 0;
    return newIds.length;
  });
}

export async function cancelPinnedNotifications(
  reason = 'pinned flight reschedule',
  logEmpty = false,
  isCurrent: CurrentRequestCheck = ALWAYS_CURRENT,
) {
  return cancelAeroStaffScheduledNotifications({
    includeShift: false,
    includePinned: true,
    reason,
    source: 'pinned',
    logEmpty,
    isCurrent,
  });
}

export async function schedulePinnedNotifications(
  item: any,
  tab: 'arrivals' | 'departures',
  locale: string,
  settings: FlightNotificationSettings,
  isCurrent: CurrentRequestCheck = ALWAYS_CURRENT,
): Promise<void> {
  return runNotificationScheduleExclusive('pinned', 'pinned flight notification schedule', async () => {
    if (!isCurrent()) return;
    await cancelPinnedNotifications('pinned flight reschedule', false, isCurrent);
    if (!isCurrent()) return;
    const now = Date.now() / 1000;
    const ids: string[] = [];

    const flightNumber = item.flight?.identification?.number?.default || 'N/A';
    const airline = item.flight?.airline?.name || 'Sconosciuta';

    if (tab === 'arrivals') {
      const ts = getBestArrivalTs(item);
      if (!ts) return;
      const origin = getFlightAirportLabel(item.flight?.airport?.origin, 'N/A');
      const isEasyJet = isFlightEasyJet(item);
      const arrTime = new Date(ts * 1000).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: isEasyJet ? '2-digit' : undefined,
      });
      const secsUntil = ts - settings.arrivalLeadMinutes * 60 - now;
      if (secsUntil > 0) {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `Arrivo tra ${settings.arrivalLeadMinutes} min - ${flightNumber}`,
            body: `${airline} da ${origin} · atterraggio alle ${arrTime}`,
            sound: true,
            sticky: settings.sticky,
            autoDismiss: !settings.sticky,
            data: buildNotificationData({
              scheduler: 'flights_pinned',
              type: 'pinned_arrival',
              flightNumber,
              ts,
              pinned: true,
            }),
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secsUntil), repeats: false },
        });
        ids.push(id);
        if (await discardNewNotificationsIfStale(isCurrent, ids)) return;
      }
    } else {
      const stdTs = getScheduledFlightTs(item, 'departure');
      if (!stdTs) return;
      const etdTs = getBestDepartureTs(item) ?? stdTs;
      const dest = getFlightAirportLabel(item.flight?.airport?.destination, 'N/A');
      const depTime = new Date(etdTs * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      const ops = getAirlineOps(airline);

      // Closure phases use stdTs so they never shift when the flight is delayed.
      // Only the departure notification uses etdTs (the real/estimated departure).
      const phases: Array<{ offset: number; type: string; title: string; body: string; baseTs: number }> = [
        { offset: ops.checkInOpen, type: 'pinned_checkin_open', title: `Check-in aperto - ${flightNumber}`, body: `Check-in aperto per il volo delle ${depTime} → ${dest}`, baseTs: stdTs },
        { offset: ops.gateOpen, type: 'pinned_gate_open', title: `Gate aperto - ${flightNumber}`, body: `Gate aperto per il volo delle ${depTime} → ${dest}`, baseTs: stdTs },
        { offset: ops.gateClose, type: 'pinned_gate_close', title: `Chiusura gate - ${flightNumber}`, body: `Gate in chiusura per il volo delle ${depTime} → ${dest}`, baseTs: stdTs },
        {
          offset: settings.departureLeadMinutes,
          type: 'pinned_departure',
          title: `Partenza tra ${settings.departureLeadMinutes} min - ${flightNumber}`,
          body: `${airline} → ${dest} · partenza alle ${depTime}`,
          baseTs: etdTs,
        },
      ];

      for (const phase of phases) {
        if (await discardNewNotificationsIfStale(isCurrent, ids)) return;
        const secsUntil = phase.baseTs - phase.offset * 60 - now;
        if (secsUntil <= 0) continue;
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: phase.title,
            body: phase.body,
            sound: true,
            sticky: settings.sticky,
            autoDismiss: !settings.sticky,
            data: buildNotificationData({
              scheduler: 'flights_pinned',
              type: phase.type,
              flightNumber,
              ts: phase.baseTs,
              pinned: true,
            }),
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secsUntil), repeats: false },
        });
        ids.push(id);
        if (await discardNewNotificationsIfStale(isCurrent, ids)) return;
      }
    }

    if (await discardNewNotificationsIfStale(isCurrent, ids)) return;
    if (ids.length > 0) {
      await AsyncStorage.setItem(PINNED_NOTIF_IDS_KEY, JSON.stringify(ids));
      if (await discardNewNotificationsIfStale(isCurrent, ids, PINNED_NOTIF_IDS_KEY)) return;
    }
    await dedupeAeroStaffScheduledNotifications({
      includeShift: false,
      includePinned: true,
      reason: 'pinned flight schedule complete',
      source: 'pinned',
    });
    if (await discardNewNotificationsIfStale(isCurrent, ids, PINNED_NOTIF_IDS_KEY)) return;
    await appendNotificationDebugEvent({
      source: 'pinned',
      type: 'schedule',
      message: 'Flight tab scheduled pinned-flight notifications.',
      scheduled: ids.length,
      meta: { flightNumber, tab, sticky: settings.sticky },
    });
    await discardNewNotificationsIfStale(isCurrent, ids, PINNED_NOTIF_IDS_KEY);
  });
}
