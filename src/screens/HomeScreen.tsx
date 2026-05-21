import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Image, Modal, TextInput,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as ImagePicker from 'expo-image-picker';
import * as Calendar from 'expo-calendar';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useAirport } from '../context/AirportContext';
import BoardReveal from '../components/motion/BoardReveal';
import ShiftTimeline from '../components/ShiftTimeline';

import { getAirlineOps, getAirlineColor } from '../utils/airlineOps';
import { getAirportInfo } from '../utils/airportSettings';
import { getFlightAirportLabel } from '../utils/flightScheduleAdapter';
import { getCachedFlightProviderDiagnostics, type FlightProviderDiagnosticsSnapshot } from '../utils/fr24api';
import { getNotificationDebugSnapshot, type NotificationDebugSnapshot } from '../utils/notificationDiagnostics';
import {
  buildHomeHealthChips,
  buildHomeOperationalSummary,
  type HomeHealthChip,
  type HomeHealthTone,
} from '../utils/homeOperationalStatus';
import { enableLegacyAndroidLayoutAnimation } from '../utils/layoutAnimation';
import {
  getWritableCalendarId,
  replaceShiftForDate,
  replaceShiftsForRange,
} from '../utils/shiftCalendar';
import { WIDGET_CACHE_KEY, WIDGET_SHIFT_KEY, type WidgetData, type WidgetShiftData, type WidgetShiftWindow } from '../widgets/widgetTaskHandler';
import { ShiftWidget } from '../widgets/ShiftWidget';
import { parseOcrShiftText } from '../utils/ocrShiftParser';
import { useLanguage } from '../context/LanguageContext';

const GOLD = '#F59E0B';

enableLegacyAndroidLayoutAnimation();

const PINNED_FLIGHT_KEY = 'pinned_flight_v1';
const HOME_REST_TIMING = { startHour: 12, startMinute: 0, endHour: 14, endMinute: 0, allDay: true };
type HomeShiftKind = 'today' | 'next' | 'rest' | 'none';

function healthToneColor(tone: HomeHealthTone, fallback: string): string {
  if (tone === 'ready') return '#10B981';
  if (tone === 'missing') return '#EF4444';
  return fallback;
}

function healthIcon(id: HomeHealthChip['id']): keyof typeof MaterialIcons.glyphMap {
  switch (id) {
    case 'airport':
      return 'local-airport';
    case 'flights':
      return 'radar';
    case 'notifications':
      return 'notifications-active';
    case 'widget':
    default:
      return 'widgets';
  }
}

// months comes from useLanguage() context

