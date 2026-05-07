import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import AppTabBar, {
  type AppTabBarVariant,
  type AppTabBarItem,
  type AppTabId,
} from '../../src/components/AppTabBar';

const TABS: AppTabBarItem[] = [
  { id: 'Shifts', icon: 'home', label: 'Home' },
  { id: 'Calendar', icon: 'table-rows', label: 'Turni' },
  { id: 'Flights', icon: 'flight-takeoff', label: 'Voli' },
  { id: 'TravelDoc', icon: 'description', label: 'TravelDoc' },
];

const VARIANTS: Array<{
  id: AppTabBarVariant;
  title: string;
  copy: string;
  backgroundColor: string;
  activeColor: string;
  inactiveColor: string;
  isDark: boolean;
}> = [
  {
    id: 'app',
    title: 'Current App',
    copy: 'Il footer originale, utile come riferimento prima di toccare opacita e colori.',
    backgroundColor: '#0A0A0C',
    activeColor: '#FF9A42',
    inactiveColor: 'rgba(235,239,245,0.78)',
    isDark: true,
  },
  {
    id: 'solid',
    title: 'Solid Readable',
    copy: 'La variante piu coprente che ora usiamo in app per evitare testo dietro il footer.',
    backgroundColor: '#06080D',
    activeColor: '#FF9A42',
    inactiveColor: 'rgba(235,239,245,0.78)',
    isDark: true,
  },
  {
    id: 'operations',
    title: 'Operations Board',
    copy: 'Piu tecnica, verde monitor operativo, interessante per schermate voli e turni.',
    backgroundColor: '#071414',
    activeColor: '#2DD4BF',
    inactiveColor: 'rgba(204,251,241,0.66)',
    isDark: true,
  },
  {
    id: 'sunset',
    title: 'Sunset Premium',
    copy: 'Calda e aeroportuale, resta in famiglia AeroStaff ma con piu carattere.',
    backgroundColor: '#170B06',
    activeColor: '#FDBA74',
    inactiveColor: 'rgba(255,237,213,0.68)',
    isDark: true,
  },
];

function TabBarDemo({ variant }: { variant: (typeof VARIANTS)[number] }) {
  const [activeTab, setActiveTab] = useState<AppTabId>('Shifts');

  return (
    <View style={[styles.card, { backgroundColor: variant.backgroundColor }]}>
      <Text style={styles.title}>{variant.title}</Text>
      <Text style={styles.copy}>{variant.copy}</Text>
      <View style={styles.phoneStage}>
        <View style={styles.fakeCard} />
        <View style={styles.fakeCardSmall} />
        <View style={styles.tabBarSlot}>
          <AppTabBar
            tabs={TABS}
            activeTab={activeTab}
            activeColor={variant.activeColor}
            inactiveColor={variant.inactiveColor}
            isDark={variant.isDark}
            variant={variant.id}
            onPress={tabId => setActiveTab(tabId)}
          />
        </View>
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
  title: 'AeroStaff/App tab bar',
};

export const SolidReadable = () => (
  <StoryFrame>
    <TabBarDemo variant={VARIANTS[1]} />
  </StoryFrame>
);

export const AllVariants = () => (
  <StoryFrame>
    {VARIANTS.map(variant => (
      <TabBarDemo key={variant.id} variant={variant} />
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
  phoneStage: {
    height: 280,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 16,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  fakeCard: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 22,
    height: 88,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  fakeCardSmall: {
    position: 'absolute',
    left: 18,
    right: 80,
    top: 128,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  tabBarSlot: {
    marginHorizontal: 0,
  },
});
