import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, StatusBar, PanResponder, Animated, Dimensions, BackHandler, ActivityIndicator, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView as ExpoBlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeProvider, useAppTheme } from './src/context/ThemeContext';
import { LanguageProvider, useLanguage } from './src/context/LanguageContext';
import { AirportProvider } from './src/context/AirportContext';
import { saveThemeWidgetSnapshot } from './src/utils/themeMode';
import { refreshShiftWidgetTheme } from './src/widgets/widgetThemeSync';
import HomeScreen from './src/screens/HomeScreen';
import TraveldocScreen from './src/screens/TraveldocScreen';
import FlightScreen from './src/screens/FlightScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import NotepadScreen from './src/screens/NotepadScreen';
import ManualsScreen from './src/screens/ManualsScreen';
import PhonebookScreen from './src/screens/PhonebookScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PasswordScreen from './src/screens/PasswordScreen';
import ArionInboxScreen from './src/screens/ArionInboxScreen';
import PrintableCalendarScreen from './src/screens/PrintableCalendarScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import DrawerMenu from './src/components/DrawerMenu';
import AppTabBar, { type AppTabBarItem, type AppTabId } from './src/components/AppTabBar';
import ProfileSwitcherModal from './src/components/ProfileSwitcherModal';
import TactilePressable from './src/components/motion/TactilePressable';
import {
  installGlobalCrashHandler,
  markRuntimeStartupCompleted,
} from './src/utils/runtimeDiagnostics';
import { autoScheduleNotifications } from './src/utils/autoNotifications';
import { checkForUpdate, wasUpdateSeen, markUpdateSeen, type UpdateInfo } from './src/utils/updateChecker';
import UpdateModal from './src/components/UpdateModal';
import { useAirport } from './src/context/AirportContext';
import {
  motionDurations,
  motionEasing,
  motionRecipeDurations,
  motionRecipeSprings,
  useReducedMotionPreference,
} from './src/utils/motion';
import { ONBOARDING_SETUP_STORAGE_KEY, shouldShowOnboarding } from './src/utils/appSetup';
import { SPACING, RADIUS } from './src/theme/spacing';
import { devLog } from './src/utils/devLog';

installGlobalCrashHandler();

type Tab = AppTabId;
type OverlayScreen = 'Notepad' | 'Phonebook' | 'Passwords' | 'Manuals' | 'ArionInbox' | 'PrintableCalendar' | 'Settings' | 'Onboarding' | null;
type SettingsInitialModal = 'providers' | 'debug' | null;

const TABS: AppTabBarItem[] = [
  { id: 'Shifts',    icon: 'home',           label: 'Home'     },
  { id: 'Calendar', icon: 'table-rows',      label: 'Turni'    },
  { id: 'Flights',  icon: 'flight-takeoff',  label: 'Voli'     },
  { id: 'TravelDoc',icon: 'description',     label: 'TravelDoc'},
];

const FOOTER_SWIPE_START_DISTANCE = 12;
const FOOTER_SWIPE_DIRECTION_BIAS = 1.25;
const FOOTER_SWIPE_SWITCH_DISTANCE_RATIO = 0.14;
const FOOTER_SWIPE_SWITCH_VELOCITY = 0.5;

