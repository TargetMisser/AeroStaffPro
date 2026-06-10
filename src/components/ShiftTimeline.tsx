import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions, LayoutAnimation, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useAirport } from '../context/AirportContext';
import { getAirlineOps, getAirlineColor } from '../utils/airlineOps';
import { fetchAirportScheduleRaw } from '../utils/fr24api';
import { filterFlightsByAirlines, getFlightAirportLabel } from '../utils/flightScheduleAdapter';
import { enableLegacyAndroidLayoutAnimation } from '../utils/layoutAnimation';
import { useLanguage } from '../context/LanguageContext';

enableLegacyAndroidLayoutAnimation();

const CI_COLOR = '#F59E0B';
const GATE_COLOR = '#3B82F6';

type Props = {
  visible: boolean;
  onClose: () => void;
  shiftStart: Date;
  shiftEnd: Date;
  inline?: boolean;
  refreshKey?: number;
};

type Flight = {
  id: string;
  flightNumber: string;
  airlineName: string;
  destination: string;
  departureTs: number;
  status: string;
  statusColor: string;
  ops: { checkInOpen: number; checkInClose: number; gateOpen: number; gateClose: number };
};

function parseFlight(item: any): Flight | null {
  const f = item.flight;
  if (!f) return null;
  const ts = f.time?.scheduled?.departure;
  if (!ts) return null;
  const airlineName = f.airline?.name || '—';
  return {
    id: f.identification?.id || `${ts}`,
    flightNumber: f.identification?.number?.default || 'N/A',
    airlineName,
    destination: getFlightAirportLabel(f.airport?.destination, 'N/A'),
    departureTs: ts,
    status: f.status?.text || 'Scheduled',
    statusColor: f.status?.generic?.status?.color || 'gray',
    ops: getAirlineOps(airlineName),
  };
}

