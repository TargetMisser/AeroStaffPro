import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity,
  Modal, Alert, FlatList, TextInput,
  Linking, InteractionManager,
} from 'react-native';
import * as SystemCalendar from 'expo-calendar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Calendar as RNCalendar, LocaleConfig, type DateData } from 'react-native-calendars';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import TimeCarouselPicker from '../components/TimeCarouselPicker';
import { useAirport } from '../context/AirportContext';
import { getAirportInfo } from '../utils/airportSettings';
import {
  getWritableCalendarId,
  replaceShiftForDate,
  replaceShiftsForRange,
} from '../utils/shiftCalendar';
import { WIDGET_SHIFT_KEY, WIDGET_CACHE_KEY } from '../widgets/widgetTaskHandler';
import type { WidgetShiftData, WidgetData } from '../widgets/widgetTaskHandler';
import { requestShiftWidgetUpdate } from '../widgets/widgetThemeSync';
import { buildCalendarFlightCountsFromCache } from '../utils/calendarFlightStats';
import { getCalendarStatsRange } from '../utils/calendarStatsRange';
import { loadFlightScreenCache } from '../utils/flightScreenCache';
import {
  getPdfExtractorHtml, parseShiftCells,
  parseShiftCellFiles,
  type ParsedSchedule, type ParsedEmployee,
} from '../utils/pdfShiftParser';
import { useLanguage } from '../context/LanguageContext';

const STORAGE_KEY = '@shift_import_name';

type ShiftEvent = {
  id: string;
  title: string;
  startDate: string | Date;
  endDate: string | Date;
};

type DayStats = {
  weatherText: string;
  weatherIconName: string;
  flightCount: number;
};

type CalendarMarkedDates = Record<string, {
  dots?: Array<{ key: string; color: string; selectedDotColor?: string }>;
  selected?: boolean;
  selectedColor?: string;
  selectedTextColor?: string;
}>;

type CalendarViewMode = 'calendar' | 'week';

function getMonday(d: Date | null | undefined): Date {
  if (!d || isNaN(d.getTime())) return getMonday(new Date());
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  return date;
}