// ─── Inner app (inside ThemeProvider) ────────────────────────────────────────
function AppInner() {
  const { colors, mode } = useAppTheme();
  const { t } = useLanguage();
  const { profileInitials } = useAirport();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotionPreference();
  const [activeTab, setActiveTab]   = useState<Tab>('Shifts');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [overlay, setOverlay]       = useState<OverlayScreen>(null);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [settingsInitialModal, setSettingsInitialModal] = useState<SettingsInitialModal>(null);

  const tabLabels: Record<Tab, string> = {
    Shifts: t('tabHome'), Calendar: t('tabShifts'), Flights: t('tabFlights'), TravelDoc: t('tabTravelDoc'),
  };
  const overlayTitles: Record<NonNullable<OverlayScreen>, string> = {
    Notepad: t('overlayNotepad'), Phonebook: t('overlayPhonebook'),
    Passwords: t('overlayPasswords'), Manuals: t('overlayManuals'), ArionInbox: t('overlayArionInbox'),
    PrintableCalendar: t('overlayPrintableCalendar'), Settings: t('overlaySettings'),
    Onboarding: 'Setup guidato',
  };

  const handleDrawerSelect = (id: string) => setOverlay(id as OverlayScreen);
  const handleBack = () => setOverlay(null);

  // ─── Auto-schedule flight notifications on startup ─────────────────────────
  useEffect(() => {
    markRuntimeStartupCompleted().catch(() => {});

    autoScheduleNotifications().then(count => {
      if (count > 0) devLog(`Auto-scheduled ${count} notifications`);
    }).catch(() => {});
    // Check for updates; show modal once per new version
    checkForUpdate().then(async info => {
      if (!info?.available) return;
      const seen = await wasUpdateSeen(info.latestVersion);
      if (!seen) setPendingUpdate(info);
    }).catch(() => {});

    AsyncStorage.getItem(ONBOARDING_SETUP_STORAGE_KEY)
      .then(value => {
        if (shouldShowOnboarding(value)) {
          setOverlay(current => current ?? 'Onboarding');
        }
      })
      .catch(() => {});

  }, []);

  // ─── Sincronizzazione tema widget all'avvio/ripristino ───────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        saveThemeWidgetSnapshot(mode, colors)
          .then(() => {
            refreshShiftWidgetTheme(mode).catch(() => {});
          })
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, [colors, mode]);

  // ─── Swipe con drag live tra tab ─────────────────────────────────────────────
  const SCREEN_W = Dimensions.get('window').width;
  const offsetX = useRef(new Animated.Value(0)).current;
  const activeIdxRef = useRef(0);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const navigationProgress = useMemo(() => offsetX.interpolate({
    inputRange: TABS.map((_, i) => -i * SCREEN_W).reverse(),
    outputRange: TABS.map((_, i) => i).reverse(),
    extrapolate: 'clamp',
  }), [offsetX, SCREEN_W]);

  const setTabIndex = useCallback((newIdx: number) => {
    activeIdxRef.current = newIdx;
    setActiveTab(TABS[newIdx].id);
  }, []);

  const goToTabTransition = useCallback((targetOffset: number, animated = true, onComplete?: () => void) => {
    if (!animated) {
      offsetX.setValue(targetOffset);
      onComplete?.();
      return;
    }

    if (reducedMotion) {
      Animated.timing(offsetX, {
        toValue: targetOffset,
        duration: motionDurations.instant,
        easing: motionEasing.board,
        useNativeDriver: true,
      }).start(({ finished }) => { if (finished) onComplete?.(); });
      return;
    }

    Animated.spring(offsetX, {
      toValue: targetOffset,
      ...motionRecipeSprings.panel,
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) onComplete?.(); });
  }, [offsetX, reducedMotion]);

  const goToTab = useCallback((newIdx: number, animated = true) => {
    setTabIndex(newIdx);
    const targetOffset = -newIdx * SCREEN_W;
    goToTabTransition(targetOffset, animated);
  }, [SCREEN_W, goToTabTransition, setTabIndex]);

  // ─── Android back button: overlay/drawer → close, tab secondaria → home ─────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerOpen) { setDrawerOpen(false); return true; }
      if (overlay) { setOverlay(null); return true; }
      if (activeTab !== 'Shifts') { goToTab(0); return true; }
      return false; // il comportamento di sistema chiude l'app solo dalla Home
    });
    return () => sub.remove();
  }, [activeTab, drawerOpen, goToTab, overlay]);

  const settleCurrentTab = useCallback((idx: number) => {
    const targetOffset = -idx * SCREEN_W;
    goToTabTransition(targetOffset, true);
  }, [SCREEN_W, goToTabTransition]);

  const swipePan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > FOOTER_SWIPE_START_DISTANCE &&
      Math.abs(g.dx) > Math.abs(g.dy) * FOOTER_SWIPE_DIRECTION_BIAS,
    onPanResponderMove: (_, g) => {
      if (overlayRef.current) return;
      const idx = activeIdxRef.current;
      const base = -idx * SCREEN_W;
      if (g.dx > 0 && idx === 0) return offsetX.setValue(base);
      if (g.dx < 0 && idx === TABS.length - 1) return offsetX.setValue(base);
      offsetX.setValue(base + g.dx);
    },
    onPanResponderRelease: (_, g) => {
      if (overlayRef.current) return;
      const idx = activeIdxRef.current;
      const threshold = SCREEN_W * FOOTER_SWIPE_SWITCH_DISTANCE_RATIO;
      const shouldMoveNext = g.dx < -threshold || g.vx < -FOOTER_SWIPE_SWITCH_VELOCITY;
      const shouldMovePrevious = g.dx > threshold || g.vx > FOOTER_SWIPE_SWITCH_VELOCITY;

      if (shouldMoveNext && idx < TABS.length - 1) {
        Animated.timing(offsetX, {
          toValue: -(idx + 1) * SCREEN_W,
          duration: reducedMotion ? motionDurations.instant : motionRecipeDurations.snap,
          easing: motionEasing.board,
          useNativeDriver: true,
        }).start(() => goToTab(idx + 1, false));
      } else if (shouldMovePrevious && idx > 0) {
        Animated.timing(offsetX, {
          toValue: -(idx - 1) * SCREEN_W,
          duration: reducedMotion ? motionDurations.instant : motionRecipeDurations.snap,
          easing: motionEasing.board,
          useNativeDriver: true,
        }).start(() => goToTab(idx - 1, false));
      } else {
        settleCurrentTab(idx);
      }
    },
  }), [goToTab, offsetX, reducedMotion, SCREEN_W, settleCurrentTab]);

  const renderOverlay = () => {
    if (overlay === 'Notepad')   return <NotepadScreen />;
    if (overlay === 'Phonebook') return <PhonebookScreen />;
    if (overlay === 'Passwords') return <PasswordScreen />;
    if (overlay === 'Manuals')   return <ManualsScreen />;
    if (overlay === 'ArionInbox') return <ArionInboxScreen />;
    if (overlay === 'PrintableCalendar') return <PrintableCalendarScreen />;
    if (overlay === 'Settings')  return (
      <SettingsScreen
        initialModal={settingsInitialModal}
        onInitialModalConsumed={() => setSettingsInitialModal(null)}
        onOpenOnboarding={() => setOverlay('Onboarding')}
      />
    );
    if (overlay === 'Onboarding') return (
      <OnboardingScreen
        onComplete={() => setOverlay(null)}
        onOpenProfiles={() => setProfileModalOpen(true)}
        onOpenFlightApis={() => {
          setSettingsInitialModal('providers');
          setOverlay('Settings');
        }}
        onOpenSettings={() => setOverlay('Settings')}
      />
    );
    return null;
  };

  const renderTabScreen = (tab: Tab) => {
    switch (tab) {
      case 'Shifts':    return <HomeScreen isFocused={activeTab === 'Shifts'} />;
      case 'Calendar':  return <CalendarScreen isFocused={activeTab === 'Calendar'} />;
      case 'Flights':   return <FlightScreen isFocused={activeTab === 'Flights'} />;
      case 'TravelDoc': return <TraveldocScreen isFocused={activeTab === 'TravelDoc'} />;
    }
  };


  const appBarTitle = overlay ? overlayTitles[overlay] : 'AeroStaff Pro';
  const surfaceVariant = 'app';
  const activeTabIndex = TABS.findIndex(tab => tab.id === activeTab);
  const tabInactiveColor = colors.tabIconInactive;
  const topInset = Math.max(insets.top, StatusBar.currentHeight ?? 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={colors.statusBar}
        backgroundColor="transparent"
        translucent
      />

      {/* Top App Bar */}
      <ExpoBlurView
        intensity={colors.isDark ? 60 : 50}
        tint={colors.isDark ? 'dark' : 'light'}
        style={[
          styles.appBar,
          {
            paddingTop: topInset + 10,
            borderBottomColor: colors.glassBorder,
          },
        ]}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.appBar }]} />
        {overlay ? (
          <TactilePressable onPress={handleBack} animatedStyle={styles.iconBtn} depth={2} pressedScale={0.94} haptic="selection" accessibilityRole="button" accessibilityLabel={t('a11yBack')}>
            <MaterialIcons name="arrow-back" size={22} color={colors.primaryDark} />
          </TactilePressable>
        ) : (
          <TactilePressable onPress={() => setDrawerOpen(true)} animatedStyle={styles.iconBtn} depth={2} pressedScale={0.94} haptic="selection" accessibilityRole="button" accessibilityLabel={t('a11yOpenMenu')}>
            <MaterialIcons name="menu" size={24} color={colors.primaryDark} />
          </TactilePressable>
        )}
        <View style={styles.titleRow}>
          <Text style={[styles.appBarTitle, { color: colors.text }]}>{appBarTitle}</Text>
        </View>
        <TactilePressable onPress={() => setProfileModalOpen(true)} depth={1} pressedScale={0.96} haptic="selection" accessibilityRole="button" accessibilityLabel={t('a11yOpenProfile')}>
          <View style={[styles.avatar, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}>
            <Text style={[styles.avatarText, { color: colors.primaryText }]}>{profileInitials}</Text>
          </View>
        </TactilePressable>
      </ExpoBlurView>

      {/* Screen Content */}
      <View style={[styles.content, { backgroundColor: colors.bg, overflow: 'hidden' }]}>
        {overlay ? renderOverlay() : TABS.map((tab, i) => (
          <Animated.View
            key={tab.id}
            style={[StyleSheet.absoluteFill, { transform: [{ translateX: Animated.add(offsetX, i * SCREEN_W) }] }]}
          >
            {(tab.id === 'TravelDoc'
              ? activeTab === 'TravelDoc'
              : Math.abs(i - activeTabIndex) <= 1)
              ? renderTabScreen(tab.id)
              : null}
          </Animated.View>
        ))}
      </View>

      {/* Floating navigation, hidden on overlay screens. */}
      {!overlay && (
        <View style={[styles.tabBarWrapper, { bottom: Math.max(insets.bottom, 12) }]} {...swipePan.panHandlers}>
          <AppTabBar
            tabs={TABS.map(tab => ({ ...tab, label: tabLabels[tab.id] }))}
            activeTab={activeTab}
            activeColor={colors.tabIconActive}
            inactiveColor={tabInactiveColor}
            isDark={colors.isDark}
            variant={surfaceVariant}
            navigationProgress={navigationProgress}
            onPress={(_, index) => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              goToTab(index);
            }}
          />
        </View>
      )}

      {/* Drawer */}
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelect={handleDrawerSelect}
        surfaceVariant={surfaceVariant}
      />
      <ProfileSwitcherModal
        visible={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
      />
      {pendingUpdate && (
        <UpdateModal
          info={pendingUpdate}
          onDismiss={() => {
            markUpdateSeen(pendingUpdate.latestVersion).catch(() => {});
            setPendingUpdate(null);
          }}
        />
      )}
    </View>
  );
}

