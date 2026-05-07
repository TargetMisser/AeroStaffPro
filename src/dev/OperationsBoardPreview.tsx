import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import AppTabBar, { type AppTabBarItem, type AppTabId } from '../components/AppTabBar';

const OPS_TABS: AppTabBarItem[] = [
  { id: 'Shifts', icon: 'home', label: 'Home' },
  { id: 'Calendar', icon: 'table-rows', label: 'Turni' },
  { id: 'Flights', icon: 'flight-takeoff', label: 'Voli' },
  { id: 'TravelDoc', icon: 'description', label: 'Doc' },
];

const FLIGHTS = [
  { id: 'FR7146', route: 'PSA - KRK', std: '14:35', est: '14:48', state: 'CHECK-IN', tone: '#22C55E' },
  { id: 'W65032', route: 'PSA - TIA', std: '15:20', est: '15:15', state: 'GATE 08', tone: '#FACC15' },
  { id: 'U21974', route: 'PSA - NCE', std: '16:05', est: '16:32', state: 'DELAY', tone: '#FB7185' },
] as const;

function StatusChip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={[styles.statusChip, { borderColor: `${tone}66`, backgroundColor: `${tone}16` }]}>
      <Text style={[styles.statusLabel, { color: `${tone}CC` }]}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

function FlightStrip({ flight }: { flight: (typeof FLIGHTS)[number] }) {
  return (
    <View style={[styles.flightStrip, { borderLeftColor: flight.tone }]}>
      <View style={styles.flightMain}>
        <Text style={styles.flightId}>{flight.id}</Text>
        <Text style={styles.flightRoute}>{flight.route}</Text>
      </View>
      <View style={styles.timeColumns}>
        <View style={styles.timeColumn}>
          <Text style={styles.timeLabel}>STD</Text>
          <Text style={styles.timeValue}>{flight.std}</Text>
        </View>
        <View style={styles.timeColumn}>
          <Text style={styles.timeLabel}>EST</Text>
          <Text style={[styles.timeValue, { color: flight.tone }]}>{flight.est}</Text>
        </View>
      </View>
      <View style={[styles.stateBadge, { backgroundColor: `${flight.tone}20`, borderColor: `${flight.tone}80` }]}>
        <Text style={[styles.stateText, { color: flight.tone }]}>{flight.state}</Text>
      </View>
    </View>
  );
}

export default function OperationsBoardPreview() {
  const [activeTab, setActiveTab] = useState<AppTabId>('Shifts');

  return (
    <LinearGradient
      colors={['#061112', '#0B1114', '#101A1F']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.shell}
    >
      <View style={styles.scanLines} pointerEvents="none" />

      <View style={styles.topBar}>
        <View>
          <Text style={styles.kicker}>OPS BOARD / PSA</Text>
          <Text style={styles.title}>Turno attivo</Text>
        </View>
        <View style={styles.liveBox}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <View style={styles.shiftBoard}>
        <View style={styles.shiftLeft}>
          <Text style={styles.boardLabel}>SHIFT WINDOW</Text>
          <Text style={styles.shiftTime}>08:00-13:00</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>
        <View style={styles.shiftRight}>
          <Text style={styles.boardLabel}>NEXT</Text>
          <Text style={styles.nextValue}>FR7146</Text>
          <Text style={styles.nextMeta}>Check-in in 24m</Text>
        </View>
      </View>

      <View style={styles.statusGrid}>
        <StatusChip label="LOAD" value="3 voli" tone="#22C55E" />
        <StatusChip label="ALERT" value="1 delay" tone="#FB7185" />
        <StatusChip label="SYNC" value="2m fa" tone="#38BDF8" />
      </View>

      <View style={styles.flightPanel}>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.panelKicker}>FLIGHT STACK</Text>
            <Text style={styles.panelTitle}>Voli nel turno</Text>
          </View>
          <MaterialIcons name="radar" size={22} color="#2DD4BF" />
        </View>
        {FLIGHTS.map(flight => (
          <FlightStrip key={flight.id} flight={flight} />
        ))}
      </View>

      <AppTabBar
        tabs={OPS_TABS}
        activeTab={activeTab}
        activeColor="#2DD4BF"
        inactiveColor="rgba(204,251,241,0.58)"
        isDark
        variant="operations"
        onPress={tabId => setActiveTab(tabId)}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 30,
    padding: 16,
    gap: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.22)',
  },
  scanLines: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(45,212,191,0.025)',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  kicker: {
    color: 'rgba(153,246,228,0.60)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  title: {
    color: '#EAF4F4',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1,
  },
  liveBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.36)',
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: '#22C55E' },
  liveText: { color: '#86EFAC', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  shiftBoard: {
    flexDirection: 'row',
    gap: 10,
  },
  shiftLeft: {
    flex: 1.45,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.18)',
    backgroundColor: 'rgba(2,8,12,0.48)',
    borderRadius: 20,
    padding: 14,
    gap: 8,
  },
  shiftRight: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.24)',
    backgroundColor: 'rgba(250,204,21,0.08)',
    borderRadius: 20,
    padding: 14,
    justifyContent: 'center',
  },
  boardLabel: { color: 'rgba(204,251,241,0.52)', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  shiftTime: { color: '#EAF4F4', fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(204,251,241,0.10)',
    overflow: 'hidden',
  },
  progressFill: { width: '62%', height: '100%', backgroundColor: '#22C55E', borderRadius: 999 },
  nextValue: { color: '#FACC15', fontSize: 23, fontWeight: '900', fontVariant: ['tabular-nums'] },
  nextMeta: { color: 'rgba(254,240,138,0.70)', fontSize: 12, fontWeight: '700', marginTop: 2 },
  statusGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  statusChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  statusLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  statusValue: { color: '#EAF4F4', fontSize: 15, fontWeight: '900', marginTop: 2 },
  flightPanel: {
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.18)',
    backgroundColor: 'rgba(2,8,12,0.44)',
    borderRadius: 22,
    padding: 12,
    gap: 9,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  panelKicker: { color: 'rgba(153,246,228,0.56)', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  panelTitle: { color: '#EAF4F4', fontSize: 18, fontWeight: '900' },
  flightStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderTopColor: 'rgba(45,212,191,0.14)',
    borderRightColor: 'rgba(45,212,191,0.14)',
    borderBottomColor: 'rgba(45,212,191,0.14)',
    backgroundColor: 'rgba(17,26,31,0.82)',
    borderRadius: 14,
    padding: 10,
  },
  flightMain: { flex: 1 },
  flightId: { color: '#EAF4F4', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  flightRoute: { color: 'rgba(167,186,194,0.82)', fontSize: 11, fontWeight: '800', marginTop: 1 },
  timeColumns: {
    flexDirection: 'row',
    gap: 8,
  },
  timeColumn: { alignItems: 'flex-end' },
  timeLabel: { color: 'rgba(141,163,173,0.70)', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  timeValue: { color: '#EAF4F4', fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  stateBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  stateText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
});
