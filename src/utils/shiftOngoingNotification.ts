import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONGOING_ID = 'aerostaff-shift-ongoing';
const ONGOING_CHANNEL = 'shift-ongoing-quiet';
const SHIFT_END_TS_KEY = 'aerostaff_shift_end_ts_v1';

async function setupShiftChannel() {
  try {
    await Notifications.setNotificationChannelAsync(ONGOING_CHANNEL, {
      name: 'Turno in corso',
      // LOW: a persistent status that is re-posted often must not pop up,
      // ring or vibrate on every update.
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      vibrationPattern: [],
      enableVibrate: false,
      showBadge: false,
      bypassDnd: false,
    });
  } catch {}
}

/** Shows (or replaces) the persistent pinned shift notification. */
export async function showShiftOngoingNotification(
  shiftLabel: string,
  flightInfo: string,
  shiftEndTs: number,
) {
  await setupShiftChannel();
  await AsyncStorage.setItem(SHIFT_END_TS_KEY, String(shiftEndTs));

  await Notifications.scheduleNotificationAsync({
    identifier: ONGOING_ID,
    content: {
      title: `\u2708 Turno in corso \u2014 ${shiftLabel}`,
      body: flightInfo,
      data: { type: 'shift_ongoing' },
      sticky: true,
      autoDismiss: false,
      color: '#F47B16',
    },
    // A null trigger posts on Expo's fallback channel (high importance, sound
    // and vibration): the channel must be named in the trigger.
    trigger: { channelId: ONGOING_CHANNEL },
  });
}

/** Removes the persistent shift notification from the tray. */
export async function dismissShiftOngoingNotification() {
  try {
    await Notifications.dismissNotificationAsync(ONGOING_ID);
  } catch {}
  await AsyncStorage.removeItem(SHIFT_END_TS_KEY);
}

/**
 * Call on every app open: dismisses the ongoing notification
 * if the stored shift end timestamp has already passed.
 */
export async function syncShiftOngoingExpiry() {
  try {
    const raw = await AsyncStorage.getItem(SHIFT_END_TS_KEY);
    if (!raw) return;
    if (Date.now() / 1000 > Number(raw)) {
      await dismissShiftOngoingNotification();
    }
  } catch {}
}
