import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing as ReanimatedEasing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  motionPatternIds,
  motionRecipeDurations,
  motionRecipeSprings,
  triggerMotionHaptic,
  type MotionPatternId,
} from '../utils/motion';

type CinematicMotionBoardProps = {
  compact?: boolean;
};

type PatternDescriptor = {
  id: MotionPatternId;
  title: string;
  summary: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

const PATTERN_COPY: Record<MotionPatternId, Omit<PatternDescriptor, 'id'>> = {
  'footer-nav': {
    title: 'Footer nav detent',
    summary: 'Indicatore fisico, morphing e transizione pagina piu fluida.',
    icon: 'space-dashboard',
  },
  'drawer-reveal': {
    title: 'Drawer reveal',
    summary: 'Profondita, rail laterale e stagger controllato senza bloccare il tap.',
    icon: 'menu-open',
  },
  'flight-card-live-update': {
    title: 'Flight live update',
    summary: 'Flash strumentale, cambio orario leggibile e stato che entra come dato.',
    icon: 'flight-takeoff',
  },
  'cache-loading': {
    title: 'Cache loading scan',
    summary: 'Refresh visibile sopra dati cache, niente lista che sparisce.',
    icon: 'radar',
  },
  'press-feedback': {
    title: 'Unified press',
    summary: 'Stesso linguaggio tattile per card, chip, pulsanti e menu.',
    icon: 'touch-app',
  },
  'editorial-empty-state': {
    title: 'Editorial empty state',
    summary: 'Errore o vuoto spiegato come stato operativo, non come spinner generico.',
    icon: 'info-outline',
  },
};

const MOTION_PATTERNS: PatternDescriptor[] = motionPatternIds.map(id => ({
  id,
  ...PATTERN_COPY[id],
}));

const STANDARD_EASE = ReanimatedEasing.bezier(0.4, 0, 0.2, 1);
const DECEL_EASE = ReanimatedEasing.bezier(0, 0, 0.2, 1);

export default function CinematicMotionBoard({ compact = false }: CinematicMotionBoardProps) {
  const [selectedPattern, setSelectedPattern] = useState<MotionPatternId>('footer-nav');

  const content = (
    <LinearGradient
      colors={['#030A0D', '#071414', '#101821']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.shell, compact && styles.shellCompact]}
    >
      <View style={styles.scanTexture} pointerEvents="none" />

      {!compact && (
        <View style={styles.hero}>
          <Text style={styles.kicker}>CINEMATIC MOTION BOARD</Text>
          <Text style={styles.title}>Operations-grade motion prototypes</Text>
          <Text style={styles.copy}>
            Sei pattern isolati per provare ritmo, gesture e feedback prima di toccare le
            schermate reali.
          </Text>
        </View>
      )}

      <PatternSelector
        selectedPattern={selectedPattern}
        onSelect={pattern => {
          setSelectedPattern(pattern);
          triggerMotionHaptic('selection').catch(() => {});
        }}
      />

      <View style={styles.patternGrid}>
        <FooterNavPrototype active={selectedPattern === 'footer-nav'} />
        <DrawerRevealPrototype active={selectedPattern === 'drawer-reveal'} />
        <FlightCardLiveUpdatePrototype active={selectedPattern === 'flight-card-live-update'} />
        <CacheLoadingPrototype active={selectedPattern === 'cache-loading'} />
        <PressFeedbackPrototype active={selectedPattern === 'press-feedback'} />
        <EditorialEmptyStatePrototype active={selectedPattern === 'editorial-empty-state'} />
      </View>
    </LinearGradient>
  );

  return (
    <GestureHandlerRootView style={compact ? styles.compactRoot : styles.gestureRoot}>
      {compact ? (
        content
      ) : (
        <ScrollView
          style={styles.root}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      )}
    </GestureHandlerRootView>
  );
}

