import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAppTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { getStoredAirportAirlines } from '../utils/airportSettings';
import { loadFlightScreenCache, type FlightScreenCache } from '../utils/flightScreenCache';
import { filterFlightsByAirlines } from '../utils/flightScheduleAdapter';
import { HANDOVER_STORAGE_KEY, parseHandoverEntries, type HandoverEntry } from '../utils/handover';
import { getHomeCountdownMinutes, getNextHomeActivity, getOpenHomeHandovers, type HomeShiftWindow } from '../utils/homeBriefing';
import { RADIUS, SPACING } from '../theme/spacing';

type Props = {
  airportCode: string;
  isFocused: boolean;
  shift: HomeShiftWindow | null;
  pinnedFlight: any;
  onOpenFlights: () => void;
  onOpenHandover: () => void;
};

export default function HomeBriefing({ airportCode, isFocused, shift, pinnedFlight, onOpenFlights, onOpenHandover }: Props) {
  const { colors } = useAppTheme();
  const { t, locale } = useLanguage();
  const [snapshot, setSnapshot] = useState<{ airportCode: string; cache: FlightScreenCache | null; airlines: string[] } | null>(null);
  const [entries, setEntries] = useState<HandoverEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      setNow(Date.now());
      try {
        const [cache, rawNotes, rawFilter, defaults] = await Promise.all([
          loadFlightScreenCache(airportCode), AsyncStorage.getItem(HANDOVER_STORAGE_KEY),
          AsyncStorage.getItem('aerostaff_flight_filter_v1'), getStoredAirportAirlines(airportCode),
        ]);
        let airlines = defaults;
        try {
          const parsed = rawFilter ? JSON.parse(rawFilter) : null;
          if (Array.isArray(parsed) && parsed.every(value => typeof value === 'string')) airlines = parsed;
        } catch {}
        if (!active) return;
        setSnapshot({ airportCode, cache, airlines });
        setEntries(parseHandoverEntries(rawNotes));
      } catch {
        // Keep the last local snapshot on a transient storage failure.
      } finally { reading = false; }
    };
    refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, 30_000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [airportCode, isFocused]);

  const current = snapshot?.airportCode === airportCode ? snapshot : null;
  const activity = useMemo(() => getNextHomeActivity(
    current?.cache ? filterFlightsByAirlines(current.cache.departures, current.airlines) : [],
    shift, pinnedFlight, now / 1000,
  ), [current, shift?.start, shift?.end, pinnedFlight, now]);
  const date = new Date(now);
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const handovers = getOpenHomeHandovers(entries, dateKey);
  const showActivity = Boolean(shift || pinnedFlight?._pinTab !== 'arrivals' && pinnedFlight);
  const minutes = activity ? getHomeCountdownMinutes(activity.at, now / 1000) : 0;
  const duration = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const countdown = minutes === 0 ? t('homeActivityNow') : t('homeActivityIn').replace('{time}', duration);
  const activityLabels = {
    checkInOpen: t('homeActivityCheckInOpen'), checkInClose: t('homeActivityCheckInClose'),
    gateOpen: t('homeActivityGateOpen'), gateClose: t('homeActivityGateClose'),
  };
  const time = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const s = useMemo(() => StyleSheet.create({
    group: { marginHorizontal: SPACING.lg, marginTop: SPACING.lg, gap: SPACING.md },
    card: { padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.card, gap: 12 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700', flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    activity: { color: colors.text, fontSize: 20, lineHeight: 27, fontWeight: '800' },
    flight: { color: colors.text, fontSize: 14, lineHeight: 21, flexShrink: 1 },
    countdown: { color: colors.primaryText, backgroundColor: colors.primaryLight, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    detail: { color: colors.textSub, fontSize: 12, lineHeight: 18 },
    note: { color: colors.text, fontSize: 14, lineHeight: 21 },
    entry: { borderTopWidth: 1, borderTopColor: colors.glassBorder, paddingTop: 10, gap: 4 },
  }), [colors]);
  return (
    <View style={s.group}>
      {showActivity && <TouchableOpacity style={s.card} onPress={onOpenFlights} activeOpacity={0.8}
        accessibilityRole="button" accessibilityHint={t('homeOpenFlights')}>
        <View style={s.heading}>
          <MaterialIcons name="schedule" size={21} color={colors.primaryText} />
          <Text style={s.title}>{t('homeNextActivity')}</Text>
          <MaterialIcons name="arrow-forward" size={18} color={colors.textSub} />
        </View>
        {activity ? <>
          <Text style={s.activity}>{activityLabels[activity.kind]}</Text>
          <View style={s.row}>
            <Text style={s.countdown}>{countdown} · {time(activity.at)}</Text>
            {activity.isPinned && <MaterialIcons name="push-pin" size={16} color={colors.primaryText} accessibilityLabel={t('homePinned')} />}
          </View>
          <Text style={s.flight}>{activity.flightNumber} · {activity.destination}</Text>
          <Text style={s.detail}>{t('homeActivityPlanned')}{current?.cache ? ` · ${t('homeActivityDataAt').replace('{time}', time(current.cache.fetchedAt / 1000))}` : ''}</Text>
        </> : <Text style={s.detail}>{!current ? t('homeActivityLoading') : !current.cache ? t('homeActivityLoadFlights') : t('homeActivityNone')}</Text>}
      </TouchableOpacity>}
      <TouchableOpacity style={s.card} onPress={onOpenHandover} activeOpacity={0.8}
        accessibilityRole="button" accessibilityHint={t('homeOpenHandover')}>
        <View style={s.heading}>
          <MaterialIcons name="assignment" size={21} color={colors.primaryText} />
          <Text style={s.title}>{t('homeHandoversToday')}{handovers.length ? ` · ${handovers.length}` : ''}</Text>
          <MaterialIcons name="arrow-forward" size={18} color={colors.textSub} />
        </View>
        {handovers.length === 0 ? <Text style={s.detail}>{t('homeHandoversEmpty')}</Text> : handovers.slice(0, 2).map(entry => (
          <View key={entry.id} style={s.entry}>
            <Text style={s.detail}>{entry.scope === 'flight' ? `${entry.flightNumber || '—'} · ${entry.direction === 'arrival' ? t('homeArrival') : t('homeDeparture')}` : t('homeHandoverShift')}</Text>
            <Text style={s.note} numberOfLines={2}>{entry.note.trim() || entry.checklist.filter(value => typeof value === 'string').join(' · ')}</Text>
          </View>
        ))}
        {handovers.length > 2 && <Text style={s.detail}>{t('homeHandoversMore').replace('{count}', String(handovers.length - 2))}</Text>}
      </TouchableOpacity>
    </View>
  );
}
