import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Image, Modal, TextInput,
  Platform, Linking, AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useAirport } from '../context/AirportContext';
import BoardReveal from '../components/motion/BoardReveal';
import ShiftTimeline from '../components/ShiftTimeline';

import { getAirlineOps, getAirlineColor } from '../utils/airlineOps';
import { statusToToken } from '../utils/statusColors';
import { getAirportInfo } from '../utils/airportSettings';
import { getFlightAirportLabel } from '../utils/flightScheduleAdapter';
import { getBestArrivalTs, getBestDepartureTs } from '../utils/flightTimes';
import { getCachedFlightProviderDiagnostics, type FlightProviderDiagnosticsSnapshot } from '../utils/fr24api';
import { getNotificationDebugSnapshot, type NotificationDebugSnapshot } from '../utils/notificationDiagnostics';
import { cancelPinnedNotifications } from '../utils/flightNotificationScheduler';
import { loadFlightScreenCache } from '../utils/flightScreenCache';
import { dismissPinnedFlightNotification, dismissLegacyEasyJetOverlapNotification } from '../utils/pinnedFlightOngoingNotification';
import { reconcilePinnedFlight } from '../utils/pinnedFlightLifecycle';
import {
  buildHomeAttention,
  buildHomeOperationalSummary,
  type HomeAttentionAction,
} from '../utils/homeOperationalStatus';
import { enableLegacyAndroidLayoutAnimation } from '../utils/layoutAnimation';
import {
  getWritableCalendarId,
  isOwnedShiftEvent,
  replaceShiftForDate,
} from '../utils/shiftCalendar';
import {
  storeWidgetDataPreservingFlights,
  WIDGET_SHIFT_KEY,
  type WidgetData,
  type WidgetShiftData,
  type WidgetShiftWindow,
} from '../widgets/widgetTaskHandler';
import { ShiftWidget } from '../widgets/ShiftWidget';
import { useLanguage } from '../context/LanguageContext';
import { TYPE } from '../theme/typography';
import { SPACING, RADIUS } from '../theme/spacing';
import { devError, devLog } from '../utils/devLog';
import { getErrorMessage } from '../utils/errorUtils';

const GOLD = '#F59E0B';

enableLegacyAndroidLayoutAnimation();

const PINNED_FLIGHT_KEY = 'pinned_flight_v1';
const HOME_REST_TIMING = { startHour: 12, startMinute: 0, endHour: 14, endMinute: 0, allDay: true };
type HomeShiftKind = 'today' | 'next' | 'rest' | 'none';

// months comes from useLanguage() context