function PatternSelector({
  selectedPattern,
  onSelect,
}: {
  selectedPattern: MotionPatternId;
  onSelect: (pattern: MotionPatternId) => void;
}) {
  return (
    <View style={styles.selectorGrid}>
      {MOTION_PATTERNS.map(pattern => {
        const active = pattern.id === selectedPattern;
        return (
          <Pressable
            key={pattern.id}
            style={[styles.patternButton, active && styles.patternButtonActive]}
            onPress={() => onSelect(pattern.id)}
          >
            <MaterialIcons name={pattern.icon} size={18} color={active ? '#99F6E4' : '#7F9CA5'} />
            <View style={styles.patternText}>
              <Text style={[styles.patternTitle, active && styles.patternTitleActive]}>
                {pattern.title}
              </Text>
              <Text style={styles.patternSummary}>{pattern.summary}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function PrototypeCard({
  id,
  active,
  title,
  children,
}: {
  id: MotionPatternId;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: motionRecipeDurations.instrument,
      easing: DECEL_EASE,
    });
  }, [active, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(45,212,191,0.18)', 'rgba(153,246,228,0.76)'],
    ),
    transform: [{ scale: 0.985 + progress.value * 0.015 }],
  }));

  return (
    <Animated.View style={[styles.prototypeCard, animatedStyle]}>
      <View style={styles.prototypeHeader}>
        <Text style={styles.prototypeKicker}>{id}</Text>
        <Text style={styles.prototypeTitle}>{title}</Text>
      </View>
      {children}
    </Animated.View>
  );
}

function FooterNavPrototype({ active }: { active: boolean }) {
  const [index, setIndex] = useState(2);
  const progress = useSharedValue(index);
  const width = 70;
  const gap = 8;

  useEffect(() => {
    progress.value = withSpring(index, motionRecipeSprings.navDetent);
  }, [index, progress]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (width + gap) }],
  }));

  const tabs = [
    { icon: 'home', label: 'HOME' },
    { icon: 'table-rows', label: 'TURNI' },
    { icon: 'flight-takeoff', label: 'VOLI' },
    { icon: 'description', label: 'DOC' },
  ] as const;

  return (
    <PrototypeCard id="footer-nav" active={active} title="Physical footer detent">
      <View style={styles.navShell}>
        <Animated.View style={[styles.navIndicator, { width }, indicatorStyle]} />
        {tabs.map((tab, tabIndex) => {
          const selected = tabIndex === index;
          return (
            <Pressable
              key={tab.label}
              style={[styles.navItem, { width }]}
              onPress={() => {
                setIndex(tabIndex);
                triggerMotionHaptic('light').catch(() => {});
              }}
            >
              <MaterialIcons name={tab.icon} size={22} color={selected ? '#67E8F9' : '#6F8D96'} />
              <Text style={[styles.navLabel, selected && styles.navLabelActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </PrototypeCard>
  );
}

function DrawerRevealPrototype({ active }: { active: boolean }) {
  const [open, setOpen] = useState(true);
  const progress = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {
      duration: motionRecipeDurations.boardReveal,
      easing: STANDARD_EASE,
    });
  }, [open, progress]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: 0.72 + progress.value * 0.28,
    transform: [
      { translateX: -24 + progress.value * 24 },
      { scale: 0.96 + progress.value * 0.04 },
    ],
  }));

  return (
    <PrototypeCard id="drawer-reveal" active={active} title="Depth drawer reveal">
      <Pressable
        style={styles.miniControl}
        onPress={() => {
          setOpen(value => !value);
          triggerMotionHaptic('selection').catch(() => {});
        }}
      >
        <MaterialIcons name="swap-horiz" size={17} color="#99F6E4" />
        <Text style={styles.miniControlText}>{open ? 'Close panel' : 'Open panel'}</Text>
      </Pressable>
      <Animated.View style={[styles.drawerPanel, panelStyle]}>
        {['Blocco note', 'Rubrica', 'Manuali DCS', 'Impostazioni'].map((label, rowIndex) => (
          <View key={label} style={[styles.drawerRow, { marginLeft: rowIndex * 6 }]}>
            <View style={styles.drawerRail} />
            <Text style={styles.drawerIndex}>0{rowIndex + 1}</Text>
            <Text style={styles.drawerLabel}>{label}</Text>
          </View>
        ))}
      </Animated.View>
    </PrototypeCard>
  );
}