const engineHtml = `<!DOCTYPE html><html lang="it"><head>
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script></head>
<body style="background-color:transparent;"><script>
window.runTesseract = async function(base64JsonStr) {
  try {
    const images = JSON.parse(base64JsonStr);
    let combinedText = '';
    for (let i = 0; i < images.length; i++) {
      const ret = await Tesseract.recognize(images[i], 'ita+eng');
      combinedText += ret.data.text + '\\n\\n';
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({ success: true, text: combinedText }));
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ success: false, error: e.message || e.toString() }));
  }
};
</script></body></html>`;

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
  const statusColor = raw === 'green' ? '#10b981' : raw === 'red' ? '#ef4444' : raw === 'yellow' ? '#f59e0b' : '#6b7280';

  const dest = tab === 'arrivals'
    ? getFlightAirportLabel(item.flight?.airport?.origin, 'N/A')
    : getFlightAirportLabel(item.flight?.airport?.destination, 'N/A');
  const ts = tab === 'arrivals'
    ? item.flight?.time?.scheduled?.arrival
    : item.flight?.time?.scheduled?.departure;
  const depTime = ts ? new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : 'N/A';

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
      marginHorizontal: 16, marginTop: 16,
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
        paddingVertical: 12, paddingHorizontal: 16,
        borderBottomWidth: isOperations ? 1 : 0,
        borderBottomColor: isOperations ? 'rgba(45,212,191,0.20)' : 'transparent',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ backgroundColor: isOperations ? colors.primaryLight : 'rgba(255,255,255,0.2)', borderRadius: isOperations ? 10 : 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorder : 'transparent' }}>
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
      <View style={{ padding: 12, backgroundColor: panelBg }}>
        {tab === 'departures' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: isOperations ? 12 : 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorder : 'transparent' }}>
              <MaterialIcons name="desktop-windows" size={15} color={colors.primary} />
              <View>
                <Text style={{ fontSize: 9, fontWeight: '600', color: colors.textSub, letterSpacing: 0.3 }}>CHECK-IN</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primaryDark }}>{fmt(ops.checkInOpen)} – {fmt(ops.checkInClose)}</Text>
              </View>
            </View>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: isOperations ? 12 : 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorder : 'transparent' }}>
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
          <View style={{ backgroundColor: statusColor + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: statusColor }}>{statusText}</Text>
          </View>
          <View style={{ backgroundColor: '#F59E0B22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialIcons name="push-pin" size={12} color="#F59E0B" />
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#F59E0B' }}>{t('homePinned')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// Performance optimization: memoize flatlist item to prevent unnecessary re-renders
const PinnedFlightCard = React.memo(PinnedFlightCardComponent);

export default function HomeScreen({ isFocused }: { isFocused?: boolean }) {
  const { colors, mode } = useAppTheme();
  const { airportCode } = useAirport();
  const { t, months, locale, weatherMap } = useLanguage();
  const isOperations = colors.isDark;
  const [timelineKey, setTimelineKey] = React.useState(0);
  React.useEffect(() => { if (isFocused) setTimelineKey(k => k + 1); }, [isFocused]);
  const HOME_SHIFT_TITLES = { work: 'Lavoro', rest: 'Riposo' };
  const today = new Date();
  const [shiftEvent, setShiftEvent] = useState<any>(null);
  const [shiftKind, setShiftKind] = useState<HomeShiftKind>('none');
  const [weather, setWeather] = useState<{ text: string; iconName: string; temp: number | null } | null>(null);
  const [loadingShift, setLoadingShift] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [imageList, setImageList] = useState<string[]>([]);
  const [ocrText, setOcrText] = useState('');
  const [processing, setProcessing] = useState(false);

  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [newShiftType, setNewShiftType] = useState<'Lavoro' | 'Riposo'>('Lavoro');
  const [newStartH, setNewStartH] = useState('08');
  const [newStartM, setNewStartM] = useState('00');
  const [newEndH, setNewEndH] = useState('16');
  const [newEndM, setNewEndM] = useState('00');
  const [uploadMode, setUploadMode] = useState<'image' | 'manual' | null>(null);
  const [pinnedFlight, setPinnedFlight] = useState<any>(null);
  const [flightProviderStatus, setFlightProviderStatus] = useState<FlightProviderDiagnosticsSnapshot | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationDebugSnapshot | null>(null);
  const [statusNow, setStatusNow] = useState(Date.now());

  const webViewRef = useRef<WebView>(null);

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

      await AsyncStorage.setItem(WIDGET_CACHE_KEY, JSON.stringify(widgetData));
      if (Platform.OS === 'android') {
        requestWidgetUpdate({ widgetName: 'ShiftFlights', renderWidget: () => (<ShiftWidget data={widgetData} />) as any }).catch(() => {});
      }
    } catch {}
  };

  useEffect(() => { fetchShift(); }, []);
  useEffect(() => { fetchWeather(); }, [airportCode, weatherMap]);

  useEffect(() => {
    let mounted = true;
    const refreshHomeStatus = async () => {
      const [provider, notifications] = await Promise.all([
        getCachedFlightProviderDiagnostics(airportCode).catch(() => null),
        getNotificationDebugSnapshot().catch(() => null),
      ]);
      if (!mounted) return;
      setFlightProviderStatus(provider);
      setNotificationStatus(notifications);
      setStatusNow(Date.now());
    };

    refreshHomeStatus().catch(() => {});
    const interval = setInterval(() => { refreshHomeStatus().catch(() => {}); }, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [airportCode]);

  useEffect(() => {
    const loadPinned = async () => {
      const raw = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
      if (!raw) { setPinnedFlight(null); return; }
      try {
        const pinned = JSON.parse(raw);
        const tab = pinned._pinTab || 'departures';
        const ts = tab === 'arrivals'
          ? pinned.flight?.time?.scheduled?.arrival
          : pinned.flight?.time?.scheduled?.departure;
        if (ts && ts < Date.now() / 1000) {
          await AsyncStorage.removeItem(PINNED_FLIGHT_KEY);
          setPinnedFlight(null);
        } else {
          setPinnedFlight(pinned);
        }
      } catch { setPinnedFlight(null); }
    };
    loadPinned();

    const interval = setInterval(loadPinned, 30_000);
    return () => clearInterval(interval);
  }, []);

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
    } catch (e: any) { Alert.alert('Errore', e.message); }
  };

  const fetchShift = async (silent = false) => {
    if (!silent) setLoadingShift(true);
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') { setLoadingShift(false); return; }
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const cal = cals.find(c => c.allowsModifications && c.isPrimary) || cals.find(c => c.allowsModifications);
      if (!cal) { setLoadingShift(false); return; }
      const now = new Date();
      const yesterdayStart = new Date(now); yesterdayStart.setDate(yesterdayStart.getDate() - 1); yesterdayStart.setHours(0, 0, 0, 0);
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);
      const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setHours(23, 59, 59, 999);
      const events = await Calendar.getEventsAsync([cal.id], yesterdayStart, tomorrowEnd);
      const workEvents = events
        .filter(e => e.title.includes('Lavoro'))
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      const restEvents = events.filter(e => e.title.includes('Riposo'));
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
        } else if (!todayWorkEnded) {
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
        shiftToday: todayWork ? {
          start: new Date(todayWork.startDate).getTime() / 1000,
          end: new Date(todayWork.endDate).getTime() / 1000,
        } : null,
        isRestDay: !!todayRest && !todayWork,
        nextShift: tomorrowWork ? toWidgetShiftWindow(tomorrowWork, toLocalIso(tomorrowStart)) : null,
      });
    } catch (e) { if (__DEV__) console.error('[shift]', e); } finally { setLoadingShift(false); }
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
      if (__DEV__) console.log('[weather]', e);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 0,
        orderedSelection: true,
        quality: 1,
        base64: true,
      });
      if (!result.canceled && result.assets?.length > 0) {
        setImageList(result.assets.map(a => a.uri));
        setProcessing(true); setOcrText('');
        const base64List = result.assets
          .map(a => a.base64 ? `data:${a.mimeType || 'image/jpeg'};base64,${a.base64}` : null)
          .filter((item): item is string => !!item);
        if (base64List.length === 0) {
          setProcessing(false);
          Alert.alert('Errore OCR', 'Nessuna immagine leggibile selezionata.');
          return;
        }
        const base64Json = JSON.stringify(base64List);
        // Use postMessage pattern to avoid script-injection risks with injectJavaScript
        webViewRef.current?.injectJavaScript(`
          if(window.runTesseract){
            window.runTesseract(${JSON.stringify(base64Json)});
          } else {
            window.ReactNativeWebView.postMessage(JSON.stringify({success:false,error:'OCR non pronto'}));
          }
          true;
        `);
      }
    } catch (e) { if (__DEV__) console.error('[imagePicker]', e); setProcessing(false); }
  };

  const handleWebViewMessage = (event: any) => {
    try {
      const r = JSON.parse(event.nativeEvent.data);
      if (r.success) setOcrText(r.text);
      else Alert.alert('Errore riconoscimento testo', r.error || 'Prova con un\'immagine più nitida o meglio illuminata.');
    } catch (e) { if (__DEV__) console.error('[ocrMessage]', e); } finally { setProcessing(false); }
  };

  const parseAndSave = async () => {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permesso negato', 'Autorizza il calendario.'); return; }
    try {
      const calendarId = await getWritableCalendarId();
      if (!calendarId) { Alert.alert('Errore', 'Nessun calendario scrivibile.'); return; }
      const result = parseOcrShiftText(ocrText);
      if (result.shifts.length === 0) {
        Alert.alert(
          t('homeNoSchedule'),
          result.warning ?? `Date: ${result.datesFound}, Orari: ${result.shiftsFound}`,
        );
        return;
      }

      const saved = await replaceShiftsForRange({
        calendarId,
        shifts: result.shifts,
        titles: HOME_SHIFT_TITLES,
        restTiming: HOME_REST_TIMING,
      });

      Alert.alert(
        saved > 0 ? t('homeShiftSynced') : t('homeNoSchedule'),
        saved > 0
          ? `${saved} turni salvati.`
          : `Date: ${result.datesFound}, Orari: ${result.shiftsFound}`,
      );
      if (saved > 0) fetchShift(true);
    } catch (e: any) { Alert.alert(t('homeCalErr'), e.message); }
  };

  const isRest = shiftEvent?.title?.includes('Riposo');
  const isWork = shiftEvent?.title?.includes('Lavoro');
  const isNextShift = isWork && shiftKind === 'next';
  const operationalSummary = useMemo(() => buildHomeOperationalSummary({
    loadingShift,
    shiftKind,
    isWork: Boolean(isWork),
    isRest: Boolean(isRest),
    shiftStartMs: shiftEvent ? new Date(shiftEvent.startDate).getTime() : null,
    shiftEndMs: shiftEvent ? new Date(shiftEvent.endDate).getTime() : null,
    nowMs: statusNow,
    hasPinnedFlight: Boolean(pinnedFlight),
  }), [isRest, isWork, loadingShift, pinnedFlight, shiftEvent, shiftKind, statusNow]);
  const healthChips = useMemo(() => buildHomeHealthChips({
    providerLabel: flightProviderStatus?.sourceLabel,
    providerFetchedAt: flightProviderStatus?.fetchedAt,
    notificationsEnabled: notificationStatus?.enabled ?? false,
    pendingNotifications: notificationStatus?.pendingAeroStaff ?? 0,
    duplicateNotifications: notificationStatus?.possibleDuplicates.length ?? 0,
    airportCode,
    nowMs: statusNow,
  }), [airportCode, flightProviderStatus, notificationStatus, statusNow]);
  const s = useMemo(() => makeStyles(colors, isOperations), [colors, isOperations]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 96 }}>
      {/* Hidden OCR WebView */}
      <View style={s.hiddenWV}>
        <WebView ref={webViewRef} source={{ html: engineHtml }} onMessage={handleWebViewMessage} javaScriptEnabled />
      </View>

      {/* Top cards row: Weather + Date */}
      <View style={s.topRow}>
        <BoardReveal index={0} enabled={isOperations} style={{ flex: 1 }}>
          <View style={s.weatherCard}>
            {weather ? (
              <>
                <MaterialCommunityIcons
                  name={weather.iconName as keyof typeof MaterialCommunityIcons.glyphMap}
                  size={28}
                  color={colors.primaryDark}
                  style={s.weatherIcon}
                />
                <Text style={s.weatherTemp}>{weather.temp == null ? '--' : `${weather.temp}°`}</Text>
                <Text style={s.weatherDesc}>{t('homeWeatherLocal')} • {weather.text}</Text>
              </>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>
        </BoardReveal>
        <BoardReveal index={1} enabled={isOperations}>
          <View style={s.dateCard}>
            <Text style={s.dateToday}>{t('homeToday')}</Text>
            <Text style={s.dateNum}>{today.getDate()}</Text>
            <Text style={s.dateMonth}>{months[today.getMonth()]}</Text>
          </View>
        </BoardReveal>
      </View>

      <BoardReveal index={2} enabled={isOperations}>
        <View style={s.operationalCard}>
          <View style={s.operationalHeader}>
            <View style={s.operationalTitleBlock}>
              <Text style={s.operationalKicker}>{operationalSummary.kicker}</Text>
              <Text style={s.operationalTitle}>{operationalSummary.title}</Text>
              <Text style={s.operationalDetail}>{operationalSummary.detail}</Text>
            </View>
            <View style={[
              s.operationalBeacon,
              operationalSummary.tone === 'active' && s.operationalBeaconActive,
              operationalSummary.tone === 'next' && s.operationalBeaconNext,
              operationalSummary.tone === 'rest' && s.operationalBeaconRest,
            ]}>
              <MaterialIcons
                name={operationalSummary.tone === 'active' ? 'play-arrow' : operationalSummary.tone === 'rest' ? 'hotel' : 'schedule'}
                size={22}
                color="#FFFFFF"
              />
            </View>
          </View>
          {operationalSummary.badges.length > 0 && (
            <View style={s.summaryBadgeRow}>
              {operationalSummary.badges.map(badge => (
                <View key={badge} style={s.summaryBadge}>
                  <MaterialIcons name="push-pin" size={12} color={colors.primaryDark} />
                  <Text style={s.summaryBadgeText}>{badge}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={s.healthGrid}>
            {healthChips.map(chip => {
              const tone = healthToneColor(chip.tone, colors.primary);
              return (
                <View key={chip.id} style={[s.healthChip, { borderColor: `${tone}55`, backgroundColor: `${tone}16` }]}>
                  <MaterialIcons name={healthIcon(chip.id)} size={15} color={tone} />
                  <View style={s.healthText}>
                    <Text style={[s.healthLabel, { color: colors.textSub }]}>{chip.label}</Text>
                    <Text numberOfLines={1} style={[s.healthValue, { color: chip.tone === 'missing' ? tone : colors.text }]}>
                      {chip.value}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </BoardReveal>

      {/* Pinned flight */}
      {pinnedFlight && (
        <BoardReveal index={3} enabled={isOperations}>
          <PinnedFlightCard item={pinnedFlight} colors={colors} isOperations={isOperations} />
        </BoardReveal>
      )}

      {/* Turno Attuale */}
      <Text style={s.sectionTitle}>{isNextShift ? t('homeNextShift') : t('homeCurrentShift')}</Text>

      <BoardReveal index={pinnedFlight ? 4 : 3} enabled={isOperations}>
        <View style={s.shiftCard}>
          {loadingShift ? (
            <ActivityIndicator color={colors.primary} />
          ) : isWork ? (
            <>
              <View style={s.shiftStrip} />
              <View style={{ flex: 1 }}>
                <View style={s.shiftBadgeRow}>
                  <View style={s.inProgressBadge}>
                    <Text style={s.inProgressText}>{isNextShift ? t('homeNextShiftBadge') : t('homeInProgress')}</Text>
                  </View>
                </View>
                <Text style={s.shiftTitle}>{isNextShift ? t('homeNextShift') : t('homeShiftWork')}</Text>
                <Text style={s.shiftTime}>
                  {new Date(shiftEvent.startDate).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})} – {new Date(shiftEvent.endDate).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})}
                </Text>
              </View>
            </>
          ) : isRest ? (
            <View style={s.restRow}>
              <View style={s.restIconWrap}>
                <MaterialIcons name="hotel" size={22} color="#10b981" />
              </View>
              <Text style={s.restText}>{t('homeRestDay')}</Text>
            </View>
          ) : (
            <Text style={s.emptyShift}>{t('homeNoShift')}</Text>
          )}
        </View>
      </BoardReveal>

      {/* Timeline voli nel turno — inline */}
      {shiftEvent && isWork && (
        <View style={s.timelineCard}>
          <ShiftTimeline
            visible={false}
            onClose={() => {}}
            shiftStart={new Date(shiftEvent.startDate)}
            shiftEnd={new Date(shiftEvent.endDate)}
            inline
            refreshKey={timelineKey}
          />
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors, isOperations = false) {
  const operationPanel = isOperations ? 'rgba(2,8,12,0.64)' : c.card;
  const operationBorder = isOperations ? 'rgba(45,212,191,0.30)' : c.glassBorder;
  const operationShadow = isOperations ? 0 : undefined;
  return StyleSheet.create({
    hiddenWV: { height: 1, width: 1, opacity: 0, position: 'absolute', top: -100 },
    topRow: { flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 8 },
    weatherCard: { flex: 1, backgroundColor: operationPanel, borderRadius: isOperations ? 20 : 18, padding: 16, alignItems: 'center', shadowColor: c.isDark ? '#000000' : c.primary, shadowOpacity: operationShadow ?? 0.12, shadowRadius: 12, elevation: isOperations ? 0 : 4, borderWidth: 1, borderColor: operationBorder },
    weatherIcon: { marginBottom: 4 },
    weatherTemp: { fontSize: isOperations ? 30 : 28, fontWeight: '800', color: c.primaryDark },
    weatherDesc: { fontSize: 11, color: c.textSub, textAlign: 'center', marginTop: 2, letterSpacing: isOperations ? 0.4 : 0 },
    dateCard: { width: isOperations ? 96 : 90, backgroundColor: isOperations ? 'rgba(45,212,191,0.12)' : c.primaryDark, borderRadius: isOperations ? 20 : 18, padding: 14, alignItems: 'center', justifyContent: 'center', shadowColor: c.isDark ? '#000000' : c.primary, shadowOpacity: isOperations ? 0 : 0.30, shadowRadius: 12, elevation: isOperations ? 0 : 6, borderWidth: isOperations ? 1 : 0, borderColor: operationBorder },
    dateToday: { fontSize: 10, color: isOperations ? 'rgba(153,246,228,0.72)' : 'rgba(255,255,255,0.6)', letterSpacing: 1.7, fontWeight: '800' },
    dateNum: { fontSize: 36, fontWeight: '800', color: isOperations ? c.primaryDark : '#fff', lineHeight: 40 },
    dateMonth: { fontSize: 12, color: isOperations ? c.textSub : 'rgba(255,255,255,0.7)', marginTop: 2 },
    operationalCard: { marginHorizontal: 16, marginTop: 8, backgroundColor: operationPanel, borderRadius: isOperations ? 24 : 20, padding: 16, borderWidth: 1, borderColor: operationBorder, gap: 13, shadowColor: c.isDark ? '#000000' : c.primary, shadowOpacity: isOperations ? 0 : 0.08, shadowRadius: 12, elevation: isOperations ? 0 : 3 },
    operationalHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    operationalTitleBlock: { flex: 1, gap: 3 },
    operationalKicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.8, color: isOperations ? 'rgba(153,246,228,0.70)' : c.textMuted },
    operationalTitle: { fontSize: isOperations ? 25 : 22, fontWeight: '900', color: c.text, letterSpacing: -0.5 },
    operationalDetail: { fontSize: 13, lineHeight: 18, color: c.textSub },
    operationalBeacon: { width: 48, height: 48, borderRadius: isOperations ? 16 : 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#64748B' },
    operationalBeaconActive: { backgroundColor: '#10B981' },
    operationalBeaconNext: { backgroundColor: c.primary },
    operationalBeaconRest: { backgroundColor: '#0EA5E9' },
    summaryBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    summaryBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: operationBorder, backgroundColor: isOperations ? 'rgba(45,212,191,0.12)' : c.primaryLight, paddingHorizontal: 9, paddingVertical: 5 },
    summaryBadgeText: { fontSize: 11, fontWeight: '900', color: c.primaryDark },
    healthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    healthChip: { width: '48%', minWidth: 134, flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9 },
    healthText: { flex: 1, minWidth: 0 },
    healthLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
    healthValue: { fontSize: 12, fontWeight: '900', marginTop: 1 },
    sectionTitle: { fontSize: 12, fontWeight: '800', color: isOperations ? 'rgba(153,246,228,0.66)' : c.textSub, letterSpacing: isOperations ? 1.6 : 0.5, marginHorizontal: 16, marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
    shiftCard: { backgroundColor: operationPanel, borderRadius: isOperations ? 22 : 18, marginHorizontal: 16, padding: isOperations ? 18 : 16, flexDirection: 'row', gap: 14, shadowColor: c.isDark ? '#000000' : c.primary, shadowOpacity: isOperations ? 0 : 0.10, shadowRadius: 12, elevation: isOperations ? 0 : 4, minHeight: isOperations ? 104 : 90, borderWidth: 1, borderColor: operationBorder },
    shiftStrip: { width: isOperations ? 5 : 4, borderRadius: 999, backgroundColor: c.primary, marginRight: 2 },
    shiftBadgeRow: { flexDirection: 'row', marginBottom: 8 },
    inProgressBadge: { backgroundColor: isOperations ? 'rgba(45,212,191,0.14)' : '#D1FAE5', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorder : 'transparent' },
    inProgressText: { fontSize: 10, fontWeight: '800', color: isOperations ? c.primaryDark : '#059669', letterSpacing: isOperations ? 1 : 0 },
    shiftTitle: { fontSize: isOperations ? 18 : 17, fontWeight: '800', color: isOperations ? c.text : c.primaryDark, marginBottom: 4 },
    shiftTime: { fontSize: isOperations ? 28 : 22, fontWeight: '900', color: isOperations ? c.primaryDark : c.primary, marginBottom: 4, fontVariant: ['tabular-nums'] },
    timelineCard: { backgroundColor: operationPanel, borderRadius: isOperations ? 22 : 18, marginHorizontal: 16, marginTop: 12, padding: 16, shadowColor: c.isDark ? '#000000' : c.primary, shadowOpacity: isOperations ? 0 : 0.08, shadowRadius: 10, elevation: isOperations ? 0 : 3, borderWidth: 1, borderColor: operationBorder },
    restRow: { flexDirection: 'row', alignItems: 'center' },
    restIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#10b98122', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    restText: { fontSize: 18, fontWeight: '700', color: '#10b981' },
    emptyShift: { color: c.textSub, fontSize: 15, lineHeight: 24, textAlign: 'center', flex: 1 },
    uploadToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 16, backgroundColor: c.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, shadowColor: c.isDark ? '#000000' : c.primary, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3, borderWidth: 1, borderColor: c.glassBorder },
    uploadToggleText: { flex: 1, fontSize: 15, fontWeight: '600', color: c.primaryDark },
    uploadSection: { marginHorizontal: 16, backgroundColor: c.card, borderRadius: 18, padding: 16, marginTop: 2, shadowColor: c.isDark ? '#000000' : c.primary, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, borderWidth: 1, borderColor: c.glassBorder },
    uploadDesc: { fontSize: 13, color: c.textSub, lineHeight: 19, marginBottom: 14 },
    scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryDark, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 20 },
    scanBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    imagesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    thumb: { width: '47%', height: 120, borderRadius: 10, resizeMode: 'cover' },
    ocrResult: { backgroundColor: c.cardSecondary, borderRadius: 12, padding: 12, marginTop: 12 },
    ocrTitle: { fontSize: 12, fontWeight: '700', color: c.textSub, marginBottom: 6 },
    ocrText: { fontSize: 12, color: c.text, lineHeight: 18 },
    syncBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, borderRadius: 12, paddingVertical: 13, marginTop: 12 },
    syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    modalContent: { backgroundColor: c.isDark ? c.bg : c.card, width: '100%', borderRadius: 20, padding: 20, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 14, elevation: 8, borderWidth: 1, borderColor: c.glassBorder },
    modalTitle: { fontSize: 17, fontWeight: '700', color: c.primaryDark, marginBottom: 14 },
    modalLabel: { fontSize: 12, fontWeight: '700', color: c.textSub, marginBottom: 8 },
    modalInput: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 14, color: c.text },
    modalBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
    typeBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: c.bg, alignItems: 'center' },
    inputLabel: { fontSize: 11, color: c.textSub, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 },
    modeBtn: { flex: 1, backgroundColor: c.primary, borderRadius: 14, paddingVertical: 20, alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: c.primary, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
    modeBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  });
}