function PinnedFlightCardComponent({ item, colors, isOperations = false }: { item: any; colors: ThemeColors; isOperations?: boolean }) {
  const { t, locale } = useLanguage();
  const tab = item._pinTab || 'departures';
  const flightNumber = item.flight?.identification?.number?.default || 'N/A';
  const airline = item.flight?.airline?.name || 'Sconosciuta';
  const airlineIdentity = [
    airline,
    item.flight?.airline?.code?.iata,
    item.flight?.airline?.code?.icao,
  ].filter(Boolean).join(' ');
  const airlineColor = getAirlineColor(airlineIdentity);
  const statusText = item.flight?.status?.text || 'Scheduled';
  const raw = item.flight?.status?.generic?.status?.color || 'gray';
  const statusColor = statusToToken(raw, colors);

  const dest = tab === 'arrivals'
    ? getFlightAirportLabel(item.flight?.airport?.origin, 'N/A')
    : getFlightAirportLabel(item.flight?.airport?.destination, 'N/A');
  const ts = tab === 'arrivals'
    ? item.flight?.time?.scheduled?.arrival
    : item.flight?.time?.scheduled?.departure;
  const displayTs = tab === 'arrivals' ? getBestArrivalTs(item) : getBestDepartureTs(item);
  const depTime = displayTs ? new Date(displayTs * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : 'N/A';

  const ops = getAirlineOps(airlineIdentity);
  const fmt = (offsetMin: number) =>
    ts ? new Date((ts - offsetMin * 60) * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
  const headerBg = isOperations ? 'rgba(2,8,12,0.72)' : airlineColor;
  const headerText = isOperations ? colors.primaryDark : '#fff';
  const headerMuted = isOperations ? 'rgba(204,251,241,0.62)' : 'rgba(255,255,255,0.7)';
  const panelBg = isOperations ? 'rgba(2,8,12,0.62)' : colors.card;
  const operationBorder = isOperations ? 'rgba(45,212,191,0.32)' : colors.border;

  return (
    <View style={{
      marginHorizontal: SPACING.lg, marginTop: SPACING.lg,
      borderRadius: isOperations ? 20 : 16, overflow: 'hidden',
      backgroundColor: panelBg,
      shadowColor: colors.isDark ? '#000000' : colors.primary, shadowOpacity: isOperations ? 0 : 0.15, shadowRadius: 12, elevation: isOperations ? 0 : 6,
      borderWidth: 1, borderColor: isOperations ? operationBorder : colors.isDark ? colors.border : 'transparent',
      borderLeftWidth: isOperations ? 4 : 1,
      borderLeftColor: isOperations ? airlineColor : colors.isDark ? colors.border : 'transparent',
    }}>
      {/* Compact header: airline color bar + flight info */}
      <View style={{
        backgroundColor: headerBg,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg,
        borderBottomWidth: isOperations ? 1 : 0,
        borderBottomColor: isOperations ? 'rgba(45,212,191,0.20)' : 'transparent',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ backgroundColor: isOperations ? colors.primaryLight : 'rgba(255,255,255,0.2)', borderRadius: isOperations ? 10 : 8, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorder : 'transparent' }}>
            <Text style={{ color: headerText, fontWeight: '900', fontSize: 13 }}>{flightNumber}</Text>
          </View>
          <View>
            <Text style={{ color: headerText, fontWeight: '700', fontSize: 12 }}>{airline}</Text>
            <Text style={{ color: headerMuted, fontSize: 10, letterSpacing: isOperations ? 0.8 : 0 }}>{tab === 'arrivals' ? t('homeArrival') : t('homeDeparture')}</Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: headerText, fontWeight: '900', fontSize: 22 }}>{depTime}</Text>
          <Text style={{ color: isOperations ? colors.textSub : 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700' }}>{dest}</Text>
        </View>
      </View>

      {/* Body */}
      <View style={{ padding: SPACING.md, backgroundColor: panelBg }}>
        {tab === 'departures' ? (
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.primaryLight, borderRadius: isOperations ? 12 : 10, paddingHorizontal: 10, paddingVertical: SPACING.sm, borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorder : 'transparent' }}>
              <MaterialIcons name="desktop-windows" size={15} color={colors.primary} />
              <View>
                <Text style={{ fontSize: 9, fontWeight: '600', color: colors.textSub, letterSpacing: 0.3 }}>CHECK-IN</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primaryDark }}>{fmt(ops.checkInOpen)} – {fmt(ops.checkInClose)}</Text>
              </View>
            </View>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.primaryLight, borderRadius: isOperations ? 12 : 10, paddingHorizontal: 10, paddingVertical: SPACING.sm, borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorder : 'transparent' }}>
              <MaterialIcons name="meeting-room" size={15} color={colors.primary} />
              <View>
                <Text style={{ fontSize: 9, fontWeight: '600', color: colors.textSub, letterSpacing: 0.3 }}>GATE</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primaryDark }}>{fmt(ops.gateOpen)} – {fmt(ops.gateClose)}</Text>
              </View>
            </View>
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.textSub }}>
            Da: {getFlightAirportLabel(item.flight?.airport?.origin, 'N/A')}
          </Text>
        )}
        {/* Status row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <View style={{ backgroundColor: statusColor + '22', paddingHorizontal: 10, paddingVertical: SPACING.xs, borderRadius: RADIUS.xl }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: statusColor }}>{statusText}</Text>
          </View>
          <View style={{ backgroundColor: colors.warning + '22', paddingHorizontal: 10, paddingVertical: SPACING.xs, borderRadius: RADIUS.xl, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
            <MaterialIcons name="push-pin" size={12} color={colors.warning} />
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.warning }}>{t('homePinned')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// Performance optimization: memoize flatlist item to prevent unnecessary re-renders
const PinnedFlightCard = React.memo(PinnedFlightCardComponent);

type HomeScreenProps = {
  isFocused?: boolean;
  onOpenFlights: () => void;
  onOpenNotificationSettings: () => void;
};

export default function HomeScreen({ isFocused = true, onOpenFlights, onOpenNotificationSettings }: HomeScreenProps) {
  const { colors, mode } = useAppTheme();
  const { airportCode } = useAirport();
  const { t, locale, weatherMap } = useLanguage();
  const isOperations = colors.isDark;
  const [timelineKey, setTimelineKey] = React.useState(0);
  React.useEffect(() => { if (isFocused) setTimelineKey(k => k + 1); }, [isFocused]);
  const HOME_SHIFT_TITLES = { work: 'Lavoro', rest: 'Riposo' };
  const today = new Date();
  const [shiftEvent, setShiftEvent] = useState<any>(null);
  const [shiftKind, setShiftKind] = useState<HomeShiftKind>('none');
  const [weather, setWeather] = useState<{ text: string; iconName: string; temp: number | null } | null>(null);
  const [loadingShift, setLoadingShift] = useState(true);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [newShiftType, setNewShiftType] = useState<'Lavoro' | 'Riposo'>('Lavoro');
  const [newStartH, setNewStartH] = useState('08');
  const [newStartM, setNewStartM] = useState('00');
  const [newEndH, setNewEndH] = useState('16');
  const [newEndM, setNewEndM] = useState('00');
  const [pinnedFlight, setPinnedFlight] = useState<any>(null);
  const [flightProviderStatus, setFlightProviderStatus] = useState<FlightProviderDiagnosticsSnapshot | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationDebugSnapshot | null>(null);
  const [statusNow, setStatusNow] = useState(Date.now());
  const [calendarPermission, setCalendarPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [calendarAvailable, setCalendarAvailable] = useState<boolean | null>(null);
  const [notificationPermissionGranted, setNotificationPermissionGranted] = useState<boolean | null>(null);
  const [flightStatusLoaded, setFlightStatusLoaded] = useState(false);
  const [attentionBusy, setAttentionBusy] = useState(false);

  const hasLoadedShiftRef = useRef(false);

  const toLocalIso = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const toWidgetShiftWindow = (event: any, date: string): WidgetShiftWindow => ({
    date,
    start: new Date(event.startDate).getTime() / 1000,
    end: new Date(event.endDate).getTime() / 1000,
  });

  const formatWidgetShiftLabel = (shift: WidgetShiftWindow, isNext: boolean) => {
    const fmt = (ts: number) => new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const label = `${fmt(shift.start)} – ${fmt(shift.end)}`;
    return isNext ? `Domani ${label}` : label;
  };

  const pushHomeShiftToWidget = async ({
    todayIso,
    shiftToday,
    isRestDay,
    nextShift,
  }: {
    todayIso: string;
    shiftToday: { start: number; end: number } | null;
    isRestDay: boolean;
    nextShift: WidgetShiftWindow | null;
  }) => {
    try {
      const shiftData: WidgetShiftData = { date: todayIso, shiftToday, isRestDay, nextShift };
      await AsyncStorage.setItem(WIDGET_SHIFT_KEY, JSON.stringify(shiftData));

      const now = Date.now() / 1000;
      let widgetData: WidgetData = { state: 'no_shift' };
      const currentShift = shiftToday ? { date: todayIso, ...shiftToday } : null;

      if (currentShift && now <= currentShift.end) {
        widgetData = {
          state: 'work_empty',
          shiftLabel: formatWidgetShiftLabel(currentShift, false),
          updatedAt: '',
        };
      } else if ((!currentShift || now > currentShift.end) && nextShift && nextShift.start > now) {
        widgetData = {
          state: 'work_empty',
          shiftLabel: formatWidgetShiftLabel(nextShift, true),
          updatedAt: '',
        };
      } else if (isRestDay) {
        widgetData = { state: 'rest' };
      }

      const dataToRender = await storeWidgetDataPreservingFlights(widgetData);
      if (Platform.OS === 'android') {
        requestWidgetUpdate({ widgetName: 'ShiftFlights', renderWidget: () => (<ShiftWidget data={dataToRender} />) as any }).catch(() => {});
      }
    } catch {}
  };

  /* Every tab screen stays mounted (App.tsx renders them side by side), so a
     mount-only fetch would leave the Home — and the widget it pushes — stuck
     on stale data after shifts are edited in the Calendar tab or the day
     rolls over while the process stays alive. Re-read the calendar on every
     focus, and refresh silently once a minute while the tab is visible. */
  useEffect(() => {
    if (!isFocused) return;
    fetchShift(hasLoadedShiftRef.current);
    const interval = setInterval(() => { fetchShift(true); }, 60_000);
    return () => clearInterval(interval);
  }, [isFocused]);
  useEffect(() => { if (isFocused) fetchWeather(); }, [airportCode, weatherMap, isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    let mounted = true;
    const refreshHomeStatus = async () => {
      const [provider, notifications, permission] = await Promise.all([
        getCachedFlightProviderDiagnostics(airportCode).catch(() => null),
        getNotificationDebugSnapshot().catch(() => null),
        Platform.OS === 'web' ? Promise.resolve(null) : Notifications.getPermissionsAsync().catch(() => null),
      ]);
      if (!mounted) return;
      setFlightProviderStatus(provider);
      setNotificationStatus(notifications);
      setStatusNow(Date.now());
      setNotificationPermissionGranted(permission ? permission.granted : null);
      setFlightStatusLoaded(true);
    };

    setFlightStatusLoaded(false);
    refreshHomeStatus().catch(() => {});
    const interval = setInterval(() => { refreshHomeStatus().catch(() => {}); }, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [airportCode, isFocused]);

  useEffect(() => {
    dismissLegacyEasyJetOverlapNotification().catch(() => {});
  }, []);

  // Refresh immediately after returning from the phone's permission settings.
  useEffect(() => {
    if (!isFocused) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      setStatusNow(Date.now());
      fetchShift(true);
      if (Platform.OS !== 'web') {
        Notifications.getPermissionsAsync().then(permission => setNotificationPermissionGranted(permission.granted)).catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    let checking = false;

    const clearExpiredPinned = async (expectedRaw: string) => {
      // Do not erase a pin that FlightScreen refreshed while Home was reading
      // its older snapshot.
      if (await AsyncStorage.getItem(PINNED_FLIGHT_KEY) !== expectedRaw) return;

      await AsyncStorage.removeItem(PINNED_FLIGHT_KEY);
      await cancelPinnedNotifications('home confirmed pinned flight expiry', false).catch(() => {});
      await dismissPinnedFlightNotification().catch(() => {});
      if (active) setPinnedFlight(null);
    };

    const loadPinned = async () => {
      if (checking) return;
      checking = true;

      try {
        let raw: string | null;
        try {
          raw = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
        } catch {
          // Keep the last valid card/surfaces on transient storage failures.
          return;
        }
        if (!raw) {
          if (active) setPinnedFlight(null);
          return;
        }

        let pinned: any;
        try {
          pinned = JSON.parse(raw);
        } catch {
          await clearExpiredPinned(raw);
          return;
        }
        const flightId = pinned?.flight?.identification?.number?.default;
        if (typeof flightId !== 'string' || !flightId) {
          await clearExpiredPinned(raw);
          return;
        }
        const tab = pinned._pinTab || 'departures';
        const cache = await loadFlightScreenCache(airportCode, true).catch(() => null);
        if (!active) return;

        // Home must not expire a stored snapshot on its own: it may still hold
        // the old STD while the provider/cache already has a delayed ETD. Only
        // clear after matching the exact service in the airport snapshot.
        if (!cache) {
          setPinnedFlight(pinned);
          return;
        }

        const pool = tab === 'arrivals' ? cache.arrivals : cache.departures;
        const reconciliation = reconcilePinnedFlight(pinned, pool, Date.now() / 1000);
        if (reconciliation.kind === 'keep') {
          await AsyncStorage.getItem(PINNED_FLIGHT_KEY).then(currentRaw => (
            currentRaw === raw
              ? AsyncStorage.setItem(PINNED_FLIGHT_KEY, JSON.stringify(reconciliation.item))
              : undefined
          )).catch(() => {});
          if (active) setPinnedFlight(reconciliation.item);
          return;
        }

        if (reconciliation.reason === 'missing') {
          // A provider/cache gap is not proof that the service has expired.
          setPinnedFlight(pinned);
          return;
        }

        if (reconciliation.reason === 'expired') {
          const realCompletionTs = reconciliation.tab === 'arrivals'
            ? reconciliation.item?.flight?.time?.real?.arrival
            : reconciliation.item?.flight?.time?.real?.departure;
          if (typeof realCompletionTs !== 'number' || realCompletionTs >= Date.now() / 1000) {
            // A cached STD/ETA/ETD in the past can still be superseded by a
            // delay. Only a real completion timestamp is conclusive on Home;
            // fresh provider reconciliation remains FlightScreen's job.
            setPinnedFlight(reconciliation.item);
            return;
          }
        }

        await clearExpiredPinned(raw);
      } finally {
        checking = false;
      }
    };

    loadPinned().catch(() => {});

    const interval = setInterval(() => { loadPinned().catch(() => {}); }, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [airportCode, isFocused]);

  const openModifyModal = () => {
    if (shiftEvent) {
      setNewShiftType(isRest ? 'Riposo' : 'Lavoro');
      const start = new Date(shiftEvent.startDate);
      const end = new Date(shiftEvent.endDate);
      setNewStartH(start.getHours().toString().padStart(2, '0'));
      setNewStartM(start.getMinutes().toString().padStart(2, '0'));
      setNewEndH(end.getHours().toString().padStart(2, '0'));
      setNewEndM(end.getMinutes().toString().padStart(2, '0'));
    } else {
      setNewShiftType('Lavoro');
      setNewStartH('08'); setNewStartM('00'); setNewEndH('16'); setNewEndM('00');
    }
    setShiftModalOpen(true);
  };

  const saveManualShift = async () => {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') { Alert.alert(t('homePermDenied'), t('homeCalendarAuth')); return; }
    try {
      const calendarId = await getWritableCalendarId();
      if (!calendarId) { Alert.alert('Errore', t('homeNoWritableCalendar')); return; }

      const todayDate = new Date();
      const y = todayDate.getFullYear();
      const m = todayDate.getMonth() + 1;
      const d = todayDate.getDate();
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      await replaceShiftForDate({
        calendarId,
        date,
        type: newShiftType === 'Riposo' ? 'rest' : 'work',
        startTime: newShiftType === 'Lavoro' ? `${newStartH.padStart(2, '0')}:${newStartM.padStart(2, '0')}` : undefined,
        endTime: newShiftType === 'Lavoro' ? `${newEndH.padStart(2, '0')}:${newEndM.padStart(2, '0')}` : undefined,
        titles: HOME_SHIFT_TITLES,
        restTiming: HOME_REST_TIMING,
      });

      setShiftModalOpen(false);
      fetchShift(true);
    } catch (e) { Alert.alert('Errore', getErrorMessage(e, 'Errore sconosciuto')); }
  };

  const fetchShift = async (silent = false) => {
    if (!silent) setLoadingShift(true);
    try {
      /* Silent refreshes must not pop the system permission dialog */
      const { status } = silent
        ? await Calendar.getCalendarPermissionsAsync()
        : await Calendar.requestCalendarPermissionsAsync();
      setCalendarPermission(status === 'granted' ? 'granted' : 'denied');
      if (status !== 'granted') {
        setShiftEvent(null);
        setShiftKind('none');
        setCalendarAvailable(null);
        return;
      }
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const cal = cals.find(c => c.allowsModifications && c.isPrimary) || cals.find(c => c.allowsModifications);
      setCalendarAvailable(Boolean(cal));
      if (!cal) { setShiftEvent(null); setShiftKind('none'); return; }
      const now = new Date();
      const yesterdayStart = new Date(now); yesterdayStart.setDate(yesterdayStart.getDate() - 1); yesterdayStart.setHours(0, 0, 0, 0);
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);
      const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setHours(23, 59, 59, 999);
      /* Query a day past the end: expo-calendar's Android query only returns
         events fully contained in the window, so a night shift starting
         tomorrow evening would otherwise be invisible. Selection below
         already filters by start date. */
      const queryEnd = new Date(tomorrowEnd.getTime() + 24 * 60 * 60 * 1000);
      const events = await Calendar.getEventsAsync([cal.id], yesterdayStart, queryEnd);
      const ownedEvents = events.filter(isOwnedShiftEvent);
      const workEvents = ownedEvents
        .filter(e => e.title.includes('Lavoro'))
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      const restEvents = ownedEvents.filter(e => e.title.includes('Riposo'));
      const startsInRange = (event: any, start: Date, end: Date) => {
        const ts = new Date(event.startDate).getTime();
        return ts >= start.getTime() && ts <= end.getTime();
      };
      const currentWork = workEvents.find(e =>
        new Date(e.startDate).getTime() <= now.getTime() && new Date(e.endDate).getTime() > now.getTime(),
      );
      const todayWork = workEvents.find(e => startsInRange(e, todayStart, todayEnd));
      const todayRest = restEvents.find(e => startsInRange(e, todayStart, todayEnd));
      const tomorrowWork = workEvents.find(e => startsInRange(e, tomorrowStart, tomorrowEnd));

      let selectedEvent: any = null;
      let selectedKind: HomeShiftKind = 'none';
      if (currentWork) {
        selectedEvent = currentWork;
        selectedKind = 'today';
      } else if (todayWork) {
        const todayWorkEnded = new Date(todayWork.endDate).getTime() <= now.getTime();
        if (todayWorkEnded && tomorrowWork) {
          selectedEvent = tomorrowWork;
          selectedKind = 'next';
        } else {
          selectedEvent = todayWork;
          selectedKind = 'today';
        }
      } else if (todayRest) {
        selectedEvent = todayRest;
        selectedKind = 'rest';
      }

      setShiftEvent(selectedEvent);
      setShiftKind(selectedKind);

      await pushHomeShiftToWidget({
        todayIso: toLocalIso(todayStart),
        shiftToday: (currentWork ?? todayWork) ? {
          start: new Date((currentWork ?? todayWork)!.startDate).getTime() / 1000,
          end: new Date((currentWork ?? todayWork)!.endDate).getTime() / 1000,
        } : null,
        isRestDay: !!todayRest && !currentWork && !todayWork,
        nextShift: tomorrowWork ? toWidgetShiftWindow(tomorrowWork, toLocalIso(tomorrowStart)) : null,
      });
    } catch (e) { devError('[shift]', e); } finally {
      hasLoadedShiftRef.current = true;
      setLoadingShift(false);
    }
  };

  const fetchWeather = async () => {
    const airport = getAirportInfo(airportCode);
    const fallbackWeather = { text: 'N/D', iconName: 'cloud-question', temp: null };

    try {
      if (airport.latitude == null || airport.longitude == null) {
        setWeather(fallbackWeather);
        return;
      }

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${airport.latitude}&longitude=${airport.longitude}&current=temperature_2m,weather_code&timezone=Europe%2FRome`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`WEATHER_HTTP_${res.status}`);
      const json = await res.json();
      const code = json.current?.weather_code ?? 0;
      const temp = Math.round(json.current?.temperature_2m ?? 0);
      const w = weatherMap[code] || { text: 'Sereno', iconName: 'weather-sunny' };
      setWeather({ ...w, temp });
    } catch (e) {
      setWeather(fallbackWeather);
      devLog('[weather]', e);
    }
  };

  const isRest = shiftEvent?.title?.includes('Riposo');
  const isWork = shiftEvent?.title?.includes('Lavoro');
  const operationalSummary = useMemo(() => buildHomeOperationalSummary({
    loadingShift,
    shiftKind,
    isWork: Boolean(isWork),
    isRest: Boolean(isRest),
    shiftStartMs: shiftEvent ? new Date(shiftEvent.startDate).getTime() : null,
    shiftEndMs: shiftEvent ? new Date(shiftEvent.endDate).getTime() : null,
    nowMs: statusNow,
    locale,
  }), [isRest, isWork, loadingShift, locale, shiftEvent, shiftKind, statusNow]);
  const attention = buildHomeAttention({
    calendarPermission,
    calendarAvailable,
    notificationsEnabled: notificationStatus?.enabled ?? false,
    notificationPermissionGranted,
    duplicateNotifications: notificationStatus?.possibleDuplicates.length ?? 0,
    hasRelevantFlights: Boolean(pinnedFlight) || Boolean(isWork && shiftEvent && new Date(shiftEvent.endDate).getTime() > statusNow),
    flightStatusLoaded,
    providerFetchedAt: flightProviderStatus?.fetchedAt,
    nowMs: statusNow,
  });

  const handleAttention = async (action: HomeAttentionAction) => {
    if (attentionBusy) return;
    setAttentionBusy(true);
    try {
      if (action === 'flights') onOpenFlights();
      else if (action === 'calendar-setup') {
        const calendarId = await getWritableCalendarId();
        if (calendarId) await fetchShift(true);
        else Alert.alert(t('error'), t('homeNoWritableCalendar'));
      }
      else if (action === 'notification-settings') onOpenNotificationSettings();
      else if (action === 'calendar-permission') {
        const permission = await Calendar.requestCalendarPermissionsAsync();
        if (permission.granted) await fetchShift(true);
        else if (!permission.canAskAgain) await Linking.openSettings();
      } else if (action === 'notification-permission') {
        const permission = await Notifications.requestPermissionsAsync();
        setNotificationPermissionGranted(permission.granted);
        if (!permission.granted && !permission.canAskAgain) await Linking.openSettings();
      }
    } catch (error) {
      Alert.alert(t('error'), getErrorMessage(error, t('error')));
    } finally {
      setAttentionBusy(false);
    }
  };
  const s = useMemo(() => makeStyles(colors, isOperations), [colors, isOperations]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 96 }}>
      <View style={s.intro}>
        <View style={s.introCopy}>
          <Text style={s.introDate}>{today.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          <Text accessibilityRole="header" style={s.introTitle}>{t('homeDayOverview')}</Text>
        </View>
        <View style={s.airportBadge}>
          <MaterialIcons name="flight-takeoff" size={16} color={colors.primaryText} />
          <Text style={s.airportCode}>{airportCode}</Text>
        </View>
      </View>

      <BoardReveal index={2} enabled={isOperations}>
        <View style={s.operationalCard}>
          <View style={s.operationalHeader}>
            <Text style={s.operationalKicker}>{operationalSummary.kicker}</Text>
            <View style={[
              s.operationalBeacon,
              operationalSummary.tone === 'active' && s.operationalBeaconActive,
              operationalSummary.tone === 'next' && s.operationalBeaconNext,
              operationalSummary.tone === 'rest' && s.operationalBeaconRest,
            ]}>
              <MaterialIcons
                name={operationalSummary.tone === 'active' ? 'play-arrow' : operationalSummary.tone === 'rest' ? 'hotel' : 'schedule'}
                size={22}
                color={colors.isDark ? '#99F6E4' : '#FFD4B3'}
              />
            </View>
          </View>
          <Text style={[s.operationalTitle, isWork && s.operationalTime]}>{operationalSummary.title}</Text>
          <Text style={s.operationalDetail}>{operationalSummary.detail}</Text>
          <View style={s.weatherStrip}>
            {weather ? (
              <>
                <MaterialCommunityIcons name={weather.iconName as keyof typeof MaterialCommunityIcons.glyphMap} size={22} color="#DCE8EF" />
                <Text style={s.weatherTemp}>{weather.temp == null ? '—' : `${weather.temp}°`}</Text>
                <Text style={s.weatherDesc}>{weather.text}</Text>
              </>
            ) : <ActivityIndicator color="#DCE8EF" />}
            <Text style={s.weatherPlace}>{getAirportInfo(airportCode).city}</Text>
          </View>
        </View>
      </BoardReveal>

      {attention && (
        <View style={s.attentionCard}>
          <View style={s.attentionCopy}>
            <MaterialIcons name="info-outline" size={20} color={colors.primaryText} />
            <View style={s.attentionText}>
              <Text style={s.attentionTitle}>{t(attention.titleKey)}</Text>
              <Text style={s.attentionDetail}>{t(attention.detailKey)}</Text>
            </View>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t(attention.actionKey)}
            accessibilityState={{ disabled: attentionBusy, busy: attentionBusy }}
            disabled={attentionBusy}
            onPress={() => handleAttention(attention.action)}
            style={s.attentionAction}
          >
            <Text style={s.attentionActionText}>{t(attention.actionKey)}</Text>
            {attentionBusy ? <ActivityIndicator size="small" color={colors.primaryText} /> : <MaterialIcons name="arrow-forward" size={18} color={colors.primaryText} />}
          </TouchableOpacity>
        </View>
      )}

      {/* Pinned flight */}
      {pinnedFlight && (
        <BoardReveal index={3} enabled={isOperations}>
          <PinnedFlightCard item={pinnedFlight} colors={colors} isOperations={isOperations} />
        </BoardReveal>
      )}

      {/* Timeline voli nel turno — inline */}
      {shiftEvent && isWork && (
        <View style={s.timelineCard}>
          <ShiftTimeline
            visible={false}
            onClose={() => {}}
            shiftStart={new Date(shiftEvent.startDate)}
            shiftEnd={new Date(shiftEvent.endDate)}
            inline
            active={isFocused}
            refreshKey={timelineKey}
          />
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors, isOperations = false) {
  const operationPanel = c.card;
  const operationBorder = c.glassBorder;
  return StyleSheet.create({
    intro: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingTop: SPACING.xxl, paddingBottom: SPACING.xl },
    introCopy: { flex: 1, minWidth: 0, gap: 5 },
    introDate: { ...TYPE.caption, color: c.textSub, textTransform: 'capitalize' },
    introTitle: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -1, color: c.text },
    airportBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: c.primaryLight, borderRadius: RADIUS.md },
    airportCode: { ...TYPE.caption, fontWeight: '800', color: c.primaryText, letterSpacing: 0.6 },
    operationalCard: { marginHorizontal: SPACING.lg, backgroundColor: c.isDark ? '#193340' : '#193747', borderRadius: 24, padding: SPACING.xl, borderWidth: 1, borderColor: c.isDark ? '#315261' : '#244858', gap: 16 },
    operationalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    operationalKicker: { ...TYPE.overline, color: c.isDark ? '#99F6E4' : '#FFD4B3', letterSpacing: 1.8, flex: 1 },
    operationalTitle: { fontSize: 26, lineHeight: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6 },
    operationalTime: { fontSize: 32, lineHeight: 40, fontVariant: ['tabular-nums'] },
    operationalDetail: { fontSize: 15, lineHeight: 22, color: '#D0DFE7', fontVariant: ['tabular-nums'] },
    operationalBeacon: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
    operationalBeaconActive: { backgroundColor: 'rgba(52,211,153,0.14)' },
    operationalBeaconNext: { backgroundColor: 'rgba(255,255,255,0.10)' },
    operationalBeaconRest: { backgroundColor: 'rgba(96,165,250,0.14)' },
    weatherStrip: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.sm, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.16)', paddingTop: SPACING.lg },
    weatherTemp: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', fontVariant: ['tabular-nums'] },
    weatherDesc: { ...TYPE.caption, color: '#D0DFE7', flexShrink: 1 },
    weatherPlace: { ...TYPE.caption, color: '#D0DFE7', marginLeft: 'auto', flexShrink: 1 },
    attentionCard: { marginHorizontal: SPACING.lg, marginTop: SPACING.lg, padding: SPACING.md, backgroundColor: c.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: c.glassBorder, gap: SPACING.sm },
    attentionCopy: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
    attentionText: { flex: 1, minWidth: 0, gap: 4 },
    attentionTitle: { fontSize: 14, fontWeight: '700', lineHeight: 20, color: c.text },
    attentionDetail: { fontSize: 13, lineHeight: 19, color: c.textSub },
    attentionAction: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 44, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: c.primaryLight, maxWidth: '100%' },
    attentionActionText: { fontSize: 13, fontWeight: '700', lineHeight: 19, color: c.primaryText, flexShrink: 1 },
    timelineCard: { backgroundColor: operationPanel, borderRadius: isOperations ? 22 : 18, marginHorizontal: SPACING.lg, marginTop: SPACING.md, padding: SPACING.lg, shadowColor: '#172B3A', shadowOpacity: isOperations ? 0 : 0.04, shadowRadius: 10, elevation: 0, borderWidth: 1, borderColor: operationBorder },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
    modalContent: { backgroundColor: c.isDark ? c.bg : c.card, width: '100%', borderRadius: RADIUS.xl, padding: SPACING.xl, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 14, elevation: 8, borderWidth: 1, borderColor: c.glassBorder },
    modalTitle: { fontSize: 17, fontWeight: '700', color: c.primaryDark, marginBottom: 14 },
    modalLabel: { fontSize: 12, fontWeight: '700', color: c.textSub, marginBottom: SPACING.sm },
    modalInput: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: SPACING.md, marginBottom: 10, fontSize: 14, color: c.text },
    modalBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
    typeBtn: { flex: 1, padding: SPACING.md, borderRadius: 10, backgroundColor: c.bg, alignItems: 'center' },
    inputLabel: { fontSize: 11, color: c.textSub, fontWeight: '700', marginBottom: SPACING.xs, letterSpacing: 0.5 },
    modeBtn: { flex: 1, backgroundColor: c.primary, borderRadius: 14, paddingVertical: SPACING.xl, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, shadowColor: c.primary, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
    modeBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  });
}