function toLocalIso(dateValue: string | Date): string {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function getMonthStart(date: Date): Date {
  const next = new Date(date);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isSameMonth(date: Date, iso: string): boolean {
  const target = fromIsoDate(iso);
  return target.getFullYear() === date.getFullYear() && target.getMonth() === date.getMonth();
}

export default function CalendarScreen({ isFocused = true }: { isFocused?: boolean }) {
  const { colors } = useAppTheme();
  const { lang, t, months, weekDaysShort, weekDaysLong, locale, weatherMap } = useLanguage();
  const { airportCode, isLoading: airportLoading } = useAirport();
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => getMonthStart(new Date()));
  const [selectedDay, setSelectedDay] = useState<string>(() => toLocalIso(new Date()));
  const [eventsData, setEventsData] = useState<Record<string, ShiftEvent[]>>({});
  const [dailyStats, setDailyStats] = useState<Record<string, DayStats>>({});
  const [loading, setLoading] = useState(true);
  const [calId, setCalId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const hasLoadedCalendarRef = useRef(false);

  // Import flow state
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importStep, setImportStep] = useState<'idle' | 'extracting' | 'pickName' | 'preview' | 'saving' | 'done'>('idle');
  const [pdfHtml, setPdfHtml] = useState<string | null>(null);
  const [importFileCount, setImportFileCount] = useState(0);
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<ParsedEmployee | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  // ─── Edit menu + manual entry ───────────────────────────────────────────────
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [manualDate, setManualDate] = useState(selectedDay);
  const [manualType, setManualType] = useState<'Lavoro' | 'Riposo'>('Lavoro');
  const [manualStartH, setManualStartH] = useState(8);
  const [manualStartM, setManualStartM] = useState(0);
  const [manualEndH, setManualEndH] = useState(16);
  const [manualEndM, setManualEndM] = useState(0);
  const selectedStatsRange = useMemo(() => getCalendarStatsRange(selectedDay), [selectedDay]);

  const getManualPrefillForSelectedDay = () => {
    const dayEvents = eventsData[selectedDay] || [];
    const existingWork = dayEvents.find(event => event.title.includes('Lavoro'));
    const existingRest = dayEvents.find(event => event.title.includes('Riposo'));

    if (existingWork) {
      const startDate = new Date(existingWork.startDate);
      const endDate = new Date(existingWork.endDate);

      return {
        date: selectedDay,
        type: 'Lavoro' as const,
        startH: startDate.getHours(),
        startM: startDate.getMinutes(),
        endH: endDate.getHours(),
        endM: endDate.getMinutes(),
      };
    }

    if (existingRest) {
      return {
        date: selectedDay,
        type: 'Riposo' as const,
        startH: 8,
        startM: 0,
        endH: 16,
        endM: 0,
      };
    }

    return {
      date: selectedDay,
      type: 'Lavoro' as const,
      startH: 8,
      startM: 0,
      endH: 16,
      endM: 0,
    };
  };

  const openManualEntry = () => {
    const prefill = getManualPrefillForSelectedDay();
    setEditMenuOpen(false);
    setManualDate(prefill.date);
    setManualType(prefill.type);
    setManualStartH(prefill.startH);
    setManualStartM(prefill.startM);
    setManualEndH(prefill.endH);
    setManualEndM(prefill.endM);
    setPickerKey(k => k + 1);
    setManualModalOpen(true);
  };

  // Push the saved shift to the widget so it updates immediately without opening FlightScreen
  const pushShiftToWidget = async (date: string, type: 'work' | 'rest', startH?: number, startM?: number, endH?: number, endM?: number) => {
    try {
      const today = new Date();
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const todayIso = toLocalIso(today);
      const tomorrowIso = toLocalIso(tomorrow);
      if (date !== todayIso && date !== tomorrowIso) return;

      const existingRaw = await AsyncStorage.getItem(WIDGET_SHIFT_KEY);
      const existing: WidgetShiftData | null = existingRaw ? JSON.parse(existingRaw) : null;
      let shiftToday = existing?.date === todayIso ? existing.shiftToday : null;
      let isRestDay = existing?.date === todayIso ? existing.isRestDay : false;
      let nextShift = existing?.date === todayIso ? existing.nextShift ?? null : null;
      const isRest = type === 'rest';

      const buildShiftWindow = (baseDate: Date, sh: number, sm: number, eh: number, em: number) => {
        const startTs = new Date(baseDate); startTs.setHours(sh, sm, 0, 0);
        let endTs = new Date(baseDate); endTs.setHours(eh, em, 0, 0);
        if (endTs <= startTs) endTs.setDate(endTs.getDate() + 1);
        return { start: startTs.getTime() / 1000, end: endTs.getTime() / 1000 };
      };

      if (date === todayIso) {
        isRestDay = isRest;
        shiftToday = null;
        if (!isRest && startH !== undefined && startM !== undefined && endH !== undefined && endM !== undefined) {
          const base = new Date(today); base.setHours(0, 0, 0, 0);
          shiftToday = buildShiftWindow(base, startH, startM, endH, endM);
          isRestDay = false;
        }
      } else if (date === tomorrowIso) {
        nextShift = null;
        if (!isRest && startH !== undefined && startM !== undefined && endH !== undefined && endM !== undefined) {
          const base = new Date(tomorrow); base.setHours(0, 0, 0, 0);
          nextShift = { date: tomorrowIso, ...buildShiftWindow(base, startH, startM, endH, endM) };
        }
      }

      const shiftKeyData: WidgetShiftData = { date: todayIso, shiftToday, isRestDay, nextShift };
      await AsyncStorage.setItem(WIDGET_SHIFT_KEY, JSON.stringify(shiftKeyData));
      // Invalidate flight cache so widget fetches fresh flights next update
      const now = Date.now() / 1000;
      const fmt = (ts: number) => new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      
      let noFlightData: WidgetData;
      if (shiftToday && now <= shiftToday.end) {
        noFlightData = { state: 'work_empty', shiftLabel: `${fmt(shiftToday.start)} – ${fmt(shiftToday.end)}`, updatedAt: '' };
      } else if ((!shiftToday || now > shiftToday.end) && nextShift && nextShift.start > now) {
        noFlightData = { state: 'work_empty', shiftLabel: `Domani ${fmt(nextShift.start)} – ${fmt(nextShift.end)}`, updatedAt: '' };
      } else if (isRestDay) {
        noFlightData = { state: 'rest' };
      } else {
        noFlightData = { state: 'no_shift' };
      }

      await AsyncStorage.setItem(WIDGET_CACHE_KEY, JSON.stringify(noFlightData));
      requestShiftWidgetUpdate(noFlightData as any).catch(() => {});
    } catch {}
  };

  const saveManualShift = async () => {
    const { status, canAskAgain } = await SystemCalendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      if (!canAskAgain) {
        Alert.alert(t('calPermDenied'), t('calPermSettingsHint'), [
          { text: t('cancel'), style: 'cancel' },
          { text: t('calOpenSettings'), onPress: () => Linking.openSettings() },
        ]);
      } else {
        Alert.alert(t('calPermDenied'));
      }
      return;
    }

    try {
      const calendarId = calId ?? await getWritableCalendarId();
      if (!calendarId) { Alert.alert('Errore', t('calNoWritableCalendar')); return; }
      if (!calId) setCalId(calendarId);

      const shiftType: 'work' | 'rest' = manualType === 'Riposo' ? 'rest' : 'work';
      await replaceShiftForDate({
        calendarId,
        date: manualDate,
        type: shiftType,
        startTime: manualType === 'Lavoro' ? `${String(manualStartH).padStart(2, '0')}:${String(manualStartM).padStart(2, '0')}` : undefined,
        endTime: manualType === 'Lavoro' ? `${String(manualEndH).padStart(2, '0')}:${String(manualEndM).padStart(2, '0')}` : undefined,
      });

      setManualModalOpen(false);
      fetchCalendar(true);
      pushShiftToWidget(manualDate, shiftType, manualStartH, manualStartM, manualEndH, manualEndM);
      Alert.alert(t('calShiftSaved'));
    } catch (e: any) { Alert.alert('Errore', e.message); }
  };

  // Load saved name
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(n => { if (n) setSavedName(n); });
  }, []);

  useEffect(() => {
    const localeConfig = LocaleConfig as unknown as {
      locales?: Record<string, {
        monthNames: string[];
        monthNamesShort: string[];
        dayNames: string[];
        dayNamesShort: string[];
        today: string;
      }>;
      defaultLocale?: string;
    };

    localeConfig.locales ??= {};
    localeConfig.locales[lang] = {
      monthNames: months,
      monthNamesShort: months.map(month => month.slice(0, 3)),
      dayNames: weekDaysLong,
      dayNamesShort: weekDaysShort,
      today: lang === 'it' ? 'Oggi' : 'Today',
    };
    localeConfig.defaultLocale = lang;
  }, [lang, months, weekDaysLong, weekDaysShort]);

  useEffect(() => {
    if (!isFocused || airportLoading) return;
    fetchCalendar(hasLoadedCalendarRef.current);
  }, [visibleMonth, airportCode, airportLoading, isFocused]);

  useEffect(() => {
    if (!isFocused || airportLoading || loading) return;
    const task = InteractionManager.runAfterInteractions(() => {
      const weekStart = fromIsoDate(selectedStatsRange.startIso);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = fromIsoDate(selectedStatsRange.endIso);
      weekEnd.setDate(weekEnd.getDate() + 1);
      weekEnd.setHours(0, 0, 0, 0);
      fetchWeatherAndFlights(weekStart, weekEnd, eventsData);
    });
    return () => task.cancel();
  }, [selectedStatsRange.key, eventsData, airportCode, airportLoading, loading, weatherMap, isFocused]);

  const fetchCalendar = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const { status } = await SystemCalendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        hasLoadedCalendarRef.current = true;
        setLoading(false);
        return;
      }
      const calendars = await SystemCalendar.getCalendarsAsync(SystemCalendar.EntityTypes.EVENT);
      const cal = calendars.find(c => c.allowsModifications && c.isPrimary) || calendars.find(c => c.allowsModifications);
      if (!cal) {
        hasLoadedCalendarRef.current = true;
        setLoading(false);
        return;
      }
      setCalId(cal.id);
      const monthStart = getMonthStart(visibleMonth);
      const monthEnd = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1, 0, 0, 0, 0);
      const rangeStart = new Date(monthStart); rangeStart.setDate(rangeStart.getDate() - 7);
      const rangeEnd = new Date(monthEnd); rangeEnd.setDate(rangeEnd.getDate() + 7);
      const events = await SystemCalendar.getEventsAsync([cal.id], rangeStart, rangeEnd);
      const localData: Record<string, ShiftEvent[]> = {};
      events.forEach(e => {
        if (e.title.includes('Lavoro') || e.title.includes('Riposo')) {
          const iso = toLocalIso(e.startDate);
          if (!localData[iso]) localData[iso] = [];
          localData[iso].push({ id: e.id, title: e.title, startDate: e.startDate, endDate: e.endDate });
        }
      });
      setEventsData(prev => {
        const next = { ...prev };
        for (const iso of Object.keys(next)) {
          const day = fromIsoDate(iso);
          if (day >= rangeStart && day < rangeEnd) delete next[iso];
        }
        return { ...next, ...localData };
      });
      hasLoadedCalendarRef.current = true;
      setLoading(false);
    } catch (e) {
      if (__DEV__) console.error(e);
      hasLoadedCalendarRef.current = true;
      setLoading(false);
    }
  };

  const fetchWeatherAndFlights = async (start: Date, end: Date, localData: Record<string, ShiftEvent[]>) => {
    const dict: Record<string, DayStats> = {};
    try {
      const airport = getAirportInfo(airportCode);
      if (airport.latitude == null || airport.longitude == null) {
        throw new Error('AIRPORT_COORDS_MISSING');
      }

      const s = start.toISOString().split('T')[0];
      const e2 = new Date(end.getTime() - 1000).toISOString().split('T')[0];
      const wr = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${airport.latitude}&longitude=${airport.longitude}&daily=weather_code&timezone=Europe%2FRome&start_date=${s}&end_date=${e2}`);
      if (!wr.ok) throw new Error(`WEATHER_HTTP_${wr.status}`);
      const wj = await wr.json();
      if (wj.daily?.time) {
        wj.daily.time.forEach((date: string, i: number) => {
          const m = weatherMap[wj.daily.weather_code[i] || 0] || { text: 'Sereno', iconName: 'weather-sunny' };
          dict[date] = { weatherText: m.text, weatherIconName: m.iconName, flightCount: 0 };
        });
      }
    } catch (e) { if (__DEV__) console.log('[calWeather]', e); }
    try {
      const cache = await loadFlightScreenCache(airportCode);
      const counts = buildCalendarFlightCountsFromCache(localData, cache?.departures ?? [], cache?.arrivals ?? []);
      Object.entries(counts).forEach(([iso, cnt]) => {
        if (dict[iso]) dict[iso].flightCount = cnt;
        else dict[iso] = { weatherText: 'N/A', weatherIconName: 'cloud-question', flightCount: cnt };
      });
    } catch (e) { if (__DEV__) console.log('[calFlightsCache]', e); }
    setDailyStats(dict);
  };

  // ─── Import flow ─────────────────────────────────────────────────────────────
  const startImport = async () => {
    let step = 'picker';
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const assets = result.assets.filter(asset => !!asset.uri);
      if (assets.length === 0) return;

      step = 'read';
      const base64Files: string[] = [];
      for (const asset of assets) {
        const fileInfo = await FileSystem.getInfoAsync(asset.uri);
        if (!fileInfo.exists) {
          Alert.alert('Errore', `File non trovato: ${asset.name || asset.uri}`);
          return;
        }

        step = 'base64';
        base64Files.push(await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }));
      }

      step = 'webview';
      setParsedSchedule(null);
      setSelectedEmployee(null);
      setImportFileCount(base64Files.length);
      setImportStep('extracting');
      setImportModalVisible(true);
      setPdfHtml(getPdfExtractorHtml(base64Files));
    } catch (e: any) {
      if (__DEV__) console.error(`Import error at step=${step}:`, e);
      Alert.alert('Errore', `Errore (${step}): ${e?.message || e}`);
    }
  };

  const onWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      setPdfHtml(null); // Remove WebView

      if (!data.ok) {
        Alert.alert('Errore', t('calNoPdfText'));
        setImportModalVisible(false);
        setImportStep('idle');
        setImportFileCount(0);
        return;
      }

      const files = (Array.isArray(data.files) && data.files.length > 0
        ? data.files
        : [{ cells: Array.isArray(data.cells) ? data.cells : [] }]
      ).map((file: any) => ({ cells: Array.isArray(file?.cells) ? file.cells : [] }));
      const schedule = files.length > 1 ? parseShiftCellFiles(files) : parseShiftCells(files[0].cells);
      if (schedule.employees.length === 0) {
        Alert.alert('Errore', t('calNoEmployees'));
        setImportModalVisible(false);
        setImportStep('idle');
        setImportFileCount(0);
        return;
      }

      setParsedSchedule(schedule);

      // Auto-select if saved name matches
      if (savedName) {
        const match = schedule.employees.find(e =>
          e.name.toLowerCase().includes(savedName.toLowerCase())
        );
        if (match) {
          setSelectedEmployee(match);
          setImportStep('preview');
          return;
        }
      }

      setImportStep('pickName');
    } catch (e) {
      if (__DEV__) console.error(e);
      Alert.alert('Errore', 'Errore nel parsing del PDF');
      setImportModalVisible(false);
      setImportStep('idle');
      setImportFileCount(0);
    }
  };

  const selectEmployee = (emp: ParsedEmployee) => {
    setSelectedEmployee(emp);
    // Save name for next time
    AsyncStorage.setItem(STORAGE_KEY, emp.name);
    setSavedName(emp.name);
    setImportStep('preview');
  };

  const confirmImport = async () => {
    if (!selectedEmployee) return;
    setImportStep('saving');

    try {
      const calendarId = calId ?? await getWritableCalendarId();
      if (!calendarId) {
        Alert.alert('Errore', 'Nessun calendario scrivibile');
        setImportStep('idle');
        setImportFileCount(0);
        return;
      }
      if (!calId) setCalId(calendarId);

      const saved = await replaceShiftsForRange({
        calendarId,
        shifts: selectedEmployee.shifts.map(shift => ({
          date: shift.date,
          type: shift.type,
          startTime: shift.start,
          endTime: shift.end,
        })),
      });

      // Push today's shift to widget if it's included in the import
      const todayIso = toLocalIso(new Date());
      const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowIso = toLocalIso(tomorrowDate);
      const todayShift = selectedEmployee.shifts.find(s => s.date === todayIso);
      if (todayShift) {
        const [sh, sm] = (todayShift.start || '00:00').split(':').map(Number);
        const [eh, em] = (todayShift.end || '00:00').split(':').map(Number);
        pushShiftToWidget(todayIso, todayShift.type, sh, sm, eh, em);
      }
      const tomorrowShift = selectedEmployee.shifts.find(s => s.date === tomorrowIso);
      if (tomorrowShift) {
        const [sh, sm] = (tomorrowShift.start || '00:00').split(':').map(Number);
        const [eh, em] = (tomorrowShift.end || '00:00').split(':').map(Number);
        pushShiftToWidget(tomorrowIso, tomorrowShift.type, sh, sm, eh, em);
      }

      setImportStep('done');
      setTimeout(() => {
        setImportModalVisible(false);
        setImportStep('idle');
        setImportFileCount(0);
        fetchCalendar(true);
        Alert.alert(t('calImportComplete'), `${saved} turni salvati nel calendario`);
      }, 800);
    } catch (e) {
      if (__DEV__) console.error(e);
      Alert.alert('Errore', t('calImportError'));
      setImportStep('idle');
      setImportFileCount(0);
    }
  };

  const monthLabel = visibleMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const todayIso = toLocalIso(new Date());
  const selectedEvents = eventsData[selectedDay] || [];
  const workEvent = selectedEvents.find(e => e.title.includes('Lavoro'));
  const restEvent = selectedEvents.find(e => e.title.includes('Riposo'));
  const stats = dailyStats[selectedDay];
  const s = useMemo(() => makeStyles(colors), [colors]);
  const markedDates = useMemo<CalendarMarkedDates>(() => {
    const next: CalendarMarkedDates = {};
    for (const [iso, events] of Object.entries(eventsData)) {
      const dots = [];
      if (events.some(event => event.title.includes('Lavoro'))) {
        dots.push({ key: 'work', color: colors.primary, selectedDotColor: '#fff' });
      }
      if (events.some(event => event.title.includes('Riposo'))) {
        dots.push({ key: 'rest', color: '#10b981', selectedDotColor: '#fff' });
      }
      if (dots.length > 0) next[iso] = { dots };
    }
    next[selectedDay] = {
      ...(next[selectedDay] ?? {}),
      selected: true,
      selectedColor: colors.primary,
      selectedTextColor: '#fff',
    };
    return next;
  }, [eventsData, selectedDay, colors.primary]);
  const monthHoursSummary = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const dayEntries = Object.entries(eventsData)
      .filter(([iso]) => {
        const d = fromIsoDate(iso);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .sort((a, b) => a[0].localeCompare(b[0]));

    let totalMinutes = 0;
    const workDays: Array<{ iso: string; hours: number }> = [];
    for (const [iso, events] of dayEntries) {
      const work = events.find(e => e.title.includes('Lavoro'));
      if (!work) continue;
      const start = new Date(work.startDate).getTime();
      const end = new Date(work.endDate).getTime();
      const minutes = Math.max(0, Math.round((end - start) / 60000));
      totalMinutes += minutes;
      workDays.push({ iso, hours: minutes / 60 });
    }
    return { totalHours: totalMinutes / 60, shiftsCount: workDays.length, workDays };
  }, [eventsData, visibleMonth]);

  const selectedWeekDays = useMemo(() => {
    const start = getMonday(fromIsoDate(selectedDay));
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const iso = toLocalIso(date);
      const events = eventsData[iso] || [];
      const work = events.find(e => e.title.includes('Lavoro'));
      const rest = events.find(e => e.title.includes('Riposo'));
      const minutes = work
        ? Math.max(0, Math.round((new Date(work.endDate).getTime() - new Date(work.startDate).getTime()) / 60000))
        : 0;
      return { date, iso, events, work, rest, minutes, stats: dailyStats[iso] };
    });
  }, [dailyStats, eventsData, selectedDay]);

  const weekHoursSummary = useMemo(() => {
    const totalMinutes = selectedWeekDays.reduce((sum, day) => sum + day.minutes, 0);
    const shiftsCount = selectedWeekDays.filter(day => !!day.work).length;
    return { totalHours: totalMinutes / 60, shiftsCount };
  }, [selectedWeekDays]);

  const weekRangeLabel = useMemo(() => {
    const first = selectedWeekDays[0]?.date;
    const last = selectedWeekDays[selectedWeekDays.length - 1]?.date;
    if (!first || !last) return '';
    return `${first.toLocaleDateString(locale, { day: '2-digit', month: 'short' })} - ${last.toLocaleDateString(locale, { day: '2-digit', month: 'short' })}`;
  }, [locale, selectedWeekDays]);

  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split('-');
    const dt = new Date(+y, +m - 1, +d);
    const dayName = weekDaysShort[dt.getDay()];
    return `${dayName} ${d}/${m}`;
  };

  const handleDayPress = (day: DateData) => {
    setSelectedDay(day.dateString);
    const nextMonth = new Date(day.year, day.month - 1, 1);
    if (!isSameMonth(visibleMonth, day.dateString)) {
      setVisibleMonth(nextMonth);
    }
  };

  const handleMonthChange = (day: DateData) => {
    const nextMonth = new Date(day.year, day.month - 1, 1);
    setVisibleMonth(nextMonth);
    if (!isSameMonth(nextMonth, selectedDay)) {
      setSelectedDay(day.dateString);
    }
  };

  const renderCalendarDay = (props: any) => {
    const { date, state, marking, onPress } = props as {
      date?: DateData;
      state?: string;
      marking?: CalendarMarkedDates[string] & { dots?: Array<{ key?: string; color: string; selectedDotColor?: string }> };
      onPress?: (value?: DateData) => void;
    };

    if (!date) return <View style={s.dayCellWrap} />;

    const isSelected = !!marking?.selected;
    const isToday = date.dateString === todayIso;
    const isInactive = state === 'disabled' || state === 'inactive';
    const dots = marking?.dots ?? [];

    return (
      <TouchableOpacity style={s.dayCellWrap} activeOpacity={0.85} onPress={() => onPress?.(date)}>
        <View
          style={[
            s.dayCellInner,
            isSelected && s.dayCellInnerSelected,
            isToday && s.dayCellInnerToday,
            isToday && isSelected && s.dayCellInnerTodaySelected,
          ]}
        >
          <Text
            style={[
              s.dayCellText,
              isInactive && s.dayCellTextInactive,
              isToday && s.dayCellTextToday,
              isSelected && s.dayCellTextSelected,
            ]}
          >
            {date.day}
          </Text>
        </View>
        <View style={s.dayDotsRow}>
          {dots.slice(0, 2).map(dot => (
            <View
              key={dot.key ?? dot.color}
              style={[
                s.dayDot,
                { backgroundColor: isSelected ? (dot.selectedDotColor ?? '#fff') : dot.color },
              ]}
            />
          ))}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        {/* Page Header */}
        <View style={s.pageHeader}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={s.pageTitle}>{t('calTitle')}</Text>
              <Text style={s.pageSub}>{monthLabel.toUpperCase()}</Text>
            </View>
            <TouchableOpacity style={[s.importBtn, { backgroundColor: colors.primary }]} onPress={() => setEditMenuOpen(true)}>
              <MaterialIcons name="edit-calendar" size={20} color="#fff" />
              <Text style={s.importBtnText}>{t('calEditBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.viewModeRow}>
          {(['week', 'calendar'] as const).map(mode => {
            const active = viewMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[s.viewModeBtn, active && { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
                onPress={() => setViewMode(mode)}
              >
                <MaterialIcons
                  name={mode === 'calendar' ? 'calendar-month' : 'view-week'}
                  size={16}
                  color={active ? '#fff' : colors.textSub}
                />
                <Text style={[s.viewModeText, { color: active ? '#fff' : colors.textSub }]}>
                  {mode === 'calendar' ? t('calModeCalendar') : t('calModeWeek')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {viewMode === 'calendar' && (
              <>
            <View style={s.mainCard}>
              <View style={s.selectedDayHeader}>
                <Text style={s.selectedDayLabel}>{fmtDate(selectedDay)}</Text>
              </View>
              {stats && (
                <View style={s.weatherBadge}>
                  <MaterialCommunityIcons
                    name={stats.weatherIconName as keyof typeof MaterialCommunityIcons.glyphMap}
                    size={18}
                    color={colors.primaryDark}
                    style={s.weatherIcon}
                  />
                  <View>
                    <Text style={s.weatherPlace}>{t('calWeatherLocal')}</Text>
                    <Text style={s.weatherText}>{stats.weatherText}</Text>
                  </View>
                </View>
              )}

              {workEvent ? (
                <>
                  <View style={s.shiftTypeRow}>
                    <View style={s.shiftIconBox}>
                      <MaterialIcons name="flight" size={20} color={colors.primary} />
                    </View>
                    <Text style={s.shiftTypeName}>{t('calShiftWork')}</Text>
                  </View>
                  <View style={s.timeRow}>
                    <MaterialIcons name="schedule" size={18} color={colors.textSub} style={{ marginRight: 6 }} />
                    <Text style={s.timeText}>
                      {new Date(workEvent.startDate).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} — {new Date(workEvent.endDate).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  {stats?.flightCount > 0 && (
                    <View style={s.flightBadge}>
                      <View style={s.flightBadgeRow}>
                        <MaterialIcons name="flight-takeoff" size={14} color={colors.primary} />
                        <Text style={s.flightBadgeText}>{stats.flightCount} voli nel turno</Text>
                      </View>
                    </View>
                  )}
                </>
              ) : restEvent ? (
                <View style={s.restRow}>
                  <View style={s.restIconBox}>
                    <MaterialIcons name="hotel" size={22} color="#10b981" />
                  </View>
                  <Text style={s.restText}>{t('calRestDay')}</Text>
                </View>
              ) : (
                <Text style={s.emptyText}>{t('calNoShift')}{'\n'}{selectedDay.split('-').reverse().join('/')}</Text>
              )}
            </View>

            <View style={s.calendarCard}>
              <RNCalendar
                current={toLocalIso(visibleMonth)}
                markedDates={markedDates}
                markingType="multi-dot"
                dayComponent={renderCalendarDay}
                onDayPress={handleDayPress}
                onMonthChange={handleMonthChange}
                enableSwipeMonths={false}
                firstDay={1}
                renderArrow={direction => (
                  <MaterialIcons
                    name={direction === 'left' ? 'chevron-left' : 'chevron-right'}
                    size={22}
                    color={colors.primary}
                  />
                )}
                theme={{
                  calendarBackground: 'transparent',
                  monthTextColor: colors.primaryDark,
                  dayTextColor: colors.text,
                  textDisabledColor: colors.textMuted,
                  todayTextColor: colors.primary,
                  selectedDayTextColor: '#fff',
                  arrowColor: colors.primary,
                  textSectionTitleColor: colors.textSub,
                  textMonthFontSize: 18,
                  textMonthFontWeight: '800',
                  textDayHeaderFontSize: 12,
                  textDayHeaderFontWeight: '700',
                  textDayFontSize: 15,
                }}
                style={s.monthCalendar}
                headerStyle={s.monthCalendarHeader}
              />
              <View style={s.calendarLegend}>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: colors.primary }]} />
                  <Text style={s.legendText}>{t('calTypeWork')}</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: '#10b981' }]} />
                  <Text style={s.legendText}>{t('calTypeRest')}</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={s.legendTodayRing}>
                    <View style={s.legendTodayCenter} />
                  </View>
                  <Text style={s.legendText}>{t('calToday')}</Text>
                </View>
              </View>
              <View style={s.calendarSummary}>
                <Text style={s.calendarSummaryLabel}>{t('calMonthTotalHours')}</Text>
                <Text style={s.calendarSummaryValue}>{monthHoursSummary.totalHours.toFixed(1)} h</Text>
                <Text style={s.calendarSummaryMeta}>
                  {t('calMonthShiftsCount').replace('{count}', String(monthHoursSummary.shiftsCount))}
                </Text>
              </View>
            </View>
              </>
            )}

            {viewMode === 'week' && (
              <View style={s.weekCard}>
                <View style={s.weekHeader}>
                  <View>
                    <Text style={s.weekTitle}>{t('calModeWeek')}</Text>
                    <Text style={s.weekRange}>{weekRangeLabel}</Text>
                  </View>
                  <View style={s.weekTotalPill}>
                    <Text style={s.weekTotalValue}>{weekHoursSummary.totalHours.toFixed(1)} h</Text>
                    <Text style={s.weekTotalLabel}>
                      {t('calWeekShiftsCount').replace('{count}', String(weekHoursSummary.shiftsCount))}
                    </Text>
                  </View>
                </View>

                {selectedWeekDays.map(day => {
                  const selected = day.iso === selectedDay;
                  const dayName = weekDaysShort[day.date.getDay()];
                  const dayNumber = String(day.date.getDate()).padStart(2, '0');
                  const monthNumber = String(day.date.getMonth() + 1).padStart(2, '0');
                  return (
                    <TouchableOpacity
                      key={day.iso}
                      style={[s.weekRow, selected && { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}
                      activeOpacity={0.85}
                      onPress={() => handleDayPress({
                        dateString: day.iso,
                        day: day.date.getDate(),
                        month: day.date.getMonth() + 1,
                        year: day.date.getFullYear(),
                        timestamp: day.date.getTime(),
                      })}
                    >
                      <View style={[s.weekDateBox, selected && { backgroundColor: colors.primary }]}>
                        <Text style={[s.weekDayName, selected && { color: '#fff' }]}>{dayName}</Text>
                        <Text style={[s.weekDayNumber, selected && { color: '#fff' }]}>{dayNumber}</Text>
                        <Text style={[s.weekMonthNumber, selected && { color: 'rgba(255,255,255,0.75)' }]}>{monthNumber}</Text>
                      </View>

                      <View style={s.weekShiftBody}>
                        {day.work ? (
                          <>
                            <View style={s.weekShiftTitleRow}>
                              <MaterialIcons name="flight" size={17} color={colors.primary} />
                              <Text style={[s.weekShiftTitle, { color: colors.primaryDark }]}>{t('calShiftWork')}</Text>
                            </View>
                            <Text style={s.weekShiftMeta}>
                              {new Date(day.work.startDate).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                              {' - '}
                              {new Date(day.work.endDate).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                              {'  ·  '}
                              {(day.minutes / 60).toFixed(1)} h
                            </Text>
                            {day.stats?.flightCount > 0 && (
                              <Text style={s.weekFlightMeta}>{day.stats.flightCount} voli nel turno</Text>
                            )}
                          </>
                        ) : day.rest ? (
                          <View style={s.weekRestRow}>
                            <MaterialIcons name="hotel" size={18} color="#10b981" />
                            <Text style={s.weekRestText}>{t('calRestDay')}</Text>
                          </View>
                        ) : (
                          <Text style={s.weekEmptyText}>{t('calNoShift')}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ─── Edit Menu Modal ─── */}
      <Modal visible={editMenuOpen} transparent animationType="fade" onRequestClose={() => setEditMenuOpen(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setEditMenuOpen(false)} />
          <View style={[s.editMenuContent, { backgroundColor: colors.isDark || colors.card === 'transparent' ? '#1E293B' : '#FFFFFF' }]}>
            <Text style={[s.modalTitle, { color: colors.text, marginBottom: 16 }]}>Modifica Turni</Text>
            <TouchableOpacity style={[s.editMenuOption, { backgroundColor: colors.primaryLight }]} onPress={() => { setEditMenuOpen(false); startImport(); }}>
              <MaterialIcons name="picture-as-pdf" size={24} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[s.editMenuLabel, { color: colors.text }]}>{t('calImportPdf')}</Text>
                <Text style={[s.editMenuSub, { color: colors.textSub }]}>{t('calImportPdfSub')}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={colors.textSub} />
            </TouchableOpacity>
            <TouchableOpacity style={[s.editMenuOption, { backgroundColor: colors.primaryLight }]} onPress={openManualEntry}>
              <MaterialIcons name="edit" size={24} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[s.editMenuLabel, { color: colors.text }]}>{t('calAddManual')}</Text>
                <Text style={[s.editMenuSub, { color: colors.textSub }]}>{t('calAddManualSub')}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={colors.textSub} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Manual Entry Modal ─── */}
      <Modal visible={manualModalOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setManualModalOpen(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setManualModalOpen(false)} />
          <View style={s.modalScrollContent}>
            <View style={[s.manualModalContent, { backgroundColor: colors.isDark || colors.card === 'transparent' ? '#1E293B' : '#FFFFFF' }]}>
            {/* Header fisso */}
            <View style={[s.modalHeader, { paddingHorizontal: 24, paddingTop: 24 }]}>
              <Text style={[s.modalTitle, { color: colors.text }]}>{t('calAddShiftTitle')}</Text>
              <TouchableOpacity onPress={() => setManualModalOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={t('close')} accessible>
                <MaterialIcons name="close" size={24} color={colors.textSub} />
              </TouchableOpacity>
            </View>

            {/* Contenuto scrollabile */}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
              >
              {/* Data */}
              <Text style={[s.manualLabel, { color: colors.textSub }]}>{t('calDataLabel')}</Text>
              <TextInput
                style={[s.manualInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                value={manualDate.split('-').reverse().join('/')}
                editable={false}
              />
              <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 12 }}>
                Seleziona un giorno dal calendario per cambiare la data
              </Text>

              {/* Tipo */}
              <Text style={[s.manualLabel, { color: colors.textSub }]}>{t('calTypeLabel')}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                {(['Lavoro', 'Riposo'] as const).map(shiftType => (
                  <TouchableOpacity
                    key={shiftType}
                    style={[s.manualTypeBtn, { borderColor: colors.border }, manualType === shiftType && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => setManualType(shiftType)}
                  >
                    <View style={s.manualTypeInner}>
                      <MaterialIcons
                        name={shiftType === 'Lavoro' ? 'flight' : 'hotel'}
                        size={16}
                        color={manualType === shiftType ? '#fff' : colors.textSub}
                      />
                      <Text style={{ color: manualType === shiftType ? '#fff' : colors.text, fontWeight: '700' }}>
                        {shiftType === 'Lavoro' ? t('calTypeWork') : t('calTypeRest')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Orari (solo lavoro) */}
              {manualType === 'Lavoro' && (
                <>
                  <Text style={[s.manualLabel, { color: colors.textSub }]}>{t('calStartTime')}</Text>
                  <TimeCarouselPicker
                    key={pickerKey * 2}
                    hour={manualStartH}
                    minute={manualStartM}
                    onHourChange={setManualStartH}
                    onMinuteChange={setManualStartM}
                    accentColor={colors.primary}
                    textColor={colors.text}
                    mutedColor={colors.textMuted}
                    bgColor={colors.card === 'transparent' ? (colors.isDark ? '#1E293B' : '#F3F4F6') : colors.card}
                    borderColor={colors.border}
                  />
                  <Text style={[s.manualLabel, { color: colors.textSub, marginTop: 16 }]}>{t('calEndTime')}</Text>
                  <TimeCarouselPicker
                    key={pickerKey * 2 + 1}
                    hour={manualEndH}
                    minute={manualEndM}
                    onHourChange={setManualEndH}
                    onMinuteChange={setManualEndM}
                    accentColor={colors.primary}
                    textColor={colors.text}
                    mutedColor={colors.textMuted}
                    bgColor={colors.card === 'transparent' ? (colors.isDark ? '#1E293B' : '#F3F4F6') : colors.card}
                    borderColor={colors.border}
                  />
                </>
              )}

              <TouchableOpacity style={[s.primaryBtn, { backgroundColor: colors.primary, marginTop: 24 }]} onPress={saveManualShift}>
                <Text style={s.primaryBtnText}>{t('calSaveShift')}</Text>
              </TouchableOpacity>
            </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      {/* Hidden WebView for PDF extraction */}
      {pdfHtml && (
        <WebView
          originWhitelist={['*']}
          source={{ html: pdfHtml }}
          onMessage={onWebViewMessage}
          style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }}
          javaScriptEnabled
        />
      )}

      {/* ─── Import Modal ─── */}
      <Modal visible={importModalVisible} transparent animationType="slide" onRequestClose={() => {
        if (importStep !== 'saving') { setImportModalVisible(false); setImportStep('idle'); setImportFileCount(0); }
      }}>
        <View style={s.modalOverlay}>
          <View style={s.modalBg} />
          <View style={[s.modalContent, { backgroundColor: colors.isDark || colors.card === 'transparent' ? '#1E293B' : '#FFFFFF' }]}>
            {/* Header */}
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: colors.text }]}>{t('calImportTitle')}</Text>
              {importStep !== 'saving' && (
                <TouchableOpacity onPress={() => { setImportModalVisible(false); setImportStep('idle'); setImportFileCount(0); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={t('close')} accessible>
                  <MaterialIcons name="close" size={24} color={colors.textSub} />
                </TouchableOpacity>
              )}
            </View>

            {/* Step: Extracting */}
            {importStep === 'extracting' && (
              <View style={s.centerBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[s.stepText, { color: colors.textSub }]}>
                  {importFileCount > 1 ? `${t('calExtracting')} (${importFileCount} PDF)` : t('calExtracting')}
                </Text>
              </View>
            )}

            {/* Step: Pick name */}
            {importStep === 'pickName' && parsedSchedule && (
              <>
                <Text style={[s.stepLabel, { color: colors.textSub }]}>
                  {t('calPickName')} ({parsedSchedule.employees.length} trovati)
                </Text>
                <FlatList
                  data={parsedSchedule.employees}
                  keyExtractor={(_, i) => String(i)}
                  style={{ maxHeight: 400 }}
                  nestedScrollEnabled
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[s.nameRow, { borderColor: colors.border }]}
                      onPress={() => selectEmployee(item)}
                    >
                      <Text style={[s.nameText, { color: colors.text }]}>{item.name}</Text>
                      <MaterialIcons name="chevron-right" size={20} color={colors.textSub} />
                    </TouchableOpacity>
                  )}
                />
              </>
            )}

            {/* Step: Preview */}
            {importStep === 'preview' && selectedEmployee && (
              <>
                <Text style={[s.stepLabel, { color: colors.textSub }]}>
                  {t('calShiftsOf')} {selectedEmployee.name}
                </Text>
                <ScrollView style={{ maxHeight: 350 }}>
                  {selectedEmployee.shifts.map((shift, i) => (
                    <View key={i} style={[s.previewRow, { borderColor: colors.border }]}>
                      <Text style={[s.previewDate, { color: colors.text }]}>{fmtDate(shift.date)}</Text>
                      {shift.type === 'work' ? (
                        <View style={[s.previewPill, { backgroundColor: colors.primaryLight }]}>
                          <Text style={[s.previewPillText, { color: colors.primary }]}>
                            {shift.start} - {shift.end}
                          </Text>
                        </View>
                      ) : (
                        <View style={[s.previewPill, { backgroundColor: '#D1FAE5' }]}>
                          <Text style={[s.previewPillText, { color: '#059669' }]}>{t('calRestPill')}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                  <TouchableOpacity
                    style={[s.secondaryBtn, { borderColor: colors.border }]}
                    onPress={() => setImportStep('pickName')}
                  >
                    <Text style={[s.secondaryBtnText, { color: colors.textSub }]}>{t('calChangeName')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.primaryBtn, { backgroundColor: colors.primary }]}
                    onPress={confirmImport}
                  >
                    <Text style={s.primaryBtnText}>{t('calSaveToCalendar')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Step: Saving */}
            {importStep === 'saving' && (
              <View style={s.centerBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[s.stepText, { color: colors.textSub }]}>{t('calSaving')}</Text>
              </View>
            )}

            {/* Step: Done */}
            {importStep === 'done' && (
              <View style={s.centerBox}>
                <MaterialIcons name="check-circle" size={48} color="#10b981" />
                <Text style={[s.stepText, { color: '#10b981' }]}>{t('calImportDone')}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    pageHeader: { backgroundColor: c.card, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    pageTitle: { fontSize: 22, fontWeight: 'bold', color: c.primaryDark },
    pageSub: { fontSize: 11, color: c.textSub, letterSpacing: 1.5, marginTop: 3 },
    importBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
    importBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    viewModeRow: {
      flexDirection: 'row',
      gap: 8,
      marginHorizontal: 16,
      marginTop: 14,
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 6,
      borderWidth: c.isDark ? 1 : 0,
      borderColor: c.glassBorder,
    },
    viewModeBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 12,
      paddingVertical: 10,
    },
    viewModeText: { fontSize: 13, fontWeight: '800' },
    calendarCard: {
      backgroundColor: c.card,
      borderRadius: 20,
      marginHorizontal: 16,
      marginTop: 16,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 14,
      shadowColor: c.primary,
      shadowOpacity: c.isDark ? 0 : 0.08,
      shadowRadius: 10,
      elevation: c.isDark ? 0 : 4,
      borderWidth: c.isDark ? 1 : 0,
      borderColor: c.glassBorder,
    },
    monthCalendar: { borderRadius: 16 },
    monthCalendarHeader: { paddingBottom: 8, marginBottom: 6 },
    dayCellWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
    dayCellInner: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
    dayCellInnerSelected: { backgroundColor: c.primary },
    dayCellInnerToday: { borderColor: c.primary, backgroundColor: c.primaryLight },
    dayCellInnerTodaySelected: { borderColor: c.primaryDark },
    dayCellText: { color: c.text, fontSize: 15, fontWeight: '600' },
    dayCellTextInactive: { color: c.textMuted },
    dayCellTextToday: { color: c.primaryDark, fontWeight: '800' },
    dayCellTextSelected: { color: '#fff' },
    dayDotsRow: { minHeight: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 3 },
    dayDot: { width: 5, height: 5, borderRadius: 2.5, marginHorizontal: 1.5 },
    calendarLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingHorizontal: 6, paddingTop: 8 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendTodayRing: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: c.primary, alignItems: 'center', justifyContent: 'center' },
    legendTodayCenter: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.primary },
    legendText: { color: c.textSub, fontSize: 12, fontWeight: '600' },
    calendarSummary: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.border },
    calendarSummaryLabel: { color: c.textSub, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
    calendarSummaryValue: { color: c.primary, fontSize: 28, fontWeight: '800', marginTop: 6 },
    calendarSummaryMeta: { color: c.textSub, fontSize: 13, fontWeight: '600', marginTop: 4 },
    weekCard: {
      backgroundColor: c.card,
      borderRadius: 20,
      marginHorizontal: 16,
      marginTop: 16,
      padding: 16,
      shadowColor: c.primary,
      shadowOpacity: c.isDark ? 0 : 0.08,
      shadowRadius: 10,
      elevation: c.isDark ? 0 : 4,
      borderWidth: c.isDark ? 1 : 0,
      borderColor: c.glassBorder,
    },
    weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 },
    weekTitle: { color: c.primaryDark, fontSize: 20, fontWeight: '900' },
    weekRange: { color: c.textSub, fontSize: 12, fontWeight: '700', marginTop: 3, textTransform: 'uppercase' },
    weekTotalPill: { backgroundColor: c.primaryLight, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'flex-end' },
    weekTotalValue: { color: c.primary, fontSize: 18, fontWeight: '900' },
    weekTotalLabel: { color: c.primaryDark, fontSize: 10, fontWeight: '800', marginTop: 1 },
    weekRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      padding: 10,
      marginTop: 9,
      backgroundColor: c.bg,
    },
    weekDateBox: {
      width: 54,
      borderRadius: 14,
      backgroundColor: c.card,
      alignItems: 'center',
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    weekDayName: { color: c.textSub, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
    weekDayNumber: { color: c.text, fontSize: 22, fontWeight: '900', lineHeight: 26 },
    weekMonthNumber: { color: c.textMuted, fontSize: 10, fontWeight: '800' },
    weekShiftBody: { flex: 1, minHeight: 58, justifyContent: 'center' },
    weekShiftTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    weekShiftTitle: { fontSize: 16, fontWeight: '900' },
    weekShiftMeta: { color: c.text, fontSize: 15, fontWeight: '800', marginTop: 5 },
    weekFlightMeta: { color: c.textSub, fontSize: 12, fontWeight: '700', marginTop: 3 },
    weekRestRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    weekRestText: { color: '#10b981', fontSize: 16, fontWeight: '900' },
    weekEmptyText: { color: c.textSub, fontSize: 14, fontWeight: '700' },
    mainCard: {
      backgroundColor: c.card, borderRadius: 14,
      marginHorizontal: 16, marginTop: 16,
      padding: 20,
      shadowColor: c.primary, shadowOpacity: c.isDark ? 0 : 0.08, shadowRadius: 10, elevation: c.isDark ? 0 : 4, borderWidth: c.isDark ? 1 : 0, borderColor: c.glassBorder,
      minHeight: 160,
    },
    selectedDayHeader: { marginBottom: 12, paddingRight: 90 },
    selectedDayLabel: { color: c.textSub, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
    weatherBadge: {
      position: 'absolute', top: 14, right: 14,
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.bg, borderRadius: 10,
      paddingHorizontal: 10, paddingVertical: 6, gap: 6,
    },
    weatherIcon: { marginRight: 2 },
    weatherPlace: { fontSize: 10, color: c.textSub, fontWeight: '600' },
    weatherText: { fontSize: 12, color: c.text, fontWeight: '600' },
    shiftTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, marginTop: 6 },
    shiftIconBox: { width: 44, height: 44, backgroundColor: c.primaryLight, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    shiftTypeName: { fontSize: 19, fontWeight: 'bold', color: c.primaryDark },
    timeRow: { flexDirection: 'row', alignItems: 'center' },
    timeText: { fontSize: 22, fontWeight: 'bold', color: c.primary },
    flightBadge: { marginTop: 14, backgroundColor: c.primaryLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start' },
    flightBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    flightBadgeText: { color: c.primary, fontWeight: '700', fontSize: 13 },
    restRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
    restIconBox: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#10b98122', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    restText: { fontSize: 20, fontWeight: 'bold', color: '#10b981' },
    emptyText: { textAlign: 'center', color: c.textSub, fontSize: 15, marginTop: 20, lineHeight: 24 },
    // Modal
    modalOverlay: { flex: 1, justifyContent: 'flex-end' },
    modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
    modalScrollContent: { flex: 1, justifyContent: 'flex-end' },
    modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 100, maxHeight: '92%' },
    manualModalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 0, maxHeight: '92%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    modalTitle: { fontSize: 20, fontWeight: 'bold' },
    centerBox: { alignItems: 'center', paddingVertical: 40, gap: 12 },
    stepText: { fontSize: 16, fontWeight: '600' },
    stepLabel: { fontSize: 14, marginBottom: 12 },
    nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderRadius: 8, marginBottom: 4 },
    nameText: { fontSize: 15, fontWeight: '500' },
    previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1 },
    previewDate: { fontSize: 14, fontWeight: '600' },
    previewPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
    previewPillText: { fontSize: 13, fontWeight: '700' },
    secondaryBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
    secondaryBtnText: { fontSize: 14, fontWeight: '600' },
    primaryBtn: { flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
    primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
    // Edit menu
    editMenuContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
    editMenuOption: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14, marginBottom: 10 },
    editMenuLabel: { fontSize: 15, fontWeight: '600' },
    editMenuSub: { fontSize: 12, marginTop: 2 },
    // Manual entry
    manualLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
    manualInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 4 },
    manualTimeRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    manualTimeInput: { flex: 1, textAlign: 'center' },
    manualTypeBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
    manualTypeInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  });
}