function FlightCardLiveUpdatePrototype({ active }: { active: boolean }) {
  const [updated, setUpdated] = useState(false);
  const flash = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    flash.value = withSequence(
      withTiming(1, { duration: motionRecipeDurations.snap, easing: DECEL_EASE }),
      withTiming(0, { duration: motionRecipeDurations.panelTravel, easing: STANDARD_EASE }),
    );
  }, [active, updated, flash]);

  const flashStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      flash.value,
      [0, 1],
      ['rgba(2,8,12,0.52)', 'rgba(45,212,191,0.28)'],
    ),
  }));

  return (
    <PrototypeCard id="flight-card-live-update" active={active} title="Instrument live update">
      <Pressable
        onPress={() => {
          setUpdated(value => !value);
          triggerMotionHaptic('success').catch(() => {});
        }}
      >
        <Animated.View style={[styles.flightCard, flashStyle]}>
          <View>
            <Text style={styles.flightNumber}>U28320</Text>
            <Text style={styles.flightMeta}>PSA - LGW</Text>
          </View>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>{updated ? 'ESTIMATED' : 'SCHEDULED'}</Text>
            <Text style={styles.timeValue}>{updated ? '21:46' : '21:40'}</Text>
          </View>
          <View style={[styles.statePill, updated && styles.statePillLive]}>
            <Text style={[styles.statePillText, updated && styles.statePillTextLive]}>
              {updated ? 'IN VOLO FR24 API' : 'scheduled'}
            </Text>
          </View>
        </Animated.View>
      </Pressable>
    </PrototypeCard>
  );
}

function CacheLoadingPrototype({ active }: { active: boolean }) {
  const scan = useSharedValue(0);

  useEffect(() => {
    scan.value = withRepeat(
      withTiming(1, {
        duration: motionRecipeDurations.ambient,
        easing: ReanimatedEasing.linear,
      }),
      -1,
      false,
    );
  }, [scan]);

  const scanStyle = useAnimatedStyle(() => ({
    opacity: active ? 1 : 0.45,
    transform: [{ translateX: -180 + scan.value * 420 }],
  }));

  return (
    <PrototypeCard id="cache-loading" active={active} title="Refresh over cached list">
      <View style={styles.cachePanel}>
        <Animated.View style={[styles.scanBeam, scanStyle]} />
        <View style={styles.cacheHeader}>
          <MaterialIcons name="data-usage" size={18} color="#5EEAD4" />
          <Text style={styles.cacheTitle}>Fonte voli: cache + refresh in corso</Text>
        </View>
        <View style={styles.cacheRows}>
          <View style={[styles.cacheRow, { width: '82%' }]} />
          <View style={[styles.cacheRow, { width: '66%' }]} />
          <View style={[styles.cacheRow, { width: '74%' }]} />
        </View>
      </View>
    </PrototypeCard>
  );
}

