import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions, LayoutAnimation, Platform, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { TYPE } from '../theme/typography';
import { useAirport } from '../context/AirportContext';
import { getAirlineOps, getAirlineColor } from '../utils/airlineOps';
import { fetchAirportScheduleRaw } from '../utils/fr24api';
import { filterFlightsByAirlines, getFlightAirportLabel } from '../utils/flightScheduleAdapter';
import { enableLegacyAndroidLayoutAnimation } from '../utils/layoutAnimation';
import { useReducedMotionPreference } from '../utils/motion';
import { useLanguage } from '../context/LanguageContext';
import { SPACING, RADIUS } from '../theme/spacing';

enableLegacyAndroidLayoutAnimation();

const CI_COLOR = '#F59E0B';
const GATE_COLOR = '#3B82F6';

type Props = {
  visible: boolean;
  onClose: () => void;
  shiftStart: Date;
  shiftEnd: Date;
  inline?: boolean;
  active?: boolean;
  refreshKey?: number;
};

type Flight = {
  id: string;
  flightNumber: string;
  airlineName: string;
  destination: string;
  scheduledDepartureTs: number;
  departureTs: number;
  status: string;
  statusColor: string;
  ops: { checkInOpen: number; checkInClose: number; gateOpen: number; gateClose: number };
};

function parseFlight(item: any): Flight | null {
  const f = item.flight;
  if (!f) return null;
  const scheduledDepartureTs = f.time?.scheduled?.departure;
  if (!scheduledDepartureTs) return null;
  const departureTs = f.time?.real?.departure ?? f.time?.estimated?.departure ?? scheduledDepartureTs;
  const airlineName = f.airline?.name || '—';
  return {
    id: f.identification?.id || `${scheduledDepartureTs}`,
    flightNumber: f.identification?.number?.default || 'N/A',
    airlineName,
    destination: getFlightAirportLabel(f.airport?.destination, 'N/A'),
    scheduledDepartureTs,
    departureTs,
    status: f.status?.text || 'Scheduled',
    statusColor: f.status?.generic?.status?.color || 'gray',
    ops: getAirlineOps(airlineName),
  };
}

