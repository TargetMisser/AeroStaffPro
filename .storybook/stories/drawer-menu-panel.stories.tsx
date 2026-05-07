import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import DrawerMenuPanel, {
  DRAWER_WIDTH,
  type DrawerItem,
  type DrawerMenuSurfaceVariant,
} from '../../src/components/DrawerMenuPanel';
import { type ThemeColors } from '../../src/context/ThemeContext';

const DARK_COLORS: ThemeColors = {
  bg: '#0A0A0C',
  card: '#1C1C1E',
  cardSecondary: '#2C2C2E',
  text: '#FFFFFF',
  textSub: 'rgba(235,235,245,0.75)',
  textMuted: 'rgba(235,235,245,0.42)',
  primary: '#FF9A42',
  primaryDark: '#F47B16',
  primaryLight: 'rgba(255,154,66,0.20)',
  glass: '#1C1C1E',
  glassBorder: 'transparent',
  glassStrong: '#2C2C2E',
  border: 'rgba(255,255,255,0.11)',
  appBar: '#0A0A0C',
  tabBar: '#111113',
  tabIconActive: '#FF9A42',
  tabIconInactive: 'rgba(235,235,245,0.35)',
  tabLabelActive: '#FF9A42',
  pillActive: 'rgba(255,154,66,0.18)',
  statusBar: 'light-content',
  isDark: true,
};

const ITEMS: DrawerItem[] = [
  { id: 'Notepad', icon: 'edit-note', label: 'Blocco Note', sublabel: 'Note personali' },
  { id: 'Phonebook', icon: 'contacts', label: 'Rubrica', sublabel: 'Numeri utili' },
  { id: 'Passwords', icon: 'lock', label: 'Password', sublabel: 'Credenziali salvate' },
  { id: 'Manuals', icon: 'menu-book', label: 'Manuali DCS', sublabel: 'EasyJet, Wizz, Ryanair...' },
  { id: 'Settings', icon: 'settings', label: 'Impostazioni', sublabel: 'Preferenze app' },
  { id: 'DesignLab', icon: 'auto-awesome', label: 'Design Lab', sublabel: 'Direzioni visuali dev-only' },
];

const VARIANTS: Array<{
  id: DrawerMenuSurfaceVariant;
  title: string;
  copy: string;
  backgroundColor: string;
}> = [
  {
    id: 'app',
    title: 'Current App',
    copy: 'La versione originale come punto di confronto.',
    backgroundColor: '#0A0A0C',
  },
  {
    id: 'solid',
    title: 'Solid Readable',
    copy: 'Piu coprente e leggibile: questa e la default collegata all app.',
    backgroundColor: '#06080D',
  },
  {
    id: 'operations',
    title: 'Operations Board',
    copy: 'Mood monitor operativo, utile se vogliamo una UI piu tecnica.',
    backgroundColor: '#071414',
  },
  {
    id: 'sunset',
    title: 'Sunset Premium',
    copy: 'Calda e intensa, piu vicina al brand arancione AeroStaff.',
    backgroundColor: '#170B06',
  },
];

function PanelDemo({ variant }: { variant: (typeof VARIANTS)[number] }) {
  return (
    <View style={[styles.card, { backgroundColor: variant.backgroundColor }]}>
      <Text style={styles.title}>{variant.title}</Text>
      <Text style={styles.copy}>{variant.copy}</Text>
      <View style={styles.panelFrame}>
        <DrawerMenuPanel
          colors={DARK_COLORS}
          items={ITEMS}
          versionLabel="AeroStaff Pro · v2.6.dev"
          surfaceVariant={variant.id}
          onClose={() => {}}
          onSelect={() => {}}
        />
      </View>
    </View>
  );
}

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  );
}

export default {
  title: 'AeroStaff/Drawer menu',
};

export const SolidReadable = () => (
  <StoryFrame>
    <PanelDemo variant={VARIANTS[1]} />
  </StoryFrame>
);

export const AllVariants = () => (
  <StoryFrame>
    {VARIANTS.map(variant => (
      <PanelDemo key={variant.id} variant={variant} />
    ))}
  </StoryFrame>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070A' },
  content: { padding: 18, gap: 18 },
  card: {
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 18,
    gap: 12,
  },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  copy: { color: 'rgba(235,239,245,0.74)', fontSize: 13, lineHeight: 19 },
  panelFrame: {
    width: DRAWER_WIDTH,
    height: 620,
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
});
