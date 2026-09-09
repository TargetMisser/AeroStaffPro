import * as Notifications from 'expo-notifications';
import { getFlightAirportLabel } from './flightScheduleAdapter';
import { isFlightEasyJet } from './easyjetOverlapMode';
import type { CurrentRequestCheck } from './currentRequestEffects';

const PINNED_ONGOING_ID = 'aerostaff-pinned-flight-ongoing';
const PINNED_ONGOING_CHANNEL = 'pinned-flight-ongoing';
const ALWAYS_CURRENT: CurrentRequestCheck = () => true;
let legacyOverlapCleanup: Promise<void> | null = null;

async function setupPinnedChannel() {
  try {
    await Notifications.setNotificationChannelAsync(PINNED_ONGOING_CHANNEL, {
      name: 'Volo pinnato',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [],
      enableVibrate: false,
      showBadge: false,
      bypassDnd: false,
    });
  } catch {}
}

function fmtTime(ts?: number, isEasyJet = false): string {
  if (!ts) return '--:--';
  return new Date(ts * 1000).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: isEasyJet ? '2-digit' : undefined,
  });
}

export async function showOrUpdatePinnedFlightNotification(
  item: any,
  tab: 'arrivals' | 'departures',
  sticky = true,
  isCurrent: CurrentRequestCheck = ALWAYS_CURRENT,
) {
  if (!isCurrent()) return;
  await dismissLegacyEasyJetOverlapNotification().catch(() => {});
  if (!isCurrent()) return;
  await setupPinnedChannel();
  if (!isCurrent()) return;
  const flightNumber = item?.flight?.identification?.number?.default || 'N/A';
  const airline = item?.flight?.airline?.name || 'Sconosciuta';

  const scheduledTs = tab === 'departures'
    ? item?.flight?.time?.scheduled?.departure
    : item?.flight?.time?.scheduled?.arrival;
  const estimatedTs = tab === 'departures'
    ? item?.flight?.time?.estimated?.departure
    : item?.flight?.time?.estimated?.arrival;
  const realTs = tab === 'departures'
    ? item?.flight?.time?.real?.departure
    : item?.flight?.time?.real?.arrival;
  const when = realTs || estimatedTs || scheduledTs;

  const place = tab === 'departures'
    ? getFlightAirportLabel(item?.flight?.airport?.destination, 'N/A')
    : getFlightAirportLabel(item?.flight?.airport?.origin, 'N/A');
  const label = tab === 'departures' ? 'Partenza' : 'Arrivo';

  const isEasyJet = item ? isFlightEasyJet(item) : false;

  await Notifications.scheduleNotificationAsync({
    identifier: PINNED_ONGOING_ID,
    content: {
      title: `📌 ${flightNumber} · ${airline}`,
      body: `${label} ${fmtTime(when, isEasyJet)} · ${place}`,
      data: { type: 'pinned_flight_ongoing', tab, flightNumber, when },
      sticky,
      autoDismiss: !sticky,
      priority: 'max',
      color: isEasyJet ? '#FF6600' : '#F47B16',
      vibrate: [],
    },
    trigger: null,
  });
  if (!isCurrent()) {
    try { await Notifications.dismissNotificationAsync(PINNED_ONGOING_ID); } catch {}
  }
}

// Older versions used the pinned notification slot for the automatic monitor.
// Only dismiss that retired notification type; a user-selected flight stays.
export function dismissLegacyEasyJetOverlapNotification(): Promise<void> {
  if (!legacyOverlapCleanup) {
    // Pin updates await the same cleanup, since both notification types used
    // the same identifier. A late cleanup must never erase a newer pin.
    legacyOverlapCleanup = (async () => {
      const presented = await Notifications.getPresentedNotificationsAsync();
      for (const notification of presented) {
        if (notification.request.content.data?.type === 'easyjet_overlap_ongoing') {
          await Notifications.dismissNotificationAsync(notification.request.identifier);
        }
      }
    })().catch(error => {
      legacyOverlapCleanup = null;
      throw error;
    });
  }
  return legacyOverlapCleanup;
}

export async function dismissPinnedFlightNotification(isCurrent: CurrentRequestCheck = ALWAYS_CURRENT) {
  if (!isCurrent()) return;
  try {
    await Notifications.dismissNotificationAsync(PINNED_ONGOING_ID);
  } catch {}
}