export default function ShiftTimeline({ visible, onClose, shiftStart, shiftEnd, inline, refreshKey }: Props) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const { airportCode, isLoading: airportLoading } = useAirport();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(Date.now() / 1000);

  const startSec = shiftStart.getTime() / 1000;
  const endSec = shiftEnd.getTime() / 1000;
  const totalSec = Math.max(1, endSec - startSec); // Evita divisione per zero
  const SCREEN_H = Dimensions.get('window').height;

  const fetchFlights = useCallback(async () => {
    if (airportLoading) return;
    setLoading(true);
    setError(false);
    try {
      const [{ departures }, filterRaw] = await Promise.all([
        fetchAirportScheduleRaw(airportCode),
        AsyncStorage.getItem('aerostaff_flight_filter_v1'),
      ]);
      const selectedAirlines: string[] = filterRaw ? JSON.parse(filterRaw) : [];
      const filtered = filterFlightsByAirlines(departures, selectedAirlines)
        .map(parseFlight)
        .filter((f): f is Flight => {
          if (!f || f.departureTs < startSec || f.departureTs > endSec) return false;
          return true;
        })
        .sort((a, b) => a.departureTs - b.departureTs);
      setFlights(filtered);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [airportCode, airportLoading, startSec, endSec, refreshKey]);

  // Inline: carica subito; Modal: carica quando visibile
  useEffect(() => {
    if (airportLoading) return;
    if (inline || visible) {
      fetchFlights();
      setExpandedId(null);
      setNowSec(Date.now() / 1000);
      const interval = setInterval(() => setNowSec(Date.now() / 1000), 60000);
      return () => clearInterval(interval);
    }
  }, [inline, visible, airportLoading, fetchFlights]);

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
            <TouchableOpacity
              onPress={onClose}
              style={s.closeBtn}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Chiudi / Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="close" size={22} color={colors.textSub} />
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Legenda */}
      <View style={[s.legend, inline && { paddingHorizontal: 0, paddingBottom: 8 }]}>
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
          <Text style={{ color: colors.textSub, fontSize: 14, marginBottom: 12 }}>Errore nel caricamento</Text>
          <TouchableOpacity onPress={fetchFlights} style={[s.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Riprova</Text>
          </TouchableOpacity>
        </View>
      ) : flights.length === 0 ? (
        <View style={[s.center, inline && { minHeight: 80 }]}>
          <MaterialIcons name="flight-takeoff" size={30} color={colors.textMuted} style={{ marginBottom: 8 }} />
          <Text style={{ color: colors.textSub, fontSize: 14 }}>Nessuna partenza nel turno</Text>
        </View>
      ) : (
        <ScrollView style={inline ? undefined : s.scrollArea} scrollEnabled={!inline} showsVerticalScrollIndicator={false}>
          {/* Righello orizzontale del tempo */}
          <View style={s.rulerWrap}>
            <View style={s.rulerLabelSpace} />
            <View style={s.ruler}>
              {ticks.map((tick, i) => (
                <View key={i} style={[s.rulerTick, { left: `${tick.pct}%` }]}>
                  <View style={[s.rulerTickMark, { backgroundColor: colors.border }]} />
                  <Text style={[s.rulerTickLabel, { color: colors.textMuted }]}>{tick.label}</Text>
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
            const ciOpenTs = flight.departureTs - flight.ops.checkInOpen * 60;
            const ciCloseTs = flight.departureTs - flight.ops.checkInClose * 60;
            const gateOpenTs = flight.departureTs - flight.ops.gateOpen * 60;
            const gateCloseTs = flight.departureTs - flight.ops.gateClose * 60;

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
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 10 },
    title: { fontSize: 18, fontWeight: '800' },
    subtitle: { fontSize: 12, marginTop: 2 },
    closeBtn: { padding: 8, borderRadius: 20 },
    legend: { flexDirection: 'row', gap: 16, paddingHorizontal: 20, paddingBottom: 12 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontSize: 11, fontWeight: '600' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
    scrollArea: { flex: 1 },

    // Righello orizzontale in alto
    rulerWrap: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 4, height: 32 },
    rulerLabelSpace: { width: 80 },
    ruler: { flex: 1, position: 'relative' },
    rulerTick: { position: 'absolute', top: 0, alignItems: 'center', transform: [{ translateX: -1 }] },
    rulerTickMark: { width: 1, height: 10 },
    rulerTickLabel: { fontSize: 8, fontWeight: '700', marginTop: 2 },
    nowMarker: { position: 'absolute', top: 0, alignItems: 'center', zIndex: 10, transform: [{ translateX: -1 }] },
    nowLabel: { fontSize: 7, fontWeight: '900', color: '#EF4444' },
    nowTick: { width: 2, height: 10, backgroundColor: '#EF4444', borderRadius: 1 },

    // Righe voli
    flightRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
    flightLabelWrap: { width: 80, flexDirection: 'row', alignItems: 'center', gap: 4 },
    airlineDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
    flightLabel: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
    flightDest: { fontSize: 10, fontWeight: '600' },

    // Area Gantt
    ganttArea: { flex: 1, height: 36, position: 'relative', justifyContent: 'center' },
    ganttGridLine: { position: 'absolute', top: 0, bottom: 0, width: 1, opacity: 0.25 },
    ganttNowLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#EF4444', opacity: 0.5, zIndex: 5 },
    ganttBar: { position: 'absolute', height: 14, borderRadius: 3, justifyContent: 'center', paddingHorizontal: 4 },
    ganttBarCI: { backgroundColor: CI_COLOR, top: 2 },
    ganttBarGate: { backgroundColor: GATE_COLOR, bottom: 2 },
    ganttBarText: { fontSize: 8, fontWeight: '800', color: '#fff' },
    depMarker: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 2, borderStyle: 'dashed' },

    // Card espansa
    expandedCard: { borderRadius: 10, padding: 12, marginHorizontal: 12, marginBottom: 4, borderWidth: 1 },
    expandedTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
    expandedRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    expandedLabel: { fontSize: 11, fontWeight: '600' },
    expandedValue: { fontSize: 11, fontWeight: '700' },
  });
}
