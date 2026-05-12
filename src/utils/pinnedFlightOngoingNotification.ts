import * as Notifications from 'expo-notifications';
import { getFlightAirportLabel } from './flightScheduleAdapter';

const PINNED_ONGOING_ID = 'aerostaff-pinned-flight-ongoing';
const PINNED_ONGOING_CHANNEL = 'pinned-flight-ongoing';

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

function fmtTime(ts?: number): string {
  if (!ts) return '--:--';
  return new Date(ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

export async function showOrUpdatePinnedFlightNotification(
  item: any,
  tab: 'arrivals' | 'departures',
  sticky = true,
) {
  await setupPinnedChannel();
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

  await Notifications.scheduleNotificationAsync({
    identifier: PINNED_ONGOING_ID,
    content: {
      title: `📌 ${flightNumber} · ${airline}`,
      body: `${label} ${fmtTime(when)} · ${place}`,
      data: { type: 'pinned_flight_ongoing', tab, flightNumber, when },
      sticky,
      autoDismiss: !sticky,
      priority: 'max',
      color: '#F47B16',
      vibrate: [],
    },
    trigger: null,
  });
}

export async function dismissPinnedFlightNotification() {
  try {
    await Notifications.dismissNotificationAsync(PINNED_ONGOING_ID);
  } catch {}
}