export default function ShiftTimeline({ visible, onClose, shiftStart, shiftEnd, inline, active = true, refreshKey }: Props) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const { airportCode, isLoading: airportLoading } = useAirport();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(Date.now() / 1000);
  const [rulerWidth, setRulerWidth] = useState(0);
  const lastRefreshKey = useRef(refreshKey);
  const flightRequestVersion = useRef(0);
  const { fontScale } = useWindowDimensions();

  const startSec = shiftStart.getTime() / 1000;
  const endSec = shiftEnd.getTime() / 1000;
  const totalSec = Math.max(1, endSec - startSec); // Evita divisione per zero
  const SCREEN_H = Dimensions.get('window').height;

  const fetchFlights = useCallback(async (reuseRecent = false) => {
    if (airportLoading) return;
    const version = ++flightRequestVersion.current;
    const isCurrent = () => flightRequestVersion.current === version;
    setLoading(true);
    setError(false);
    try {
      const filterRaw = await AsyncStorage.getItem('aerostaff_flight_filter_v1');
      if (!isCurrent()) return;
      const selectedAirlines: string[] = filterRaw ? JSON.parse(filterRaw) : [];
      const publish = (departures: any[]) => {
        if (!isCurrent()) return;
        const filtered = filterFlightsByAirlines(departures, selectedAirlines)
          .map(parseFlight)
          .filter((f): f is Flight => {
            if (!f || f.scheduledDepartureTs < startSec || f.scheduledDepartureTs > endSec) return false;
            return true;
          })
          .sort((a, b) => a.scheduledDepartureTs - b.scheduledDepartureTs);
        setFlights(filtered);
        setLoading(false);
      };
      const schedule = await fetchAirportScheduleRaw(airportCode, {
        maxAgeMs: reuseRecent ? 30_000 : 0,
        onProgress: partial => publish(partial.departures),
      });
      publish(schedule.departures);
    } catch {
      if (isCurrent()) setError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [airportCode, airportLoading, startSec, endSec, refreshKey]);

  // Inline: carica subito; Modal: carica quando visibile
  useEffect(() => {
    if (airportLoading) return;
    if ((inline && active) || visible) {
      const reuseRecent = lastRefreshKey.current === refreshKey;
      lastRefreshKey.current = refreshKey;
      fetchFlights(reuseRecent);
      setExpandedId(null);
      setNowSec(Date.now() / 1000);
      const interval = setInterval(() => setNowSec(Date.now() / 1000), 60000);
      return () => { flightRequestVersion.current += 1; clearInterval(interval); };
    }
  }, [inline, active, visible, airportLoading, fetchFlights]);

  const reducedMotion = useReducedMotionPreference();
  const toggleExpand = (id: string) => {
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId(prev => (prev === id ? null : id));
  };

  // Posizione orizzontale: percentuale nel turno
  const xPercent = (ts: number) => Math.max(0, Math.min(100, ((ts - startSec) / totalSec) * 100));

  // Tacche orarie ogni 30 min per il righello
  const ticks = useMemo(() => {
    const result: { label: string; pct: number }[] = [];
    const first = new Date(shiftStart);
    first.setMinutes(Math.ceil(first.getMinutes() / 30) * 30, 0, 0);
    let t = first.getTime() / 1000;
    while (t <= endSec) {
      if (t >= startSec) {
        result.push({
          label: new Date(t * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
          pct: xPercent(t),
        });
      }
      t += 30 * 60;
    }
    return result;
  }, [startSec, endSec]);

  const labelStride = Math.max(1, Math.ceil((ticks.length - 1) / Math.max(1, Math.floor(rulerWidth / (40 * fontScale)))));

  const showNowLine = nowSec >= startSec && nowSec <= endSec;
  const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  const s = useMemo(() => makeStyles(colors), [colors]);

  const timelineContent = (
    <>
      {/* Header */}
      {!inline && (
        <>
          <View style={s.handleRow}>
            <View style={[s.handle, { backgroundColor: colors.border }]} />
          </View>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={[s.title, { color: colors.primaryDark }]}>Voli nel Turno</Text>
              <Text style={[s.subtitle, { color: colors.textSub }]}>{fmtTime(startSec)} – {fmtTime(endSec)}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel={t('a11yClose')}>
              <MaterialIcons name="close" size={22} color={colors.textSub} />
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Legenda */}
      <View style={[s.legend, inline && { paddingHorizontal: 0, paddingBottom: SPACING.sm }]}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: CI_COLOR }]} />
          <Text style={[s.legendText, { color: colors.textSub }]}>Check-in</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: GATE_COLOR }]} />
          <Text style={[s.legendText, { color: colors.textSub }]}>Gate</Text>
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={[s.center, inline && { minHeight: 80 }]}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={[s.center, inline && { minHeight: 80 }]}>
          <Text style={{ color: colors.textSub, fontSize: 14, marginBottom: SPACING.md }}>Errore nel caricamento</Text>
          <TouchableOpacity onPress={() => fetchFlights()} style={[s.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Riprova</Text>
          </TouchableOpacity>
        </View>
      ) : flights.length === 0 ? (
        <View style={[s.center, inline && { minHeight: 80 }]}>
          <MaterialIcons name="flight-takeoff" size={30} color={colors.textMuted} style={{ marginBottom: SPACING.sm }} />
          <Text style={{ color: colors.textSub, fontSize: 14 }}>Nessuna partenza nel turno</Text>
        </View>
      ) : (
        <ScrollView style={inline ? undefined : s.scrollArea} scrollEnabled={!inline} showsVerticalScrollIndicator={false}>
          {/* Righello orizzontale del tempo */}
          <View style={s.rulerWrap}>
            <View style={s.rulerLabelSpace} />
            <View style={s.ruler} onLayout={event => setRulerWidth(event.nativeEvent.layout.width)}>
              {ticks.map((tick, i) => (
                <View key={i} style={[s.rulerTick, { left: `${tick.pct}%` }]}>
                  <View style={[s.rulerTickMark, { backgroundColor: colors.border }]} />
                  {(i === 0 || i === ticks.length - 1 || (i % labelStride === 0 && i <= ticks.length - 1 - labelStride)) && (
                    <Text style={[
                      s.rulerTickLabel,
                      { color: colors.textSub, width: 36 * fontScale, left: -18 * fontScale },
                      i === 0 && { left: 0, textAlign: 'left' },
                      i === ticks.length - 1 && { left: -36 * fontScale, textAlign: 'right' },
                    ]}>{tick.label}</Text>
                  )}
                </View>
              ))}
              {/* Linea NOW */}
              {showNowLine && (
                <View style={[s.nowMarker, { left: `${xPercent(nowSec)}%` }]}>
                  <Text style={s.nowLabel}>ORA</Text>
                  <View style={s.nowTick} />
                </View>
              )}
            </View>
          </View>

          {/* Righe voli — Gantt chart */}
          {flights.map(flight => {
            const ciOpenTs = flight.scheduledDepartureTs - flight.ops.checkInOpen * 60;
            const ciCloseTs = flight.scheduledDepartureTs - flight.ops.checkInClose * 60;
            const gateOpenTs = flight.scheduledDepartureTs - flight.ops.gateOpen * 60;
            const gateCloseTs = flight.scheduledDepartureTs - flight.ops.gateClose * 60;

            const ciLeft = xPercent(ciOpenTs);
            const ciWidth = xPercent(ciCloseTs) - ciLeft;
            const gateLeft = xPercent(gateOpenTs);
            const gateWidth = xPercent(gateCloseTs) - gateLeft;
            const depLeft = xPercent(flight.departureTs);

            const expanded = expandedId === flight.id;
            const airlineColor = getAirlineColor(flight.airlineName);

            return (
              <View key={flight.id}>
                <TouchableOpacity onPress={() => toggleExpand(flight.id)} activeOpacity={0.7} style={[s.flightRow, { borderBottomColor: colors.border }]}>
                  {/* Label a sinistra */}
                  <View style={s.flightLabelWrap}>
                    <View style={[s.airlineDot, { backgroundColor: airlineColor }]} />
                    <Text style={[s.flightLabel, { color: colors.text }]} numberOfLines={1}>
                      {flight.flightNumber}
                    </Text>
                    <Text style={[s.flightDest, { color: colors.textMuted }]} numberOfLines={1}>
                      {flight.destination}
                    </Text>
                  </View>

                  {/* Area barre Gantt */}
                  <View style={s.ganttArea}>
                    {/* Linee guida verticali (ticks) */}
                    {ticks.map((tick, i) => (
                      <View key={i} style={[s.ganttGridLine, { left: `${tick.pct}%`, backgroundColor: colors.border }]} />
                    ))}
                    {/* Now line verticale */}
                    {showNowLine && (
                      <View style={[s.ganttNowLine, { left: `${xPercent(nowSec)}%` }]} />
                    )}
                    {/* Barra CI */}
                    <View style={[s.ganttBar, s.ganttBarCI, { left: `${ciLeft}%`, width: `${Math.max(ciWidth, 1)}%` }]}>
                      <Text style={s.ganttBarText} numberOfLines={1}>CI</Text>
                    </View>
                    {/* Barra Gate */}
                    <View style={[s.ganttBar, s.ganttBarGate, { left: `${gateLeft}%`, width: `${Math.max(gateWidth, 1)}%` }]}>
                      <Text style={s.ganttBarText} numberOfLines={1}>Gate</Text>
                    </View>
                    {/* Marcatore partenza */}
                    <View style={[s.depMarker, { left: `${depLeft}%`, borderLeftColor: airlineColor }]} />
                  </View>
                </TouchableOpacity>

                {/* Card espansa */}
                {expanded && (
                  <View style={[s.expandedCard, { backgroundColor: colors.isDark ? 'rgba(255,255,255,0.08)' : colors.cardSecondary, borderColor: colors.border }]}>
                    <Text style={[s.expandedTitle, { color: airlineColor }]}>{flight.airlineName}</Text>
                    <View style={s.expandedRow}>
                      <Text style={[s.expandedLabel, { color: colors.textMuted }]}>Partenza</Text>
                      <Text style={[s.expandedValue, { color: colors.text }]}>{fmtTime(flight.departureTs)}</Text>
                    </View>
                    <View style={s.expandedRow}>
                      <Text style={[s.expandedLabel, { color: colors.textMuted }]}>CI Open / Close</Text>
                      <Text style={[s.expandedValue, { color: CI_COLOR }]}>{fmtTime(ciOpenTs)} – {fmtTime(ciCloseTs)}</Text>
                    </View>
                    <View style={s.expandedRow}>
                      <Text style={[s.expandedLabel, { color: colors.textMuted }]}>Gate Open / Close</Text>
                      <Text style={[s.expandedValue, { color: GATE_COLOR }]}>{fmtTime(gateOpenTs)} – {fmtTime(gateCloseTs)}</Text>
                    </View>
                    <View style={s.expandedRow}>
                      <Text style={[s.expandedLabel, { color: colors.textMuted }]}>Stato</Text>
                      <Text style={[s.expandedValue, { color: flight.statusColor === 'green' ? '#22C55E' : flight.statusColor === 'red' ? '#EF4444' : colors.text }]}>
                        {flight.status}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
          <View style={{ height: inline ? 8 : 24 }} />
        </ScrollView>
      )}
    </>
  );

  if (inline) {
    return <View>{timelineContent}</View>;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { height: SCREEN_H * 0.8, backgroundColor: colors.isDark ? colors.bg : colors.card }]}>
          {timelineContent}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    },
    handleRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
    handle: { width: 36, height: 4, borderRadius: 2 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.xl, paddingBottom: 10 },
    title: { ...TYPE.headline },
    subtitle: { fontSize: 12, marginTop: 2 },
    closeBtn: { padding: SPACING.sm, borderRadius: RADIUS.xl },
    legend: { flexDirection: 'row', gap: SPACING.lg, paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontSize: 11, fontWeight: '600' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    retryBtn: { paddingHorizontal: SPACING.xl, paddingVertical: 10, borderRadius: 10 },
    scrollArea: { flex: 1 },

    // Righello orizzontale in alto
    rulerWrap: { flexDirection: 'row', paddingHorizontal: SPACING.md, marginBottom: SPACING.xs, height: 32 },
    rulerLabelSpace: { width: 80 },
    ruler: { flex: 1, position: 'relative' },
    rulerTick: { position: 'absolute', top: 0, alignItems: 'center', transform: [{ translateX: -1 }] },
    rulerTickMark: { width: 1, height: 10 },
    rulerTickLabel: { position: 'absolute', top: 12, left: -18, width: 36, fontSize: 10, fontWeight: '700', textAlign: 'center' },
    nowMarker: { position: 'absolute', top: 0, alignItems: 'center', zIndex: 10, transform: [{ translateX: -1 }] },
    nowLabel: { fontSize: 7, fontWeight: '900', color: '#EF4444' },
    nowTick: { width: 2, height: 10, backgroundColor: '#EF4444', borderRadius: 1 },

    // Righe voli
    flightRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1 },
    flightLabelWrap: { width: 80, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
    airlineDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
    flightLabel: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
    flightDest: { fontSize: 10, fontWeight: '600' },

    // Area Gantt
    ganttArea: { flex: 1, height: 36, position: 'relative', justifyContent: 'center' },
    ganttGridLine: { position: 'absolute', top: 0, bottom: 0, width: 1, opacity: 0.25 },
    ganttNowLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#EF4444', opacity: 0.5, zIndex: 5 },
    ganttBar: { position: 'absolute', height: 14, borderRadius: 3, justifyContent: 'center', paddingHorizontal: SPACING.xs },
    ganttBarCI: { backgroundColor: CI_COLOR, top: 2 },
    ganttBarGate: { backgroundColor: GATE_COLOR, bottom: 2 },
    ganttBarText: { fontSize: 8, fontWeight: '800', color: '#fff' },
    depMarker: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 2, borderStyle: 'dashed' },

    // Card espansa
    expandedCard: { borderRadius: 10, padding: SPACING.md, marginHorizontal: SPACING.md, marginBottom: SPACING.xs, borderWidth: 1 },
    expandedTitle: { fontSize: 14, fontWeight: '700', marginBottom: SPACING.sm },
    expandedRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
    expandedLabel: { fontSize: 11, fontWeight: '600' },
    expandedValue: { fontSize: 11, fontWeight: '700' },
  });
}
