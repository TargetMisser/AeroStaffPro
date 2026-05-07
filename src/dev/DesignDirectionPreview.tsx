import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import type { DesignDirection } from './designDirections';
import OperationsBoardPreview from './OperationsBoardPreview';

type Props = {
  direction: DesignDirection;
  compact?: boolean;
};

const SAMPLE_FLIGHTS = [
  { fn: 'FR7146', dest: 'KRK', time: '14:35', status: 'Check-in', tone: 'primary' },
  { fn: 'W65032', dest: 'TIA', time: '15:20', status: 'Gate 8', tone: 'accent' },
] as const;

export default function DesignDirectionPreview({ direction, compact = false }: Props) {
  const p = direction.palette;

  if (direction.id === 'operations-board' && !compact) {
    return <OperationsBoardPreview />;
  }

  return (
    <View style={[styles.shell, { backgroundColor: p.bg }]}>
      <LinearGradient
        colors={[p.surfaceAlt, p.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { borderColor: p.line }]}
      >
        <View style={[styles.logoMark, { backgroundColor: p.primary }]}>
          <MaterialIcons name={direction.icon} size={22} color="#111827" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: p.accent }]}>DESIGN LAB</Text>
          <Text style={[styles.title, { color: p.text }]}>{direction.name}</Text>
          <Text style={[styles.subtitle, { color: p.textSub }]}>{direction.tagline}</Text>
        </View>
      </LinearGradient>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: p.surface, borderColor: p.line }]}>
          <Text style={[styles.statLabel, { color: p.muted }]}>OGGI</Text>
          <Text style={[styles.statValue, { color: p.primary }]}>29</Text>
          <Text style={[styles.statMeta, { color: p.textSub }]}>Aprile</Text>
        </View>
        <View style={[styles.shiftCard, { backgroundColor: p.surface, borderColor: p.line }]}>
          <View style={[styles.statusPill, { backgroundColor: p.surfaceAlt }]}>
            <View style={[styles.statusDot, { backgroundColor: p.primary }]} />
            <Text style={[styles.statusText, { color: p.primary }]}>IN CORSO</Text>
          </View>
          <Text style={[styles.shiftTitle, { color: p.text }]}>Turno lavoro</Text>
          <Text style={[styles.shiftTime, { color: p.textSub }]}>08:00 - 13:00</Text>
        </View>
      </View>

      <View style={[styles.flightPanel, { backgroundColor: p.surface, borderColor: p.line }]}>
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: p.text }]}>Voli turno</Text>
          <Text style={[styles.panelMeta, { color: p.muted }]}>PSA</Text>
        </View>
        {SAMPLE_FLIGHTS.map(item => {
          const tone = item.tone === 'primary' ? p.primary : p.accent;
          return (
            <View key={item.fn} style={[styles.flightRow, { borderColor: p.line }]}>
              <View style={[styles.flightBadge, { backgroundColor: tone }]}>
                <Text style={styles.flightBadgeText}>{item.fn.slice(0, 2)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.flightNumber, { color: p.text }]}>{item.fn}</Text>
                <Text style={[styles.flightSub, { color: p.textSub }]}>per {item.dest}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.flightTime, { color: p.text }]}>{item.time}</Text>
                <Text style={[styles.flightStatus, { color: tone }]}>{item.status}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {!compact && (
        <View style={[styles.bottomNav, { backgroundColor: p.surface, borderColor: p.line }]}>
          {(['home', 'menu', 'flight-takeoff', 'description'] as const).map((icon, index) => (
            <View key={icon} style={styles.navItem}>
              <MaterialIcons name={icon} size={20} color={index === 0 ? p.primary : p.muted} />
              {index === 0 && <View style={[styles.navIndicator, { backgroundColor: p.primary }]} />}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 28,
    padding: 14,
    gap: 14,
    overflow: 'hidden',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
  },
  logoMark: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: { width: 96, borderWidth: 1, borderRadius: 24, padding: 14, alignItems: 'center' },
  statLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  statValue: { fontSize: 38, fontWeight: '900', lineHeight: 44 },
  statMeta: { fontSize: 13, fontWeight: '700' },
  shiftCard: { flex: 1, borderWidth: 1, borderRadius: 24, padding: 14, justifyContent: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 10 },
  statusDot: { width: 7, height: 7, borderRadius: 99 },
  statusText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  shiftTitle: { fontSize: 17, fontWeight: '900' },
  shiftTime: { fontSize: 25, fontWeight: '900', marginTop: 2, fontVariant: ['tabular-nums'] },
  flightPanel: { borderWidth: 1, borderRadius: 24, padding: 14, gap: 10 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: { fontSize: 17, fontWeight: '900' },
  panelMeta: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  flightRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingTop: 10 },
  flightBadge: { width: 42, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flightBadgeText: { color: '#0B0F14', fontWeight: '900', fontSize: 12 },
  flightNumber: { fontSize: 16, fontWeight: '900' },
  flightSub: { fontSize: 12, marginTop: 1 },
  flightTime: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  flightStatus: { fontSize: 11, fontWeight: '800' },
  bottomNav: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', height: 58, borderWidth: 1, borderRadius: 999 },
  navItem: { alignItems: 'center', justifyContent: 'center', width: 50, height: 44 },
  navIndicator: { width: 18, height: 3, borderRadius: 999, marginTop: 6 },
});
