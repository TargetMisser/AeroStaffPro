import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import OperationsBoardPreview from '../../src/dev/OperationsBoardPreview';
import DrawerMenuPanel, { DRAWER_WIDTH, type DrawerItem } from '../../src/components/DrawerMenuPanel';
import { type ThemeColors } from '../../src/context/ThemeContext';

const OPS_COLORS: ThemeColors = {
  bg: '#0B1114',
  card: '#111A1F',
  cardSecondary: '#19262D',
  text: '#EAF4F4',
  textSub: '#A7BAC2',
  textMuted: '#8DA3AD',
  primary: '#2DD4BF',
  primaryDark: '#14B8A6',
  primaryLight: 'rgba(45,212,191,0.18)',
  glass: '#111A1F',
  glassBorder: 'rgba(45,212,191,0.22)',
  glassStrong: '#19262D',
  border: 'rgba(141,163,173,0.22)',
  appBar: '#0B1114',
  tabBar: '#071414',
  tabIconActive: '#2DD4BF',
  tabIconInactive: 'rgba(204,251,241,0.58)',
  tabLabelActive: '#2DD4BF',
  pillActive: 'rgba(45,212,191,0.18)',
  statusBar: 'light-content',
  isDark: true,
};

const ITEMS: DrawerItem[] = [
  { id: 'Notepad', icon: 'edit-note', label: 'Blocco Note', sublabel: 'Note personali' },
  { id: 'Phonebook', icon: 'contacts', label: 'Rubrica', sublabel: 'Numeri utili' },
  { id: 'Passwords', icon: 'lock', label: 'Password', sublabel: 'Credenziali salvate' },
  { id: 'Manuals', icon: 'menu-book', label: 'Manuali DCS', sublabel: 'EasyJet, Wizz, Ryanair...' },
  { id: 'Settings', icon: 'settings', label: 'Impostazioni', sublabel: 'Preferenze app' },
];

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  );
}

export default {
  title: 'AeroStaff/Operations board system',
};

export const HomeAndFlights = () => (
  <StoryFrame>
    <View>
      <Text style={styles.storyTitle}>Operations Board</Text>
      <Text style={styles.storyCopy}>
        Prova strutturale: card turno, flight stack, stati e footer control deck.
      </Text>
    </View>
    <OperationsBoardPreview />
  </StoryFrame>
);

export const CommandDrawer = () => (
  <StoryFrame>
    <View>
      <Text style={styles.storyTitle}>Command Drawer</Text>
      <Text style={styles.storyCopy}>
        Drawer con header tecnico, righe indicizzate e superfici meno glass.
      </Text>
    </View>
    <View style={styles.drawerFrame}>
      <DrawerMenuPanel
        colors={OPS_COLORS}
        items={ITEMS}
        versionLabel="AeroStaff Pro · operations"
        surfaceVariant="operations"
        onClose={() => {}}
        onSelect={() => {}}
      />
    </View>
  </StoryFrame>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070A' },
  content: { padding: 18, gap: 18 },
  storyTitle: { color: '#EAF4F4', fontSize: 28, fontWeight: '900', letterSpacing: -0.8 },
  storyCopy: { color: 'rgba(167,186,194,0.82)', fontSize: 14, lineHeight: 20, marginTop: 4 },
  drawerFrame: {
    width: DRAWER_WIDTH,
    height: 620,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.24)',
  },
});