function PressFeedbackPrototype({ active }: { active: boolean }) {
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .onBegin(() => {
          scale.value = withTiming(0.96, { duration: motionRecipeDurations.snap });
          lift.value = withTiming(1, { duration: motionRecipeDurations.snap });
        })
        .onFinalize(() => {
          scale.value = withSpring(1, motionRecipeSprings.instrument);
          lift.value = withSpring(0, motionRecipeSprings.instrument);
        }),
    [lift, scale],
  );

  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -lift.value * 3 },
      { scale: scale.value },
    ],
    shadowOpacity: 0.14 + lift.value * 0.18,
  }));

  return (
    <PrototypeCard id="press-feedback" active={active} title="Unified tactile response">
      <GestureDetector gesture={tap}>
        <Animated.View style={[styles.pressPanel, pressStyle]}>
          <MaterialIcons name="touch-app" size={28} color="#99F6E4" />
          <View style={styles.pressTextBlock}>
            <Text style={styles.pressTitle}>Tap surface</Text>
            <Text style={styles.pressCopy}>Scala, alza e rilascia con lo stesso ritmo su tutta l'app.</Text>
          </View>
        </Animated.View>
      </GestureDetector>
    </PrototypeCard>
  );
}

function EditorialEmptyStatePrototype({ active }: { active: boolean }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: motionRecipeDurations.panelTravel, easing: DECEL_EASE }),
        withTiming(0, { duration: motionRecipeDurations.panelTravel, easing: STANDARD_EASE }),
      ),
      -1,
      true,
    );
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: active ? 0.42 + pulse.value * 0.48 : 0.36,
    transform: [{ scale: 0.9 + pulse.value * 0.16 }],
  }));

  return (
    <PrototypeCard id="editorial-empty-state" active={active} title="Operational empty state">
      <View style={styles.emptyPanel}>
        <View style={styles.emptyRoute}>
          <Animated.View style={[styles.emptyDot, dotStyle]} />
          <View style={styles.emptyLine} />
          <View style={styles.emptyDotStatic} />
        </View>
        <Text style={styles.emptyTitle}>Nessun volo visibile</Text>
        <Text style={styles.emptyCopy}>
          Mostra quale provider ha risposto, cosa e stato filtrato e quando riprovare.
        </Text>
      </View>
    </PrototypeCard>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
    backgroundColor: '#030A0D',
  },
  compactRoot: {
    flex: 0,
  },
  root: {
    flex: 1,
    backgroundColor: '#030A0D',
  },
  scrollContent: {
    padding: 16,
  },
  shell: {
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.24)',
    padding: 16,
    gap: 16,
    overflow: 'hidden',
  },
  shellCompact: {
    borderRadius: 24,
    padding: 14,
  },
  scanTexture: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(45,212,191,0.025)',
  },
  hero: {
    gap: 6,
  },
  kicker: {
    color: 'rgba(153,246,228,0.66)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  title: {
    color: '#F1FBFB',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1,
  },
  copy: {
    color: 'rgba(188,210,216,0.78)',
    fontSize: 13,
    lineHeight: 19,
  },
  selectorGrid: {
    gap: 8,
  },
  patternButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.14)',
    backgroundColor: 'rgba(2,8,12,0.48)',
    borderRadius: 18,
    padding: 11,
  },
  patternButtonActive: {
    borderColor: 'rgba(153,246,228,0.62)',
    backgroundColor: 'rgba(45,212,191,0.14)',
  },
  patternText: {
    flex: 1,
    gap: 2,
  },
  patternTitle: {
    color: '#D9EEEE',
    fontSize: 13,
    fontWeight: '900',
  },
  patternTitleActive: {
    color: '#99F6E4',
  },
  patternSummary: {
    color: 'rgba(167,186,194,0.76)',
    fontSize: 11,
    lineHeight: 15,
  },
  patternGrid: {
    gap: 12,
  },
  prototypeCard: {
    borderWidth: 1,
    borderRadius: 24,
    backgroundColor: 'rgba(2,8,12,0.62)',
    padding: 13,
    gap: 12,
    shadowColor: '#2DD4BF',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  prototypeHeader: {
    gap: 2,
  },
  prototypeKicker: {
    color: 'rgba(94,234,212,0.64)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  prototypeTitle: {
    color: '#F1FBFB',
    fontSize: 16,
    fontWeight: '900',
  },
  navShell: {
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.18)',
    borderRadius: 24,
    backgroundColor: 'rgba(1,10,12,0.82)',
    padding: 8,
    overflow: 'hidden',
  },
  navIndicator: {
    position: 'absolute',
    left: 8,
    top: 8,
    bottom: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(20,184,166,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(103,232,249,0.68)',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 62,
    gap: 4,
  },
  navLabel: {
    color: '#6F8D96',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  navLabelActive: {
    color: '#67E8F9',
  },
  miniControl: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.24)',
    backgroundColor: 'rgba(45,212,191,0.10)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  miniControlText: {
    color: '#99F6E4',
    fontSize: 11,
    fontWeight: '900',
  },
  drawerPanel: {
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.18)',
    borderRadius: 20,
    backgroundColor: 'rgba(7,20,20,0.86)',
    padding: 10,
    gap: 8,
  },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.035)',
    overflow: 'hidden',
  },
  drawerRail: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: '#2DD4BF',
    marginRight: 10,
  },
  drawerIndex: {
    color: 'rgba(153,246,228,0.50)',
    fontSize: 10,
    fontWeight: '900',
    marginRight: 10,
  },
  drawerLabel: {
    color: '#EAF4F4',
    fontSize: 13,
    fontWeight: '900',
  },
  flightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: 'rgba(45,212,191,0.20)',
    borderLeftColor: '#FB923C',
    borderRadius: 20,
    padding: 13,
  },
  flightNumber: {
    color: '#FDBA74',
    fontSize: 24,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  flightMeta: {
    color: 'rgba(188,210,216,0.74)',
    fontSize: 12,
    fontWeight: '800',
  },
  timeBlock: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  timeLabel: {
    color: 'rgba(188,210,216,0.64)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  timeValue: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  statePill: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.20)',
    backgroundColor: 'rgba(15,23,42,0.68)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statePillLive: {
    borderColor: 'rgba(16,185,129,0.42)',
    backgroundColor: 'rgba(16,185,129,0.14)',
  },
  statePillText: {
    color: 'rgba(203,213,225,0.62)',
    fontSize: 9,
    fontWeight: '900',
  },
  statePillTextLive: {
    color: '#34D399',
  },
  cachePanel: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.18)',
    backgroundColor: 'rgba(4,16,18,0.82)',
    overflow: 'hidden',
    padding: 13,
    gap: 13,
  },
  scanBeam: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 90,
    backgroundColor: 'rgba(153,246,228,0.16)',
    transform: [{ skewX: '-16deg' }],
  },
  cacheHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cacheTitle: {
    color: '#99F6E4',
    fontSize: 13,
    fontWeight: '900',
  },
  cacheRows: {
    gap: 8,
  },
  cacheRow: {
    height: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.16)',
  },
  pressPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(153,246,228,0.26)',
    backgroundColor: 'rgba(45,212,191,0.10)',
    padding: 14,
    shadowColor: '#2DD4BF',
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  pressTextBlock: {
    flex: 1,
    gap: 2,
  },
  pressTitle: {
    color: '#F1FBFB',
    fontSize: 16,
    fontWeight: '900',
  },
  pressCopy: {
    color: 'rgba(188,210,216,0.74)',
    fontSize: 12,
    lineHeight: 17,
  },
  emptyPanel: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    backgroundColor: 'rgba(15,23,42,0.34)',
    padding: 16,
    gap: 10,
  },
  emptyRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 130,
  },
  emptyDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#5EEAD4',
    backgroundColor: 'rgba(94,234,212,0.18)',
  },
  emptyLine: {
    flex: 1,
    height: 1,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.42)',
  },
  emptyDotStatic: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(148,163,184,0.38)',
  },
  emptyTitle: {
    color: '#F1FBFB',
    fontSize: 17,
    fontWeight: '900',
  },
  emptyCopy: {
    color: 'rgba(188,210,216,0.74)',
    fontSize: 12,
    lineHeight: 18,
  },
});
