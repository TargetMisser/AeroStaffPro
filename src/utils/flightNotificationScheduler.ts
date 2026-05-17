import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { getAirlineOps } from './airlineOps';
import { getFlightAirportLabel } from './flightScheduleAdapter';
import { getBestArrivalTs, getBestDepartureTs } from './flightTimes';
import { shouldNotifyAirline, type FlightNotificationSettings } from './flightNotificationSettings';
import {
  appendNotificationDebugEvent,
  buildNotificationData,
  cancelAeroStaffScheduledNotifications,
  dedupeAeroStaffScheduledNotifications,
  NOTIF_IDS_KEY,
  PINNED_NOTIF_IDS_KEY,
  runNotificationScheduleExclusive,
} from './notificationDiagnostics';

export async function cancelPreviousNotifications(reason = 'flight shift reschedule', logEmpty = false) {
  return cancelAeroStaffScheduledNotifications({
    includeShift: true,
    includePinned: false,
    reason,
    source: 'flights',
    logEmpty,
  });
}

export async function scheduleShiftNotifications(
  shiftArrivals: any[],
  shiftDepartures: any[],
  shiftEnd: number,
  locale: string,
  settings: FlightNotificationSettings,
  selectedAirlines: string[],
): Promise<number> {
  return runNotificationScheduleExclusive('flights', 'shift notification schedule', async () => {
    await cancelPreviousNotifications('flight shift reschedule', false);
    const now = Date.now() / 1000;
    const newIds: string[] = [];
    const canNotify = (item: any) => shouldNotifyAirline(item, settings, selectedAirlines);

    if (settings.includeArrivals) {
      for (const item of shiftArrivals) {
        if (!canNotify(item)) continue;
        const ts = getBestArrivalTs(item);
        if (!ts) continue;
        const secondsUntilNotify = ts - settings.arrivalLeadMinutes * 60 - now;
        if (secondsUntilNotify <= 0) continue;

        const flightNumber = item.flight?.identification?.number?.default || 'N/A';
        const airline = item.flight?.airline?.name || 'Sconosciuta';
        const origin = getFlightAirportLabel(item.flight?.airport?.origin, 'N/A');
        const arrivalTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

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
      }
    }

    if (settings.includeDepartures) {
      for (const item of shiftDepartures) {
        if (!canNotify(item)) continue;
        const ts = getBestDepartureTs(item);
        if (!ts) continue;
        const secondsUntilNotify = ts - settings.departureLeadMinutes * 60 - now;
        if (secondsUntilNotify <= 0) continue;

        const flightNumber = item.flight?.identification?.number?.default || 'N/A';
        const airline = item.flight?.airline?.name || 'Sconosciuta';
        const destination = getFlightAirportLabel(item.flight?.airport?.destination, 'N/A');
        const departureTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

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
      }
    }

    if (settings.includeShiftEnd) {
      const secondsUntilEnd = shiftEnd - now;
      if (secondsUntilEnd > 0) {
        const endTime = new Date(shiftEnd * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
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
      }
    }

    await AsyncStorage.setItem(NOTIF_IDS_KEY, JSON.stringify(newIds));
    await dedupeAeroStaffScheduledNotifications({
      includeShift: true,
      includePinned: false,
      reason: 'flight shift schedule complete',
      source: 'flights',
    });
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
    return newIds.length;
  });
}

export async function cancelPinnedNotifications(reason = 'pinned flight reschedule', logEmpty = false) {
  return cancelAeroStaffScheduledNotifications({
    includeShift: false,
    includePinned: true,
    reason,
    source: 'pinned',
    logEmpty,
  });
}

export async function schedulePinnedNotifications(
  item: any,
  tab: 'arrivals' | 'departures',
  locale: string,
  settings: FlightNotificationSettings,
): Promise<void> {
  return runNotificationScheduleExclusive('pinned', 'pinned flight notification schedule', async () => {
    await cancelPinnedNotifications('pinned flight reschedule', false);
    const now = Date.now() / 1000;
    const ids: string[] = [];

    const flightNumber = item.flight?.identification?.number?.default || 'N/A';
    const airline = item.flight?.airline?.name || 'Sconosciuta';

    if (tab === 'arrivals') {
      const ts = getBestArrivalTs(item);
      if (!ts) return;
      const origin = getFlightAirportLabel(item.flight?.airport?.origin, 'N/A');
      const arrTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
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
      }
    } else {
      const ts = getBestDepartureTs(item);
      if (!ts) return;
      const dest = getFlightAirportLabel(item.flight?.airport?.destination, 'N/A');
      const depTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      const ops = getAirlineOps(airline);

      const phases: Array<{ offset: number; type: string; title: string; body: string }> = [
        { offset: ops.checkInOpen, type: 'pinned_checkin_open', title: `Check-in aperto - ${flightNumber}`, body: `Check-in aperto per il volo delle ${depTime} → ${dest}` },
        { offset: ops.gateOpen, type: 'pinned_gate_open', title: `Gate aperto - ${flightNumber}`, body: `Gate aperto per il volo delle ${depTime} → ${dest}` },
        { offset: ops.gateClose, type: 'pinned_gate_close', title: `Chiusura gate - ${flightNumber}`, body: `Gate in chiusura per il volo delle ${depTime} → ${dest}` },
        {
          offset: settings.departureLeadMinutes,
          type: 'pinned_departure',
          title: `Partenza tra ${settings.departureLeadMinutes} min - ${flightNumber}`,
          body: `${airline} → ${dest} · partenza alle ${depTime}`,
        },
      ];

      for (const phase of phases) {
        const secsUntil = ts - phase.offset * 60 - now;
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
              ts,
              pinned: true,
            }),
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secsUntil), repeats: false },
        });
        ids.push(id);
      }
    }

    if (ids.length > 0) {
      await AsyncStorage.setItem(PINNED_NOTIF_IDS_KEY, JSON.stringify(ids));
    }
    await dedupeAeroStaffScheduledNotifications({
      includeShift: false,
      includePinned: true,
      reason: 'pinned flight schedule complete',
      source: 'pinned',
    });
    await appendNotificationDebugEvent({
      source: 'pinned',
      type: 'schedule',
      message: 'Flight tab scheduled pinned-flight notifications.',
      scheduled: ids.length,
      meta: { flightNumber, tab, sticky: settings.sticky },
    });
  });
}