function ThemeBootScreen() {
  return (
    <View style={styles.bootRoot}>
      <StatusBar barStyle="light-content" backgroundColor="#0B1114" />
      <View style={styles.bootMark}>
        <MaterialIcons name="flight-takeoff" size={28} color="#2DD4BF" />
      </View>
      <ActivityIndicator color="#2DD4BF" />
    </View>
  );
}

function ThemedAppGate() {
  const { isLoading } = useAppTheme();

  if (isLoading) {
    return <ThemeBootScreen />;
  }

  return <AppInner />;
}

// ─── Root export con ThemeProvider ───────────────────────────────────────────
export default function App() {
  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AirportProvider>
            <LanguageProvider>
              <ThemedAppGate />
            </LanguageProvider>
          </AirportProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  root: {
    flex: 1,
    paddingTop: 0,
  },
  bootRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    backgroundColor: '#0B1114',
  },
  bootMark: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(45, 212, 191, 0.34)',
    backgroundColor: 'rgba(45, 212, 191, 0.12)',
  },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingBottom: 10,
    borderBottomWidth: 1,
    overflow: 'hidden',
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, marginRight: 6 },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  appBarTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.5, flexShrink: 1 },
  avatar: {
    width: 44, height: 44, borderRadius: 16, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
  },
  avatarText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  content: { flex: 1 },
  tabBarWrapper: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
});
