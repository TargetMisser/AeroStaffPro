import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AppTabBar, { type AppTabBarItem, type AppTabId } from '../../src/components/AppTabBar';
import DrawerMenuPanel, { DRAWER_WIDTH, type DrawerItem } from '../../src/components/DrawerMenuPanel';
import BoardReveal from '../../src/components/motion/BoardReveal';
import TactilePressable from '../../src/components/motion/TactilePressable';
import ValueChangeFlash from '../../src/components/motion/ValueChangeFlash';
import { type ThemeColors } from '../../src/context/ThemeContext';

const OPS_COLORS: ThemeColors = {
  bg: '#0B1114',
  card: '#111A1F',
  cardSecondary: '#19262D',
  text: '#EAF4F4',
  textSub: '#A7BAC2',
  textMuted: 'rgba(141,163,173,0.72)',
  primary: '#2DD4BF',
  primaryDark: '#99F6E4',
  primaryLight: 'rgba(45,212,191,0.18)',
  glass: '#111A1F',
  glassBorder: 'rgba(45,212,191,0.24)',
  glassStrong: '#19262D',
  border: 'rgba(141,163,173,0.24)',
  appBar: 'rgba(6,17,18,0.96)',
  tabBar: '#071414',
  tabIconActive: '#2DD4BF',
  tabIconInactive: 'rgba(204,251,241,0.58)',
  tabLabelActive: '#2DD4BF',
  pillActive: 'rgba(45,212,191,0.18)',
  statusBar: 'light-content',
  isDark: true,
};

const TABS: AppTabBarItem[] = [
  { id: 'Shifts', icon: 'home', label: 'Home' },
  { id: 'Calendar', icon: 'table-rows', label: 'Turni' },
  { id: 'Flights', icon: 'flight-takeoff', label: 'Voli' },
  { id: 'TravelDoc', icon: 'description', label: 'Doc' },
];

const ITEMS: DrawerItem[] = [
  { id: 'Notepad', icon: 'edit-note', label: 'Blocco Note', sublabel: 'Note personali' },
  { id: 'Phonebook', icon: 'contacts', label: 'Rubrica', sublabel: 'Numeri utili' },
  { id: 'Passwords', icon: 'lock', label: 'Password', sublabel: 'Credenziali salvate' },
  { id: 'Manuals', icon: 'menu-book', label: 'Manuali DCS', sublabel: 'EasyJet, Wizz, Ryanair...' },
  { id: 'ArionInbox', icon: 'inbox', label: 'Arion Inbox', sublabel: 'Messaggi aziendali' },
  { id: 'Settings', icon: 'settings', label: 'Impostazioni', sublabel: 'Preferenze app' },
];

function FlightMotionCard({ index }: { index: number }) {
  const [valueKey, setValueKey] = useState('14:48|GATE 08');

  return (
    <BoardReveal index={index} enabled>
      <TactilePressable
        animatedStyle={styles.flightCard}
        depth={5}
        pressedScale={0.982}
        haptic="selection"
        onPress={() => setValueKey(valueKey === '14:48|GATE 08' ? '15:02|GATE 12' : '14:48|GATE 08')}
      >
        <View style={styles.flightHeader}>
          <View>
            <Text style={styles.kicker}>FLIGHT STACK</Text>
            <Text style={styles.flightNumber}>FR7146</Text>
          </View>
          <ValueChangeFlash valueKey={valueKey} style={styles.flightTimeFlash}>
            <Text style={styles.flightTime}>{valueKey.split('|')[0]}</Text>
            <Text style={styles.flightGate}>{valueKey.split('|')[1]}</Text>
          </ValueChangeFlash>
        </View>
        <View style={styles.opsRow}>
          <View style={styles.opsChip}>
            <MaterialIcons name="desktop-windows" size={16} color="#2DD4BF" />
            <Text style={styles.opsChipText}>Check-in 13:10 - 14:30</Text>
          </View>
          <View style={styles.opsChip}>
            <MaterialIcons name="radar" size={16} color="#FACC15" />
            <Text style={styles.opsChipText}>Tap cambia dato</Text>
          </View>
        </View>
      </TactilePressable>
    </BoardReveal>
  );
}

function MotionIntegrationDemo() {
  const [activeTab, setActiveTab] = useState<AppTabId>('Flights');

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.title}>Motion integration</Text>
        <Text style={styles.copy}>
          Preview unica per shell, drawer, footer e card dati. Qui verifichiamo ritmo, leggibilita e gesture prima di fare APK.
        </Text>
      </View>

      <View style={styles.stage}>
        <View style={styles.appBar}>
          <MaterialIcons name="menu" size={24} color="#99F6E4" />
          <Text style={styles.appTitle}>AeroStaff Pro</Text>
          <View style={styles.avatar}><Text style={styles.avatarText}>PI</Text></View>
        </View>

        <FlightMotionCard index={0} />
        <FlightMotionCard index={1} />

        <View style={styles.footerSlot}>
          <AppTabBar
            tabs={TABS}
            activeTab={activeTab}
            activeColor="#2DD4BF"
            inactiveColor="rgba(204,251,241,0.58)"
            isDark
            variant="operations"
            onPress={tabId => setActiveTab(tabId)}
          />
        </View>
      </View>

      <View style={styles.drawerFrame}>
        <DrawerMenuPanel
          colors={OPS_COLORS}
          items={ITEMS}
          versionLabel="AeroStaff Pro - motion"
          surfaceVariant="operations"
          onClose={() => {}}
          onSelect={() => {}}
        />
      </View>
    </ScrollView>
  );
}

export default {
  title: 'AeroStaff/Motion integration',
};

export const OperationsMotion = () => <MotionIntegrationDemo />;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070A' },
  content: { padding: 18, gap: 18 },
  title: { color: '#EAF4F4', fontSize: 30, fontWeight: '900', letterSpacing: -0.9 },
  copy: { color: 'rgba(167,186,194,0.84)', fontSize: 14, lineHeight: 20, marginTop: 4 },
  stage: {
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.24)',
    backgroundColor: '#071414',
    padding: 16,
    gap: 14,
    overflow: 'hidden',
  },
  appBar: {
    minHeight: 58,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.22)',
    backgroundColor: 'rgba(6,17,18,0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
  },
  appTitle: { flex: 1, color: '#EAF4F4', fontSize: 20, fontWeight: '900' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#14B8A6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#ECFEFF', fontSize: 12, fontWeight: '900' },
  flightCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: 'rgba(45,212,191,0.28)',
    borderLeftColor: '#22C55E',
    backgroundColor: 'rgba(2,8,12,0.66)',
    overflow: 'hidden',
  },
  flightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(45,212,191,0.16)',
    padding: 14,
  },
  kicker: { color: 'rgba(153,246,228,0.58)', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  flightNumber: { color: '#99F6E4', fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  flightTimeFlash: { alignItems: 'flex-end', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4 },
  flightTime: { color: '#EAF4F4', fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  flightGate: { color: '#A7BAC2', fontSize: 12, fontWeight: '800' },
  opsRow: { flexDirection: 'row', gap: 10, padding: 14 },
  opsChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.18)',
    borderRadius: 14,
    backgroundColor: 'rgba(45,212,191,0.08)',
    padding: 10,
    gap: 6,
  },
  opsChipText: { color: '#A7BAC2', fontSize: 11, fontWeight: '800', lineHeight: 15 },
  footerSlot: { marginTop: 4 },
  drawerFrame: {
    width: DRAWER_WIDTH,
    height: 650,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.24)',
  },
});
