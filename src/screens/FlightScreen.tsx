import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Modal, ScrollView,
  FlatList, TouchableOpacity, RefreshControl, Image,
  Animated, PanResponder, NativeModules, Platform, Switch, Linking,
} from 'react-native';
import { Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import BoardReveal from '../components/motion/BoardReveal';
import CockpitFlightProgress from '../components/motion/CockpitFlightProgress';
import TactilePressable from '../components/motion/TactilePressable';
import ValueChangeFlash from '../components/motion/ValueChangeFlash';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useAirport } from '../context/AirportContext';
import { getAirlineOps, getAirlineColor, AIRLINE_COLORS, AIRLINE_DISPLAY_NAMES } from '../utils/airlineOps';
import { fetchAirportScheduleRaw } from '../utils/fr24api';
import { fetchStaffMonitorData, normalizeFlightNumber, type StaffMonitorFlight } from '../utils/staffMonitor';
import { formatAirportHeader, getAirportAirlines, getStoredAirportAirlines } from '../utils/airportSettings';
import { WIDGET_CACHE_KEY, WIDGET_SHIFT_KEY } from '../widgets/widgetTaskHandler';
import type { WidgetData, WidgetFlight, WidgetShiftData } from '../widgets/widgetTaskHandler';
import { requestShiftWidgetUpdate } from '../widgets/widgetThemeSync';
import { useLanguage } from '../context/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { dismissPinnedFlightNotification, showOrUpdatePinnedFlightNotification } from '../utils/pinnedFlightOngoingNotification';
import { getBestArrivalTs, getBestDepartureTs } from '../utils/flightTimes';
import {
  compareFlightsChronologically,
  filterFlightsByAirlines,
  getFlightAirportLabel,
  getFlightMergeKey,
  isFlightAirlineMatch,
  mergeFlightLists,
  pruneExpiredFlights,
} from '../utils/flightScheduleAdapter';
import {
  loadFlightScreenCache,
  saveFlightScreenCache,
} from '../utils/flightScreenCache';
import { triggerMotionHaptic } from '../utils/motion';
import {
  appendNotificationDebugEvent,
  buildNotificationData,
  cancelAeroStaffScheduledNotifications,
  dedupeAeroStaffScheduledNotifications,
  NOTIF_ENABLED_KEY,
  NOTIF_IDS_KEY,
  NOTIF_SETTINGS_KEY,
  PINNED_NOTIF_IDS_KEY,
  runNotificationScheduleExclusive,
} from '../utils/notificationDiagnostics';

const WearDataSender = Platform.OS === 'android' ? NativeModules.WearDataSender : null;

const PINNED_FLIGHT_KEY = 'pinned_flight_v1';
const FLIGHT_FILTER_KEY = 'aerostaff_flight_filter_v1';
const MIN_NOTIF_MINUTES = 1;
const MAX_NOTIF_MINUTES = 90;
type FlightAlertTone = 'success' | 'warning' | 'info';
type FlightDataSourceState = {
  sourceLabel: string;
  fetchedAt: number;
};

type FlightNotificationSettings = {
  onlyTrackedAirlines: boolean;
  includeArrivals: boolean;
  includeDepartures: boolean;
  includeShiftEnd: boolean;
  sticky: boolean;
  arrivalLeadMinutes: number;
  departureLeadMinutes: number;
};

const DEFAULT_NOTIFICATION_SETTINGS: FlightNotificationSettings = {
  onlyTrackedAirlines: true,
  includeArrivals: true,
  includeDepartures: false,
  includeShiftEnd: true,
  sticky: false,
  arrivalLeadMinutes: 15,
  departureLeadMinutes: 10,
};

function normalizeAirlineKey(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

function buildFlightradar24FlightUrl(flightNumber: string): string | null {
  // FR24 expects the published flight number. Do not use StaffMonitor's
  // normalizer here: it intentionally strips leading zeros for table matching.
  const normalized = flightNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').toLowerCase();
  if (!normalized || normalized === 'na') return null;
  return `https://www.flightradar24.com/data/flights/${normalized}`;
}

async function openFlightradar24Flight(flightNumber: string): Promise<void> {
  const url = buildFlightradar24FlightUrl(flightNumber);
  if (!url) return;
  await Linking.openURL(url);
}

function sanitizeNotificationSettings(value: unknown): FlightNotificationSettings {
  const raw = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
  const num = (field: string, fallback: number) => {
    const v = raw[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return clamp(Math.round(v), MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES);
  };

  return {
    onlyTrackedAirlines: typeof raw.onlyTrackedAirlines === 'boolean'
      ? raw.onlyTrackedAirlines
      : DEFAULT_NOTIFICATION_SETTINGS.onlyTrackedAirlines,
    includeArrivals: typeof raw.includeArrivals === 'boolean'
      ? raw.includeArrivals
      : DEFAULT_NOTIFICATION_SETTINGS.includeArrivals,
    includeDepartures: typeof raw.includeDepartures === 'boolean'
      ? raw.includeDepartures
      : DEFAULT_NOTIFICATION_SETTINGS.includeDepartures,
    includeShiftEnd: typeof raw.includeShiftEnd === 'boolean'
      ? raw.includeShiftEnd
      : DEFAULT_NOTIFICATION_SETTINGS.includeShiftEnd,
    sticky: typeof raw.sticky === 'boolean'
      ? raw.sticky
      : DEFAULT_NOTIFICATION_SETTINGS.sticky,
    arrivalLeadMinutes: num('arrivalLeadMinutes', DEFAULT_NOTIFICATION_SETTINGS.arrivalLeadMinutes),
    departureLeadMinutes: num('departureLeadMinutes', DEFAULT_NOTIFICATION_SETTINGS.departureLeadMinutes),
  };
}

function shouldNotifyAirline(
  item: any,
  settings: FlightNotificationSettings,
  selectedAirlines: string[],
): boolean {
  if (!settings.onlyTrackedAirlines || selectedAirlines.length === 0) {
    return true;
  }
  return selectedAirlines.some(key => isFlightAirlineMatch(item, key));
}

function sameAirlineKeys(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const AIRLINE_IATA_CODES: Record<string, string> = {
  'ryanair': 'FR',
  'easyjet': 'U2',
  'wizz': 'W6',
  'volotea': 'V7',
  'vueling': 'VY',
  'transavia': 'TO',
  'aer lingus': 'EI',
  'british airways': 'BA',
  'sas': 'SK',
  'scandinavian': 'SK',
  'flydubai': 'FZ',
  'aeroitalia': 'XZ',
  'air arabia maroc': '3O',
  'air arabia': 'G9',
  'air dolomiti': 'EN',
  'buzz': 'RR',
  'dhl': 'QY',
  'eurowings': 'EW',
  'ita airways': 'AZ',
  'lufthansa': 'LH',
};

const FALLBACK_BRAND_COLORS = [
  '#2563EB',
  '#0EA5E9',
  '#06B6D4',
  '#14B8A6',
  '#22C55E',
  '#84CC16',
  '#F59E0B',
  '#F97316',
  '#D946EF',
  '#8B5CF6',
] as const;

function stableBrandColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return FALLBACK_BRAND_COLORS[Math.abs(hash) % FALLBACK_BRAND_COLORS.length];
}

function getAirlineBrandColor(key: string, label: string): string {
  const normalized = normalizeAirlineKey(`${key} ${label}`);
  for (const [needle, color] of Object.entries(AIRLINE_COLORS)) {
    if (normalized.includes(needle)) {
      return color;
    }
  }
  return stableBrandColor(normalized || key || label);
}

function getAirlineIataCode(key: string, label: string): string {
  const normalized = normalizeAirlineKey(`${key} ${label}`);
  for (const [needle, code] of Object.entries(AIRLINE_IATA_CODES)) {
    if (normalized.includes(needle)) {
      return code;
    }
  }
  return '';
}

function getAirlineMonogram(label: string): string {
  const words = label
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '??';
  }
  return words
    .slice(0, 2)
    .map(part => part[0] ?? '')
    .join('')
    .toUpperCase()
    .padEnd(2, '?')
    .slice(0, 2);
}

function prettifyAirlineLabel(key: string): string {
  return key.replace(/\b\w/g, ch => ch.toUpperCase());
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.trim().replace('#', '');
  const normalized = raw.length === 3
    ? raw.split('').map(ch => ch + ch).join('')
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(37,99,235,${alpha})`;
  }
  const int = parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function mixHexColor(hex: string, target: string, amount: number): string {
  const parse = (value: string) => {
    const raw = value.trim().replace('#', '');
    const normalized = raw.length === 3
      ? raw.split('').map(ch => ch + ch).join('')
      : raw;
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
    const int = parseInt(normalized, 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255,
    };
  };
  const base = parse(hex);
  const mix = parse(target);
  if (!base || !mix) return hex;
  const clampAmount = clamp(amount, 0, 1);
  const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  const r = base.r + (mix.r - base.r) * clampAmount;
  const g = base.g + (mix.g - base.g) * clampAmount;
  const b = base.b + (mix.b - base.b) * clampAmount;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Handler: mostra notifiche anche con app aperta (wrapped for Expo Go compat)
try { Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
}); } catch (e) { if (__DEV__) console.warn('[notifHandler]', e); }


function LogoPill({ iataCode, airlineName, color }: { iataCode: string; airlineName: string; color: string }) {
  const [err, setErr] = useState(false);
  const uri = `https://pics.avs.io/160/60/${(iataCode || '').toUpperCase()}.png`;
  const initials = airlineName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  if (iataCode && !err) {
    return (
      <View style={{ width: 52, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.9)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <Image source={{ uri }} style={{ width: 44, height: 26 }} resizeMode="contain" onError={() => setErr(true)} />
      </View>
    );
  }
  return (
    <View style={{ width: 52, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.9)', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color, fontWeight: '800', fontSize: 11 }}>{initials}</Text>
    </View>
  );
}

function AirlineFilterLogo({
  iataCode,
  label,
  color,
}: {
  iataCode: string;
  label: string;
  color: string;
}) {
  const [err, setErr] = useState(false);
  const logoUri = iataCode ? `https://pics.avs.io/160/60/${iataCode.toUpperCase()}.png` : '';
  const monogram = getAirlineMonogram(label);
  if (iataCode && !err) {
    return (
      <View style={{ width: 44, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.94)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <Image source={{ uri: logoUri }} style={{ width: 38, height: 24 }} resizeMode="contain" onError={() => setErr(true)} />
      </View>
    );
  }

  return (
    <View style={{ width: 44, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.94)', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color, fontWeight: '900', fontSize: 12, letterSpacing: 0.4 }}>{monogram}</Text>
    </View>
  );
}

const SWIPE_THRESHOLD = 80;
const SWIPE_TRIGGER_VELOCITY = 0.5;
const SWIPE_MAX_TRANSLATE = 96;
const SWIPE_DRAG_RESISTANCE = 0.82;

function SwipeableFlightCardComponent({
  children, isPinned, onToggle,
}: {
  children: React.ReactNode;
  isPinned: boolean;
  onToggle: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const dragScale = useMemo(() => translateX.interpolate({
    inputRange: [-SWIPE_MAX_TRANSLATE, 0],
    outputRange: [0.985, 1],
    extrapolate: 'clamp',
  }), [translateX]);

  const animateBack = useCallback((velocity = 0) => {
    Animated.spring(translateX, {
      toValue: 0,
      velocity,
      damping: 20,
      stiffness: 185,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > 15 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_, g) => {
      const nextTranslate = g.dx < 0
        ? Math.max(g.dx * SWIPE_DRAG_RESISTANCE, -SWIPE_MAX_TRANSLATE)
        : g.dx * 0.08;
      translateX.setValue(nextTranslate);
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -SWIPE_THRESHOLD || g.vx < -SWIPE_TRIGGER_VELOCITY) {
        Animated.timing(translateX, {
          toValue: -SWIPE_MAX_TRANSLATE,
          duration: 170,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          triggerMotionHaptic(isPinned ? 'light' : 'medium').catch(() => {});
          onToggleRef.current();
          animateBack();
        });
      } else {
        animateBack(g.vx);
      }
    },
    onPanResponderTerminate: () => {
      animateBack();
    },
  }), [animateBack, translateX]);

  return (
    <View style={{ marginBottom: 18 }}>
      <Animated.View style={{ transform: [{ translateX }, { scale: dragScale }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

// Performance optimization: memoize flatlist item to prevent unnecessary re-renders
const SwipeableFlightCard = React.memo(SwipeableFlightCardComponent);

// ─── FlightRow ────────────────────────────────────────────────────────────────
interface FlightRowProps {
  item: any;
  index: number;
  activeTab: 'arrivals' | 'departures';
  userShift: { start: number; end: number } | null;
  pinnedFlightId: string | null;
  onPin: (item: any) => void;
  onUnpin: () => void;
  inboundArrivals: Record<string, number>;
  colors: ThemeColors;
  isOperations: boolean;
  s: ReturnType<typeof makeStyles>;
  smPool: StaffMonitorFlight[];
  locale: string;
  t: (key: TranslationKey) => string;
}

function FlightRowComponent({ item, index, activeTab, userShift, pinnedFlightId, onPin, onUnpin, inboundArrivals, colors, isOperations, s, smPool, locale, t }: FlightRowProps) {
  const flightNumber = item.flight?.identification?.number?.default || 'N/A';
  const airline = item.flight?.airline?.name || 'Sconosciuta';
  const iataCode = item.flight?.airline?.code?.iata || '';
  const statusText = item.flight?.status?.text || 'Scheduled';
  const raw = item.flight?.status?.generic?.status?.color || 'gray';
  const statusColor = raw === 'green' ? '#10b981' : raw === 'red' ? '#ef4444' : raw === 'yellow' ? '#f59e0b' : '#6b7280';
  const originDest = activeTab === 'arrivals'
    ? (item.flight?.airport?.origin?.name || item.flight?.airport?.origin?.code?.iata || 'N/A')
    : (item.flight?.airport?.destination?.name || item.flight?.airport?.destination?.code?.iata || 'N/A');
  const ts = activeTab === 'arrivals' ? item.flight?.time?.scheduled?.arrival : item.flight?.time?.scheduled?.departure;
  const time = ts ? new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : 'N/A';
  const duringShift = userShift && ts && (() => {
    if (activeTab === 'arrivals') return ts >= userShift.start && ts <= userShift.end;
    const opsData = getAirlineOps(airline);
    const ciOpen = ts - opsData.checkInOpen * 60;
    const ciClose = ts - opsData.checkInClose * 60;
    const gOpen = ts - opsData.gateOpen * 60;
    const gClose = ts - opsData.gateClose * 60;
    const ciOverlap = ciOpen <= userShift.end && ciClose >= userShift.start;
    const gateOverlap = gOpen <= userShift.end && gClose >= userShift.start;
    return ciOverlap || gateOverlap;
  })();
  const color = getAirlineColor(airline);
  const brandAccent = isOperations ? mixHexColor(color, '#FFFFFF', 0.34) : color;
  const airlineTint = hexToRgba(brandAccent, isOperations ? 0.20 : 0.14);
  const airlineTintStrong = hexToRgba(brandAccent, isOperations ? 0.42 : 0.22);
  const airlineBorder = hexToRgba(brandAccent, isOperations ? 0.62 : 0.36);
  const ops = activeTab === 'departures' && ts ? getAirlineOps(airline) : null;
  const fmt = (offsetMin: number) =>
    ts ? new Date((ts - offsetMin * 60) * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
  const fmtTs = (t: number) =>
    new Date(t * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const reg = item.flight?.aircraft?.registration;
  const inboundTs = reg ? inboundArrivals[reg] : undefined;
  const gateOpenFromInbound = activeTab === 'departures' && ts && inboundTs ? inboundTs : undefined;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const [nowTs, setNowTs] = useState(() => Date.now() / 1000);

  const flightId = item.flight?.identification?.number?.default || null;
  const isPinned = flightId !== null && flightId === pinnedFlightId;

  const normFn = normalizeFlightNumber(flightNumber);
  const normalizeForMatching = (s: string) => s.replace(/[\s\-_]/g, '').toUpperCase();
  const normFnStripped = normalizeForMatching(normFn);
  const smFlight =
    smPool.find(sm => sm.flightNumber === normFn) ??
    smPool.find(sm => normalizeForMatching(sm.flightNumber) === normFnStripped);
  const operational = item.flight?._operational ?? {};
  const terminalGate = (terminal?: string, gate?: string) => {
    if (terminal && gate) return `${terminal}/${gate}`;
    return gate ?? terminal ?? '—';
  };
  const standLabel = smFlight?.stand ?? operational.stand ?? '—';
  const checkinLabel = smFlight?.checkin ?? operational.checkin ?? '—';
  const gateLabel = smFlight?.gate ?? terminalGate(operational.departureTerminal, operational.departureGate);
  const beltLabel = smFlight?.belt ?? operational.belt ?? '—';

  const arrivalProgress = activeTab === 'arrivals' && ts ? (() => {
    const scheduledDep = item.flight?.time?.scheduled?.departure;
    const estimatedDep = item.flight?.time?.estimated?.departure;
    const realDep = item.flight?.time?.real?.departure;
    const estimatedArr = item.flight?.time?.estimated?.arrival;
    const realArr = item.flight?.time?.real?.arrival;
    const startTs = realDep || estimatedDep || scheduledDep;
    const endTs = realArr || estimatedArr || ts;
    if (!startTs || !endTs || endTs <= startTs) return null;

    const delayMin = Math.round((endTs - ts) / 60);
    const progressColor = realArr ? '#10B981'
      : delayMin > 20 ? '#EF4444'
      : delayMin > 5 ? '#F59E0B'
      : colors.primary;

    return {
      startTs,
      endTs,
      progress: realArr ? 1 : clamp((Date.now() / 1000 - startTs) / (endTs - startTs), 0, 1),
      departureColor: realDep ? colors.primary : '#6B7280',
      arrivalColor: progressColor,
      planeColor: progressColor,
    };
  })() : null;

  const checkinShouldPulse = activeTab === 'departures' && ts && ops ? (() => {
    const ciOpenTs = ts - ops.checkInOpen * 60;
    const ciCloseTs = ts - ops.checkInClose * 60;
    return (nowTs >= ciOpenTs - 10 * 60 && nowTs < ciOpenTs)
      || (nowTs >= ciCloseTs - 10 * 60 && nowTs < ciCloseTs);
  })() : false;
  const gateShouldPulse = activeTab === 'departures' && ts && ops ? (() => {
    const gateOpenTs = gateOpenFromInbound ?? (ts - ops.gateOpen * 60);
    const gateCloseTs = ts - ops.gateClose * 60;
    return (nowTs >= gateOpenTs - 5 * 60 && nowTs < gateOpenTs)
      || (nowTs >= gateCloseTs - 5 * 60 && nowTs < gateCloseTs);
  })() : false;

  useEffect(() => {
    if (!checkinShouldPulse && !gateShouldPulse) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 520, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 520, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [checkinShouldPulse, gateShouldPulse, pulseAnim]);

  const checkinPulseStyle = checkinShouldPulse
    ? {
        borderWidth: 1.5,
        borderColor: '#F59E0B',
        backgroundColor: pulseAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [colors.primaryLight, 'rgba(245, 158, 11, 0.26)'],
        }),
      }
    : null;
  const gatePulseStyle = gateShouldPulse
    ? {
        borderWidth: 1.5,
        borderColor: '#F97316',
        backgroundColor: pulseAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [colors.primaryLight, 'rgba(249, 115, 22, 0.28)'],
        }),
      }
    : null;

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTs(Date.now() / 1000);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <BoardReveal index={index} enabled={isOperations}>
      <SwipeableFlightCard
        isPinned={isPinned}
        onToggle={() => isPinned ? onUnpin() : onPin(item)}
      >
        <TactilePressable
          animatedStyle={[
            s.card,
            isPinned && s.cardPinned,
            { marginBottom: 0 },
            isOperations && {
              borderLeftColor: brandAccent,
              borderColor: airlineBorder,
              shadowColor: brandAccent,
            },
          ]}
          depth={isOperations ? 6 : 4}
          pressedScale={0.982}
          haptic={false}
          onPress={() => { openFlightradar24Flight(flightNumber).catch(() => {}); }}
          accessibilityRole="link"
          accessibilityLabel={`Apri ${flightNumber} su Flightradar24`}
        >
        {isPinned && <View style={s.pinBanner}><Text style={s.pinBannerText}>{t('flightPinned')}</Text></View>}
        {/* Header */}
        <LinearGradient
          colors={isOperations
            ? [airlineTintStrong, 'rgba(2,8,12,0.86)', airlineTint]
            : [color, hexToRgba(color, 0.84)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[s.cardHeader, { borderBottomColor: airlineBorder }]}
        >
          <View style={[s.airlineBrandRail, { backgroundColor: brandAccent }]} />
          <View style={s.headerLeft}>
            <LogoPill iataCode={iataCode} airlineName={airline} color={color} />
            <View>
              <Text style={[s.headerFlightNum, isOperations && { color: brandAccent }]}>{flightNumber}</Text>
              <Text style={[s.headerAirlineName, isOperations && { color: hexToRgba(brandAccent, 0.82) }]}>{airline}</Text>
            </View>
          </View>
          <ValueChangeFlash
            valueKey={`${time}|${originDest}`}
            enabled={isOperations}
            style={s.headerMetaFlash}
          >
            <Text style={s.headerTime}>{time}</Text>
            <Text style={s.headerDest}>{originDest}</Text>
          </ValueChangeFlash>
        </LinearGradient>
        {/* Body */}
        <View style={s.cardBody}>
          {activeTab === 'departures' && ops ? (
            <View style={s.opsRow}>
              <ValueChangeFlash
                valueKey={`${fmt(ops.checkInOpen)}|${fmt(ops.checkInClose)}`}
                enabled={isOperations}
                style={[s.opsBadge, checkinPulseStyle]}
              >
                <MaterialIcons name="desktop-windows" size={16} color={colors.primary} />
                <View>
                  <Text style={s.opsLabel}>{t('flightCheckin')}</Text>
                  <Text style={s.opsTime}>{fmt(ops.checkInOpen)} – {fmt(ops.checkInClose)}</Text>
                </View>
              </ValueChangeFlash>
              <ValueChangeFlash
                valueKey={`${gateOpenFromInbound ? fmtTs(gateOpenFromInbound) : fmt(ops.gateOpen)}|${fmt(ops.gateClose)}`}
                enabled={isOperations}
                style={[s.opsBadge, gatePulseStyle]}
              >
                <MaterialIcons name="meeting-room" size={16} color={colors.primary} />
                <View>
                  <Text style={s.opsLabel}>{t('flightGate')}</Text>
                  <Text style={s.opsTime}>
                    {gateOpenFromInbound ? fmtTs(gateOpenFromInbound) : fmt(ops.gateOpen)} – {fmt(ops.gateClose)}
                  </Text>
                </View>
              </ValueChangeFlash>
            </View>
          ) : activeTab === 'arrivals' && ts ? (() => {
            const realDep = item.flight?.time?.real?.departure;
            const realArr = item.flight?.time?.real?.arrival;
            const estArr = item.flight?.time?.estimated?.arrival;
            const bestArr = realArr || estArr || ts;
            const delayMin = Math.round((bestArr - ts) / 60);
            const landed = !!realArr;
            const departed = !!realDep;

            const landColor = landed ? '#10B981'
              : delayMin > 20 ? '#EF4444'
              : delayMin > 5 ? '#F59E0B'
              : colors.primary;
            const landLabel = landed ? t('flightLanded') : t('flightEstimated');

            return (
              <View style={s.opsRow}>
                <ValueChangeFlash
                  valueKey={departed ? fmtTs(realDep) : '--:--'}
                  enabled={isOperations}
                  style={s.opsBadge}
                >
                  <MaterialIcons name="flight-takeoff" size={16} color={departed ? colors.primary : '#6B7280'} />
                  <View>
                    <Text style={s.opsLabel}>{t('flightDeparted')}</Text>
                    <Text style={[s.opsTime, !departed && { color: '#6B7280' }]}>
                      {departed ? fmtTs(realDep) : '--:--'}
                    </Text>
                  </View>
                </ValueChangeFlash>
                <ValueChangeFlash
                  valueKey={`${landLabel}|${fmtTs(bestArr)}`}
                  enabled={isOperations}
                  style={s.opsBadge}
                >
                  <MaterialIcons name="flight-land" size={16} color={landColor} />
                  <View>
                    <Text style={[s.opsLabel, { color: landColor }]}>{landLabel}</Text>
                    <Text style={[s.opsTime, { color: landColor }]}>{fmtTs(bestArr)}</Text>
                  </View>
                </ValueChangeFlash>
              </View>
            );
          })() : (
            <Text style={s.bodyInfo}>{`Da: ${originDest}`}</Text>
          )}
          {arrivalProgress && (
            <CockpitFlightProgress
              progress={arrivalProgress.progress}
              startLabel={fmtTs(arrivalProgress.startTs)}
              endLabel={fmtTs(arrivalProgress.endTs)}
              departureColor={arrivalProgress.departureColor}
              arrivalColor={arrivalProgress.arrivalColor}
              planeColor={arrivalProgress.planeColor}
              isOperations={isOperations}
            />
          )}
          {/* Status pill — own row, right-aligned */}
          {activeTab === 'arrivals' && ts ? (() => {
            const rArr = item.flight?.time?.real?.arrival;
            const eArr = item.flight?.time?.estimated?.arrival;
            const bArr = rArr || eArr || ts;
            const dMin = Math.round((bArr - ts) / 60);
            const isLanded = !!rArr;
            const dText = isLanded ? 'Atterrato' : dMin > 0 ? `+${dMin} min` : 'In orario';
            const dColor = isLanded ? '#10B981' : dMin > 20 ? '#EF4444' : dMin > 5 ? '#F59E0B' : '#10B981';
            return (
              <ValueChangeFlash valueKey={dText} enabled={isOperations} style={[s.statusPill, { backgroundColor: dColor + '22' }]}>
                <Text style={[s.statusText, { color: dColor }]}>{dText}</Text>
              </ValueChangeFlash>
            );
          })() : (
            <ValueChangeFlash valueKey={statusText} enabled={isOperations} style={[s.statusPill, { backgroundColor: statusColor + '22' }]}>
              <Text style={[s.statusText, { color: statusColor }]}>{statusText}</Text>
            </ValueChangeFlash>
          )}
        </View>
        {/* StaffMonitor footer — inside card so border-radius applies */}
        <View style={[s.smFooter, isOperations && { borderTopColor: airlineBorder }]}>
          <ValueChangeFlash
            valueKey={standLabel}
            enabled={isOperations}
            style={[s.smPill, isOperations && { backgroundColor: airlineTint, borderColor: airlineBorder }]}
          >
            <MaterialIcons name="local-parking" size={11} color={isOperations ? brandAccent : colors.primary} />
            <Text style={[s.smPillText, isOperations && { color: brandAccent }]}>Stand {standLabel}</Text>
          </ValueChangeFlash>
          {activeTab === 'departures' ? (
            <>
              <ValueChangeFlash
                valueKey={checkinLabel}
                enabled={isOperations}
                style={[s.smPill, isOperations && { backgroundColor: airlineTint, borderColor: airlineBorder }]}
              >
                <MaterialIcons name="desktop-windows" size={11} color={isOperations ? brandAccent : colors.primary} />
                <Text style={[s.smPillText, isOperations && { color: brandAccent }]}>{t('flightCheckin')} {checkinLabel}</Text>
              </ValueChangeFlash>
              <ValueChangeFlash
                valueKey={gateLabel}
                enabled={isOperations}
                style={[s.smPill, isOperations && { backgroundColor: airlineTint, borderColor: airlineBorder }]}
              >
                <MaterialIcons name="meeting-room" size={11} color={isOperations ? brandAccent : colors.primary} />
                <Text style={[s.smPillText, isOperations && { color: brandAccent }]}>{t('flightGate')} {gateLabel}</Text>
              </ValueChangeFlash>
            </>
          ) : (
            <ValueChangeFlash
              valueKey={beltLabel}
              enabled={isOperations}
              style={[s.smPill, isOperations && { backgroundColor: airlineTint, borderColor: airlineBorder }]}
            >
              <MaterialIcons name="luggage" size={11} color={isOperations ? brandAccent : colors.primary} />
              <Text style={[s.smPillText, isOperations && { color: brandAccent }]}>{t('flightBelt')} {beltLabel}</Text>
            </ValueChangeFlash>
          )}
        </View>
        </TactilePressable>
      </SwipeableFlightCard>
    </BoardReveal>
  );
}

const FlightRow = React.memo(FlightRowComponent);

// ─── Helpers notifiche ─────────────────────────────────────────────────────────
async function cancelPreviousNotifications(reason = 'flight shift reschedule', logEmpty = false) {
  return cancelAeroStaffScheduledNotifications({
    includeShift: true,
    includePinned: false,
    reason,
    source: 'flights',
    logEmpty,
  });
}

async function scheduleShiftNotifications(
  shiftArrivals: any[],
  shiftDepartures: any[],
  shiftEnd: number,
  locale: string,
  settings: FlightNotificationSettings,
  selectedAirlines: string[],
): Promise<number> {
  return runNotificationScheduleExclusive('flights', 'shift notification schedule', async () => {
    await cancelPreviousNotifications('flight shift reschedule', false);
    const now = Date.now() / 1000;
    const newIds: string[] = [];
    const canNotify = (item: any) => shouldNotifyAirline(item, settings, selectedAirlines);

  if (settings.includeArrivals) {
    for (const item of shiftArrivals) {
      if (!canNotify(item)) continue;
      const ts = getBestArrivalTs(item);
      if (!ts) continue;
      const secondsUntilNotify = ts - settings.arrivalLeadMinutes * 60 - now;
      if (secondsUntilNotify <= 0) continue;

      const flightNumber = item.flight?.identification?.number?.default || 'N/A';
      const airline = item.flight?.airline?.name || 'Sconosciuta';
      const origin = item.flight?.airport?.origin?.name
        || item.flight?.airport?.origin?.code?.iata
        || 'N/A';
      const arrivalTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `Arrivo tra ${settings.arrivalLeadMinutes} min - ${flightNumber}`,
          body: `${airline} da ${origin} · atterraggio alle ${arrivalTime}`,
          sound: true,
          sticky: settings.sticky,
          autoDismiss: !settings.sticky,
          data: buildNotificationData({
            scheduler: 'flights',
            type: 'arrival_shift',
            flightNumber,
            ts,
          }),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secondsUntilNotify), repeats: false },
      });
      newIds.push(id);
    }
  }

  if (settings.includeDepartures) {
    for (const item of shiftDepartures) {
      if (!canNotify(item)) continue;
      const ts = getBestDepartureTs(item);
      if (!ts) continue;
      const secondsUntilNotify = ts - settings.departureLeadMinutes * 60 - now;
      if (secondsUntilNotify <= 0) continue;

      const flightNumber = item.flight?.identification?.number?.default || 'N/A';
      const airline = item.flight?.airline?.name || 'Sconosciuta';
      const destination = item.flight?.airport?.destination?.name
        || item.flight?.airport?.destination?.code?.iata
        || 'N/A';
      const departureTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `Partenza tra ${settings.departureLeadMinutes} min - ${flightNumber}`,
          body: `${airline} → ${destination} · decollo alle ${departureTime}`,
          sound: true,
          sticky: settings.sticky,
          autoDismiss: !settings.sticky,
          data: buildNotificationData({
            scheduler: 'flights',
            type: 'departure_shift',
            flightNumber,
            ts,
          }),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secondsUntilNotify), repeats: false },
      });
      newIds.push(id);
    }
  }

  if (settings.includeShiftEnd) {
    const secondsUntilEnd = shiftEnd - now;
    if (secondsUntilEnd > 0) {
      const endTime = new Date(shiftEnd * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      const endId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Turno terminato',
          body: `Buon lavoro! Il tuo turno delle ${endTime} è concluso.`,
          sound: true,
          sticky: settings.sticky,
          autoDismiss: !settings.sticky,
          data: buildNotificationData({
            scheduler: 'flights',
            type: 'shift_end',
            ts: shiftEnd,
          }),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secondsUntilEnd), repeats: false },
      });
      newIds.push(endId);
    }
  }

    await AsyncStorage.setItem(NOTIF_IDS_KEY, JSON.stringify(newIds));
    await dedupeAeroStaffScheduledNotifications({
      includeShift: true,
      includePinned: false,
      reason: 'flight shift schedule complete',
      source: 'flights',
    });
    await appendNotificationDebugEvent({
      source: 'flights',
      type: 'schedule',
      message: 'Flight tab scheduled shift notifications.',
      scheduled: newIds.length,
      meta: {
        arrivals: shiftArrivals.length,
        departures: shiftDepartures.length,
        selectedAirlines: selectedAirlines.length,
        settings,
      },
    });
    return newIds.length;
  });
}

async function cancelPinnedNotifications(reason = 'pinned flight reschedule', logEmpty = false) {
  return cancelAeroStaffScheduledNotifications({
    includeShift: false,
    includePinned: true,
    reason,
    source: 'pinned',
    logEmpty,
  });
}

async function schedulePinnedNotifications(
  item: any,
  tab: 'arrivals' | 'departures',
  locale: string,
  settings: FlightNotificationSettings,
): Promise<void> {
  return runNotificationScheduleExclusive('pinned', 'pinned flight notification schedule', async () => {
    await cancelPinnedNotifications('pinned flight reschedule', false);
    const now = Date.now() / 1000;
    const ids: string[] = [];

  const flightNumber = item.flight?.identification?.number?.default || 'N/A';
  const airline = item.flight?.airline?.name || 'Sconosciuta';

  if (tab === 'arrivals') {
    const ts = getBestArrivalTs(item);
    if (!ts) return;
    const origin = item.flight?.airport?.origin?.name || item.flight?.airport?.origin?.code?.iata || 'N/A';
    const arrTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const secsUntil = ts - settings.arrivalLeadMinutes * 60 - now;
    if (secsUntil > 0) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `Arrivo tra ${settings.arrivalLeadMinutes} min - ${flightNumber}`,
          body: `${airline} da ${origin} · atterraggio alle ${arrTime}`,
          sound: true,
          sticky: settings.sticky,
          autoDismiss: !settings.sticky,
          data: buildNotificationData({
            scheduler: 'flights_pinned',
            type: 'pinned_arrival',
            flightNumber,
            ts,
            pinned: true,
          }),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secsUntil), repeats: false },
      });
      ids.push(id);
    }
  } else {
    const ts = getBestDepartureTs(item);
    if (!ts) return;
    const dest = item.flight?.airport?.destination?.name || item.flight?.airport?.destination?.code?.iata || 'N/A';
    const depTime = new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const ops = getAirlineOps(airline);

    const phases: Array<{ offset: number; type: string; title: string; body: string }> = [
      { offset: ops.checkInOpen, type: 'pinned_checkin_open', title: `Check-in aperto - ${flightNumber}`, body: `Check-in aperto per il volo delle ${depTime} → ${dest}` },
      { offset: ops.gateOpen, type: 'pinned_gate_open', title: `Gate aperto - ${flightNumber}`, body: `Gate aperto per il volo delle ${depTime} → ${dest}` },
      { offset: ops.gateClose, type: 'pinned_gate_close', title: `Chiusura gate - ${flightNumber}`, body: `Gate in chiusura per il volo delle ${depTime} → ${dest}` },
      {
        offset: settings.departureLeadMinutes,
        type: 'pinned_departure',
        title: `Partenza tra ${settings.departureLeadMinutes} min - ${flightNumber}`,
        body: `${airline} → ${dest} · partenza alle ${depTime}`,
      },
    ];

    for (const phase of phases) {
      const secsUntil = ts - phase.offset * 60 - now;
      if (secsUntil <= 0) continue;
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: phase.title,
          body: phase.body,
          sound: true,
          sticky: settings.sticky,
          autoDismiss: !settings.sticky,
          data: buildNotificationData({
            scheduler: 'flights_pinned',
            type: phase.type,
            flightNumber,
            ts,
            pinned: true,
          }),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(secsUntil), repeats: false },
      });
      ids.push(id);
    }
  }

    if (ids.length > 0) {
      await AsyncStorage.setItem(PINNED_NOTIF_IDS_KEY, JSON.stringify(ids));
    }
    await dedupeAeroStaffScheduledNotifications({
      includeShift: false,
      includePinned: true,
      reason: 'pinned flight schedule complete',
      source: 'pinned',
    });
    await appendNotificationDebugEvent({
      source: 'pinned',
      type: 'schedule',
      message: 'Flight tab scheduled pinned-flight notifications.',
      scheduled: ids.length,
      meta: { flightNumber, tab, sticky: settings.sticky },
    });
  });
}

// ─── Screen ────────────────────────────────────────────────────────────────────
export default function FlightScreen() {
  const { colors, mode } = useAppTheme();
  const { t, locale } = useLanguage();
  const {
    airport,
    airportCode,
    isLoading: airportLoading,
    activeProfile,
    activeProfileId,
    setSelectedAirlines: persistSelectedAirlines,
  } = useAirport();
  const isOperations = mode === 'operations';
  const s = useMemo(() => makeStyles(colors, isOperations), [colors, isOperations]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'arrivals' | 'departures'>('departures');
  const [activeDay, setActiveDay] = useState<'today' | 'tomorrow'>('today');
  const [arrivals, setArrivals] = useState<any[]>([]);
  const [departures, setDepartures] = useState<any[]>([]);
  const [shifts, setShifts] = useState<{ today: { start: number; end: number } | null; tomorrow: { start: number; end: number } | null }>({ today: null, tomorrow: null });
  const [notifsEnabled, setNotifsEnabled] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [pinnedFlightId, setPinnedFlightId] = useState<string | null>(null);
  const [inboundArrivals, setInboundArrivals] = useState<Record<string, number>>({});
  const [filterMenuVisible, setFilterMenuVisible] = useState(false);
  const [notifSettingsVisible, setNotifSettingsVisible] = useState(false);
  const [notifDialog, setNotifDialog] = useState<{ title: string; message: string; tone: FlightAlertTone } | null>(null);
  const [allArrivalsFull, setAllArrivalsFull] = useState<any[]>([]);
  const [allDeparturesFull, setAllDeparturesFull] = useState<any[]>([]);
  const [airportAirlines, setAirportAirlines] = useState<string[]>([]);
  const [selectedAirlines, setSelectedAirlines] = useState<string[]>([]);
  const [staffMonitorDeps, setStaffMonitorDeps] = useState<StaffMonitorFlight[]>([]);
  const [staffMonitorArrs, setStaffMonitorArrs] = useState<StaffMonitorFlight[]>([]);
  const [notifSettings, setNotifSettings] = useState<FlightNotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [flightDataSource, setFlightDataSource] = useState<FlightDataSourceState | null>(null);
  const applySelectedAirlines = useCallback((next: string[]) => {
    setSelectedAirlines(next);
    persistSelectedAirlines(next).catch(() => {});
  }, [persistSelectedAirlines]);
  const airportAirlinesRef = useRef<string[]>([]);
  const selectedAirlinesRef = useRef<string[]>([]);
  const notifSettingsRef = useRef<FlightNotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const selectedAirlinesNotifSignatureRef = useRef<string>('');

  useEffect(() => {
    airportAirlinesRef.current = airportAirlines;
  }, [airportAirlines]);

  useEffect(() => {
    selectedAirlinesRef.current = selectedAirlines;
  }, [selectedAirlines]);

  useEffect(() => {
    notifSettingsRef.current = notifSettings;
  }, [notifSettings]);

  useEffect(() => {
    AsyncStorage.getItem(NOTIF_ENABLED_KEY).then(v => setNotifsEnabled(v === 'true'));
    AsyncStorage.getItem(NOTIF_SETTINGS_KEY).then(raw => {
      if (!raw) return;
      try {
        const next = sanitizeNotificationSettings(JSON.parse(raw));
        setNotifSettings(next);
      } catch {}
    });
  }, []);

  // Carica voli recenti per aeroporto così oggi/domani restano visibili anche prima del fetch.
  useEffect(() => {
    let active = true;
    loadFlightScreenCache(airportCode).then(cache => {
      if (!active || !cache) return;
      setAllArrivalsFull(cache.arrivals);
      setAllDeparturesFull(cache.departures);
      setFlightDataSource({
        sourceLabel: cache.sourceLabel,
        fetchedAt: cache.fetchedAt,
      });
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [airportCode]);

  // Carica lista compagnie per aeroporto + selezione salvata
  useEffect(() => {
    let active = true;

    getStoredAirportAirlines(airportCode).then(airlines => {
      if (!active) {
        return;
      }

      setAirportAirlines(airlines);
      const saved = activeProfile?.airportCode === airportCode ? activeProfile.airlines : [];
      const valid = saved.filter(key => airlines.includes(key));

      if (saved.length === 0 && activeProfile?.airportCode === airportCode) {
        setSelectedAirlines([]);
        return;
      }

      setSelectedAirlines(valid.length > 0 ? valid : [...airlines]);
    }).catch(() => {
      if (!active) {
        return;
      }

      const airlines = getAirportAirlines(airportCode);
      setAirportAirlines(airlines);
      const saved = activeProfile?.airportCode === airportCode ? activeProfile.airlines : [];
      if (saved.length === 0 && activeProfile?.airportCode === airportCode) {
        setSelectedAirlines([]);
        return;
      }

      const valid = saved.filter(key => airlines.includes(key));
      setSelectedAirlines(valid.length > 0 ? valid : [...airlines]);
    });

    return () => {
      active = false;
    };
  }, [activeProfile, activeProfileId, airportCode]);

  const fetchAll = useCallback(async () => {
    if (airportLoading) return;

    try {
      const {
        allArrivals,
        allDepartures,
        departures: fetchedDepartures,
        arrivals: fetchedArrivals,
        sourceLabel,
        fetchedAt,
      } = await fetchAirportScheduleRaw(airportCode);
      const nextAirportAirlines = getAirportAirlines(airportCode);
      setAirportAirlines(nextAirportAirlines);

      const savedProfileAirlines = activeProfile?.airportCode === airportCode ? activeProfile.airlines : [];
      const previousAirportAirlines = airportAirlinesRef.current;
      const previousSelectedAirlines = selectedAirlinesRef.current;
      const hadAllPreviouslySelected =
        previousAirportAirlines.length > 0 &&
        previousAirportAirlines.every(key => previousSelectedAirlines.includes(key));

      if (savedProfileAirlines.length === 0) {
        if (previousSelectedAirlines.length > 0) {
          applySelectedAirlines([]);
        }
      } else if (hadAllPreviouslySelected && !sameAirlineKeys(savedProfileAirlines, nextAirportAirlines)) {
        applySelectedAirlines(nextAirportAirlines);
      }
      // Accumula voli: fonde i dati freschi con quelli in cache e conserva solo
      // i voli non più vecchi di 1 ora dall'orario migliore disponibile.
      let cachedArrs: any[] = [], cachedDeps: any[] = [];
      try {
        const cache = await loadFlightScreenCache(airportCode);
        cachedArrs = cache?.arrivals ?? [];
        cachedDeps = cache?.departures ?? [];
      } catch {}
      const mergedArrs = pruneExpiredFlights(mergeFlightLists(cachedArrs, allArrivals, 'arrival'), 'arrival');
      const mergedDeps = pruneExpiredFlights(mergeFlightLists(cachedDeps, allDepartures, 'departure'), 'departure');
      const sourceState: FlightDataSourceState = {
        sourceLabel: sourceLabel ?? 'Sconosciuta',
        fetchedAt: fetchedAt ?? Date.now(),
      };
      setAllArrivalsFull(mergedArrs);
      setAllDeparturesFull(mergedDeps);
      setFlightDataSource(sourceState);
      saveFlightScreenCache({
        airportCode,
        arrivals: mergedArrs,
        departures: mergedDeps,
        sourceLabel: sourceState.sourceLabel,
        fetchedAt: sourceState.fetchedAt,
      }).catch(() => {});

      // Build inbound arrival map: registration → best known arrival timestamp
      const inboundMap: Record<string, number> = {};
      for (const a of allArrivals) {
        const reg = a.flight?.aircraft?.registration;
        if (!reg) continue;
        const t = a.flight?.time?.real?.arrival
               || a.flight?.time?.estimated?.arrival
               || a.flight?.time?.scheduled?.arrival;
        if (t) inboundMap[reg] = t;
      }
      setInboundArrivals(inboundMap);

      setArrivals(fetchedArrivals);
      setDepartures(fetchedDepartures);

      // Auto-clear expired pinned flight or stale data from another airport
      const notificationsEnabledNow = (await AsyncStorage.getItem(NOTIF_ENABLED_KEY)) === 'true';
      const pinnedRaw = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
      if (pinnedRaw) {
        try {
          const pinned = JSON.parse(pinnedRaw);
          const pinTab = pinned._pinTab || 'departures';
          const pinTs = pinTab === 'arrivals'
            ? getBestArrivalTs(pinned)
            : getBestDepartureTs(pinned);
          const pinId = pinned.flight?.identification?.number?.default;
          const pool = pinTab === 'arrivals' ? fetchedArrivals : fetchedDepartures;
          const stillPresent = !!pinId && pool.some(item => item.flight?.identification?.number?.default === pinId);
          if ((pinTs && pinTs < Date.now() / 1000) || !stillPresent) {
            await AsyncStorage.removeItem(PINNED_FLIGHT_KEY);
            await cancelPinnedNotifications('pinned flight expired or missing', false);
            await dismissPinnedFlightNotification();
            setPinnedFlightId(null);
          } else if (stillPresent && pinId && notificationsEnabledNow) {
            const updated = pool.find(item => item.flight?.identification?.number?.default === pinId);
            if (updated) {
              await showOrUpdatePinnedFlightNotification(updated, pinTab, notifSettingsRef.current.sticky);
            }
          } else if (!notificationsEnabledNow) {
            await cancelPinnedNotifications('flight refresh notifications disabled', false);
            await dismissPinnedFlightNotification();
          }
        } catch {}
      }

      // Shift (today + tomorrow)
      let shiftToday: { start: number; end: number } | null = null;
      let shiftTomorrow: { start: number; end: number } | null = null;
      let isRestDay = false;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);
      const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setHours(23, 59, 59, 999);
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status === 'granted') {
        const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const cal = cals.find(c => c.allowsModifications && c.isPrimary) || cals.find(c => c.allowsModifications);
        if (cal) {
          const evts = await Calendar.getEventsAsync([cal.id], todayStart, tomorrowEnd);
          for (const e of evts) {
            if (e.title.includes('Riposo')) {
              const evtDay = new Date(e.startDate);
              if (evtDay >= todayStart && evtDay <= todayEnd) isRestDay = true;
              continue;
            }
            if (!e.title.includes('Lavoro')) continue;
            const s = new Date(e.startDate).getTime() / 1000;
            const en = new Date(e.endDate).getTime() / 1000;
            const evtDay = new Date(e.startDate);
            if (evtDay >= todayStart && evtDay <= todayEnd) {
              shiftToday = { start: s, end: en };
              isRestDay = false; // Lavoro event overrides any stale Riposo marker for the same day
            } else if (evtDay >= tomorrowStart && evtDay <= tomorrowEnd) shiftTomorrow = { start: s, end: en };
          }
        }
      }
      setShifts({ today: shiftToday, tomorrow: shiftTomorrow });
      const todayIso = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;
      const tomorrowIso = `${tomorrowStart.getFullYear()}-${String(tomorrowStart.getMonth() + 1).padStart(2, '0')}-${String(tomorrowStart.getDate()).padStart(2, '0')}`;
      const nextShift = shiftTomorrow ? { date: tomorrowIso, ...shiftTomorrow } : null;

      // ── Persist shift data for widget self-update ──
      const shiftKeyData: WidgetShiftData = {
        date: todayIso,
        shiftToday,
        isRestDay,
        nextShift,
      };
      AsyncStorage.setItem(WIDGET_SHIFT_KEY, JSON.stringify(shiftKeyData)).catch(() => {});

      // ── Push data to widget cache ──
      try {
        const fmtT = (ts: number) => new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        const fmtOff = (dep: number, off: number) => fmtT(dep - off * 60);
        const nowHH = fmtT(Date.now() / 1000);
        const nowSec = Date.now() / 1000;
        const activeWidgetShift = shiftToday && nowSec <= shiftToday.end
          ? { date: todayIso, ...shiftToday, isNext: false }
          : shiftToday && nowSec > shiftToday.end && nextShift && nextShift.start > nowSec
            ? { ...nextShift, isNext: true }
            : null;

        let widgetData: WidgetData;
        if (isRestDay) {
          widgetData = { state: 'rest' };
        } else if (!activeWidgetShift) {
          widgetData = { state: 'no_shift' };
        } else {
          const shiftLabel = `${activeWidgetShift.isNext ? 'Domani ' : ''}${fmtT(activeWidgetShift.start)} – ${fmtT(activeWidgetShift.end)}`;
          const pinnedRawW = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
          let pinnedFn: string | null = null;
          if (pinnedRawW) {
            try { pinnedFn = JSON.parse(pinnedRawW).flight?.identification?.number?.default || null; } catch {}
          }
          const wFilterRaw = await AsyncStorage.getItem(FLIGHT_FILTER_KEY);
          const wAllowedAirlines: string[] = wFilterRaw ? JSON.parse(wFilterRaw) : [];
          const wFlights: WidgetFlight[] = mergedDeps
            .filter(item => {
              const ts = getBestDepartureTs(item);
              if (ts == null) return false;
              const airline = item.flight?.airline?.name || '';
              if (wAllowedAirlines.length > 0 && !wAllowedAirlines.some(k => isFlightAirlineMatch(item, k))) return false;
              const ops = getAirlineOps(airline);
              const ciO = ts - ops.checkInOpen * 60, ciC = ts - ops.checkInClose * 60;
              const gO = ts - ops.gateOpen * 60, gC = ts - ops.gateClose * 60;
              return (ciO <= activeWidgetShift.end && ciC >= activeWidgetShift.start) || (gO <= activeWidgetShift.end && gC >= activeWidgetShift.start);
            })
            .map(item => {
              const ts = getBestDepartureTs(item)!;
              const airline = item.flight?.airline?.name || 'Sconosciuta';
              const ops = getAirlineOps(airline);
              const fn = item.flight?.identification?.number?.default || 'N/A';
              const normFn = normalizeFlightNumber(fn);
              const strip = (s: string) => s.replace(/[\s\-_]/g, '').toUpperCase();
              const smDeps = staffMonitorDepsRef.current;
              const sm = smDeps.find(x => x.flightNumber === normFn)
                      ?? smDeps.find(x => strip(x.flightNumber) === strip(normFn));
              return {
                flightNumber: fn,
                destinationIata: getFlightAirportLabel(item.flight?.airport?.destination, 'N/A'),
                departureTs: ts,
                departureTime: fmtT(ts),
                ciOpen: fmtOff(ts, ops.checkInOpen), ciClose: fmtOff(ts, ops.checkInClose),
                gateOpen: fmtOff(ts, ops.gateOpen), gateClose: fmtOff(ts, ops.gateClose),
                airlineColor: getAirlineColor(airline),
                isPinned: fn === pinnedFn,
                stand: sm?.stand,
                checkin: sm?.checkin,
                gate: sm?.gate,
              };
            })
            .sort((a, b) => a.departureTs - b.departureTs);

          widgetData = wFlights.length === 0
            ? { state: 'work_empty', shiftLabel, updatedAt: nowHH }
            : { state: 'work', shiftLabel, flights: wFlights, updatedAt: nowHH };
        }
        await AsyncStorage.setItem(WIDGET_CACHE_KEY, JSON.stringify(widgetData));
        if (Platform.OS === 'android') {
          requestShiftWidgetUpdate(widgetData).catch(() => {});
        }
      } catch {}

      // Schedula notifiche se attive (solo turno di oggi)
      if (notificationsEnabledNow && shiftToday) {
        const shiftArrivals = fetchedArrivals.filter(item => {
          const ts = getBestArrivalTs(item);
          return ts && ts >= shiftToday.start && ts <= shiftToday.end;
        });
        const shiftDepartures = fetchedDepartures.filter(item => {
          const ts = getBestDepartureTs(item);
          return ts && ts >= shiftToday.start && ts <= shiftToday.end;
        });
        const count = await scheduleShiftNotifications(
          shiftArrivals,
          shiftDepartures,
          shiftToday.end,
          locale,
          notifSettingsRef.current,
          selectedAirlinesRef.current,
        );
        setScheduledCount(count);
      } else {
        await cancelPreviousNotifications('flight refresh inactive', false);
        setScheduledCount(0);
      }
    } catch (e) { if (__DEV__) console.error('[fetchAll]', e); } finally { setLoading(false); setRefreshing(false); }
  }, [activeProfile, airportCode, airportLoading, applySelectedAirlines]);

  useEffect(() => {
    if (airportLoading) return;
    setLoading(true);
    fetchAll();
  }, [airportLoading, fetchAll]);

  // Auto-refresh flight data every 2 minutes so status/times stay current
  useEffect(() => {
    if (airportLoading) return;
    const iv = setInterval(() => { fetchAll(); }, 2 * 60 * 1000);
    return () => clearInterval(iv);
  }, [airportLoading, fetchAll]);

  useEffect(() => {
    AsyncStorage.getItem(PINNED_FLIGHT_KEY).then(raw => {
      if (!raw) return;
      try {
        const pinned = JSON.parse(raw);
        const id = pinned.flight?.identification?.number?.default;
        if (id) setPinnedFlightId(id);
      } catch {}
    });
  }, []);

  const staffMonitorDepsRef = useRef<StaffMonitorFlight[]>([]);
  const staffMonitorArrsRef = useRef<StaffMonitorFlight[]>([]);

  // staffMonitor: poll stand / gate / belt every 60 s
  useEffect(() => {
    const load = async () => {
      try {
        const [deps, arrs] = await Promise.all([
          fetchStaffMonitorData('D'),
          fetchStaffMonitorData('A'),
        ]);
        staffMonitorDepsRef.current = deps;
        staffMonitorArrsRef.current = arrs;
        setStaffMonitorDeps(deps);
        setStaffMonitorArrs(arrs);
      } catch {}
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  const showNotifDialog = useCallback((title: string, message: string, tone: FlightAlertTone) => {
    setNotifDialog({ title, message, tone });
  }, []);

  const scheduleNotificationsForCurrentShift = useCallback(async (
    settings: FlightNotificationSettings = notifSettingsRef.current,
  ): Promise<number> => {
    if (!shifts.today) {
      await cancelPreviousNotifications('no current shift', false);
      await appendNotificationDebugEvent({
        source: 'flights',
        type: 'skip_no_shift',
        message: 'Flight tab skipped scheduling because there is no current shift.',
      });
      setScheduledCount(0);
      return 0;
    }

    const shiftArrivals = arrivals.filter(item => {
      const ts = getBestArrivalTs(item);
      return ts && ts >= shifts.today!.start && ts <= shifts.today!.end;
    });
    const shiftDepartures = departures.filter(item => {
      const ts = getBestDepartureTs(item);
      return ts && ts >= shifts.today!.start && ts <= shifts.today!.end;
    });
    const count = await scheduleShiftNotifications(
      shiftArrivals,
      shiftDepartures,
      shifts.today.end,
      locale,
      settings,
      selectedAirlinesRef.current,
    );
    setScheduledCount(count);
    return count;
  }, [arrivals, departures, locale, shifts.today]);

  const setNotificationsEnabled = useCallback(async (next: boolean) => {
    if (!next) {
      setNotifsEnabled(false);
      await AsyncStorage.setItem(NOTIF_ENABLED_KEY, 'false');
      await cancelPreviousNotifications('user disabled notifications', true);
      await cancelPinnedNotifications('user disabled notifications', true);
      await dismissPinnedFlightNotification();
      await appendNotificationDebugEvent({
        source: 'settings',
        type: 'disabled',
        message: 'Flight notifications disabled by user.',
      });
      setScheduledCount(0);
      return;
    }

    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      await appendNotificationDebugEvent({
        source: 'settings',
        type: 'permission_denied',
        message: 'Notification permission denied while enabling flight notifications.',
        meta: { status },
      });
      showNotifDialog(t('flightNotifPermDenied'), t('flightNotifPermMsg'), 'warning');
      return;
    }

    if (!shifts.today) {
      showNotifDialog(t('flightNoShift'), t('flightNoShiftMsg'), 'info');
      setNotifsEnabled(false);
      await AsyncStorage.setItem(NOTIF_ENABLED_KEY, 'false');
      await cancelPreviousNotifications('enable requested without shift', true);
      await appendNotificationDebugEvent({
        source: 'settings',
        type: 'enable_without_shift',
        message: 'User tried to enable notifications but no current shift was available.',
      });
      setScheduledCount(0);
      return;
    }

    setNotifsEnabled(true);
    await AsyncStorage.setItem(NOTIF_ENABLED_KEY, 'true');
    const pinnedRaw = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
    if (pinnedRaw) {
      try {
        const pinned = JSON.parse(pinnedRaw);
        const pinTab = pinned._pinTab || 'departures';
        await schedulePinnedNotifications(pinned, pinTab, locale, notifSettingsRef.current);
        await showOrUpdatePinnedFlightNotification(pinned, pinTab, notifSettingsRef.current.sticky);
      } catch {}
    }
    const count = await scheduleNotificationsForCurrentShift();
    showNotifDialog(
      t('flightNotifEnabled'),
      count > 0
        ? t('flightNotifMsg1').replace('{count}', String(count))
        : t('flightNotifMsg0'),
      'success',
    );
  }, [scheduleNotificationsForCurrentShift, shifts.today, showNotifDialog, t]);

  const persistNotificationSettings = useCallback(async (next: FlightNotificationSettings) => {
    setNotifSettings(next);
    await AsyncStorage.setItem(NOTIF_SETTINGS_KEY, JSON.stringify(next));
  }, []);

  const updateNotificationSettings = useCallback(async (
    patch: Partial<FlightNotificationSettings>,
  ) => {
    const next = sanitizeNotificationSettings({ ...notifSettingsRef.current, ...patch });
    await persistNotificationSettings(next);

    if (notifsEnabled && pinnedFlightId) {
      const pinnedRaw = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
      if (pinnedRaw) {
        try {
          const pinned = JSON.parse(pinnedRaw);
          const pinTab = pinned._pinTab || 'departures';
          await schedulePinnedNotifications(pinned, pinTab, locale, next);
          await showOrUpdatePinnedFlightNotification(pinned, pinTab, next.sticky);
        } catch {}
      }
    }

    if (notifsEnabled) {
      await scheduleNotificationsForCurrentShift(next);
    }
  }, [locale, notifsEnabled, persistNotificationSettings, pinnedFlightId, scheduleNotificationsForCurrentShift]);

  useEffect(() => {
    const signature = selectedAirlines.join('|');
    const changed = signature !== selectedAirlinesNotifSignatureRef.current;
    selectedAirlinesNotifSignatureRef.current = signature;
    if (!changed || !notifsEnabled) return;
    scheduleNotificationsForCurrentShift().catch(() => {});
  }, [notifsEnabled, scheduleNotificationsForCurrentShift, selectedAirlines]);

  const pinFlight = useCallback(async (item: any) => {
    try {
      const id = item.flight?.identification?.number?.default;
      if (!id) return;
      const tab = activeTab;
      await AsyncStorage.setItem(PINNED_FLIGHT_KEY, JSON.stringify({ ...item, _pinTab: tab, _pinnedAt: Date.now() }));
      setPinnedFlightId(id);
      if (notifsEnabled) {
        try { await schedulePinnedNotifications(item, tab, locale, notifSettingsRef.current); } catch (e) { if (__DEV__) console.warn('[pinnedNotif]', e); }
        await showOrUpdatePinnedFlightNotification(item, tab, notifSettingsRef.current.sticky);
      } else {
        await dismissPinnedFlightNotification();
      }
      // Send to watch
      if (WearDataSender) {
        const payload = JSON.stringify({
          flightNumber: item.flight?.identification?.number?.default || '',
          airline: item.flight?.airline?.name || '',
          airlineColor: getAirlineColor(item.flight?.airline?.name || ''),
          iataCode: item.flight?.airline?.code?.iata || '',
          tab,
          destination: item.flight?.airport?.destination?.name || item.flight?.airport?.destination?.code?.iata || '',
          origin: item.flight?.airport?.origin?.name || item.flight?.airport?.origin?.code?.iata || '',
          scheduledTime: tab === 'departures' ? item.flight?.time?.scheduled?.departure : item.flight?.time?.scheduled?.arrival,
          estimatedTime: tab === 'departures' ? item.flight?.time?.estimated?.departure : item.flight?.time?.estimated?.arrival,
          realDeparture: item.flight?.time?.real?.departure || null,
          realArrival: item.flight?.time?.real?.arrival || null,
          ops: tab === 'departures' ? getAirlineOps(item.flight?.airline?.name || '') : null,
          inboundArrival: tab === 'departures' && item.flight?.aircraft?.registration ? inboundArrivals[item.flight.aircraft.registration] || null : null,
          pinnedAt: Math.floor(Date.now() / 1000),
        });
        WearDataSender.sendPinnedFlight(payload);
      }
    } catch {}
  }, [activeTab, inboundArrivals, locale, notifsEnabled]);

  const unpinFlight = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(PINNED_FLIGHT_KEY);
      try { await cancelPinnedNotifications(); } catch (e) { if (__DEV__) console.warn('[cancelPinNotif]', e); }
      await dismissPinnedFlightNotification();
      setPinnedFlightId(null);
      if (WearDataSender) WearDataSender.clearPinnedFlight();
    } catch (e) { if (__DEV__) console.error('[unpin]', e); }
  }, []);

  const userShift = activeDay === 'today' ? shifts.today : shifts.tomorrow;
  const selectedDate = activeDay === 'today' ? new Date() : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })();
  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();

  const allSelected = airportAirlines.length > 0 && airportAirlines.every(k => selectedAirlines.includes(k));

  const currentData = (() => {
    const source = activeTab === 'arrivals' ? allArrivalsFull : allDeparturesFull;
    const timeField = activeTab === 'arrivals' ? 'arrival' : 'departure';
    const seen = new Set<string>();
    return filterFlightsByAirlines(source, selectedAirlines).filter(item => {
      const ts = item.flight?.time?.scheduled?.[timeField];
      if (!ts || !isSameDay(new Date(ts * 1000), selectedDate)) return false;
      const dedupeKey = getFlightMergeKey(item, timeField);
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    }).sort(compareFlightsChronologically(timeField));
  })();

  const renderFlight = useCallback(({ item, index }: { item: any; index: number }) => (
    <FlightRow
      item={item}
      index={index}
      activeTab={activeTab}
      userShift={userShift}
      pinnedFlightId={pinnedFlightId}
      onPin={pinFlight}
      onUnpin={unpinFlight}
      inboundArrivals={inboundArrivals}
      colors={colors}
      isOperations={isOperations}
      s={s}
      smPool={activeTab === 'departures' ? staffMonitorDeps : staffMonitorArrs}
      locale={locale}
      t={t}
    />
  ), [activeTab, userShift, s, pinnedFlightId, pinFlight, unpinFlight, inboundArrivals, colors, isOperations, staffMonitorDeps, staffMonitorArrs, locale, t]);
  const notifSummary = scheduledCount > 0
    ? t('flightNotifMsg1').replace('{count}', String(scheduledCount))
    : t('flightNotifMsg0');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Page header */}
      <View style={s.pageHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle}>{t('flightTitle')}</Text>
          <Text style={s.pageSub}>{formatAirportHeader(airport.code)}</Text>
        </View>
        <TouchableOpacity
          style={[s.filterBtn, !allSelected && s.filterBtnActive]}
          onPress={() => setFilterMenuVisible(true)}
          activeOpacity={0.8}
          accessibilityLabel={t('flightFilterTitle')}
          accessibilityRole="button"
        >
          <MaterialIcons name="filter-list" size={20} color={!allSelected ? '#fff' : '#64748B'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.notifBtn, notifsEnabled && s.notifBtnActive]}
          onPress={() => setNotifSettingsVisible(true)}
          activeOpacity={0.8}
          accessible
          accessibilityLabel={t('flightNotifSettingsTitle')}
          accessibilityRole="button"
        >
          <MaterialIcons
            name={notifsEnabled ? 'notifications-active' : 'notifications-none'}
            size={20}
            color={notifsEnabled ? '#fff' : '#64748B'}
          />
          {notifsEnabled && scheduledCount > 0 && (
            <View style={s.notifBadge}>
              <Text style={s.notifBadgeTxt}>{scheduledCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Dual segmented controls */}
      <View style={s.controlsRow}>
        {/* Arrivi / Partenze */}
        <View style={s.segment}>
          {(['arrivals', 'departures'] as const).map(tab => (
            <TouchableOpacity key={tab} style={[s.segBtn, activeTab === tab && s.segBtnActive]} onPress={() => setActiveTab(tab)}>
              <Text style={[s.segBtnText, activeTab === tab && s.segBtnTextActive]}>{tab === 'arrivals' ? t('flightArrivals') : t('flightDepartures')}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* Oggi / Domani */}
        <View style={s.segment}>
          {(['today', 'tomorrow'] as const).map(d => (
            <TouchableOpacity key={d} style={[s.segBtn, activeDay === d && s.segBtnActive]} onPress={() => setActiveDay(d)}>
              <Text style={[s.segBtnText, activeDay === d && s.segBtnTextActive]}>{d === 'today' ? t('flightToday') : t('flightTomorrow')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {flightDataSource && (
        <View
          style={s.sourceBadge}
        >
          <MaterialIcons name="hub" size={14} color={colors.primary} />
          <Text style={s.sourceBadgeText}>
            {t('flightDataSource')}: {flightDataSource.sourceLabel}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={currentData}
          keyExtractor={(item, i) => item.flight?.identification?.id || String(i)}
          renderItem={renderFlight}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 18,
            paddingBottom: isOperations ? 176 : 120,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={colors.primary} />}
          ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 40, color: '#9CA3AF', fontSize: 15 }}>{t('flightNoFlights')}</Text>}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Flight Filter Modal */}
      <Modal
        visible={filterMenuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterMenuVisible(false)}
      >
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setFilterMenuVisible(false)}
        >
          <View style={s.filterSheet} onStartShouldSetResponder={() => true}>
            <View style={s.filterSheetHandle} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={s.filterSheetTitle}>{t('flightFilterTitle')}</Text>
              <TouchableOpacity
                onPress={() => {
                  const next = allSelected ? [] : [...airportAirlines];
                  applySelectedAirlines(next);
                }}
              >
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                  {allSelected ? t('flightFilterDeselAll') : t('flightFilterSelAll')}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {airportAirlines.map(key => {
                const checked = selectedAirlines.includes(key);
                const label = AIRLINE_DISPLAY_NAMES[key] ?? prettifyAirlineLabel(key);
                const brandColor = getAirlineBrandColor(key, label);
                const iataCode = getAirlineIataCode(key, label);
                const activeBg = hexToRgba(brandColor, colors.isDark ? 0.24 : 0.18);
                const inactiveBg = colors.isDark ? 'rgba(2,6,18,0.92)' : 'rgba(255,255,255,0.92)';
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      s.filterOption,
                      {
                        backgroundColor: checked ? activeBg : inactiveBg,
                        borderColor: checked ? hexToRgba(brandColor, 0.72) : hexToRgba(brandColor, 0.28),
                      },
                      checked && s.filterOptionActive,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      const next = checked
                        ? selectedAirlines.filter(k => k !== key)
                        : [...selectedAirlines, key];
                      applySelectedAirlines(next);
                    }}
                  >
                    <AirlineFilterLogo iataCode={iataCode} label={label} color={brandColor} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.filterOptionText, checked && { color: brandColor }]}>{label}</Text>
                      <Text style={s.filterOptionSub}>
                        {iataCode ? `IATA ${iataCode}` : key}
                      </Text>
                    </View>
                    <View style={[s.filterBrandDotWrap, { backgroundColor: hexToRgba(brandColor, 0.16), borderColor: hexToRgba(brandColor, 0.45) }]}>
                      <View style={[s.filterBrandDot, { backgroundColor: brandColor }]} />
                    </View>
                    <MaterialIcons
                      name={checked ? 'check-box' : 'check-box-outline-blank'}
                      size={22}
                      color={checked ? brandColor : '#9CA3AF'}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={notifSettingsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNotifSettingsVisible(false)}
      >
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setNotifSettingsVisible(false)}
        >
          <View style={s.filterSheet} onStartShouldSetResponder={() => true}>
            <View style={s.filterSheetHandle} />
            <Text style={s.filterSheetTitle}>{t('flightNotifSettingsTitle')}</Text>
            <Text style={s.notifSheetSub}>{t('flightNotifSettingsSub')}</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.notifRow}>
                <View style={s.notifRowTextWrap}>
                  <Text style={s.notifRowTitle}>{notifsEnabled ? t('flightNotifAccessDisable') : t('flightNotifAccessEnable')}</Text>
                  <Text style={s.notifRowSub}>{notifSummary}</Text>
                </View>
                <Switch
                  value={notifsEnabled}
                  onValueChange={(value) => { setNotificationsEnabled(value).catch(() => {}); }}
                  trackColor={{ false: '#94A3B8', true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              <View style={s.notifDivider} />

              <View style={s.notifRow}>
                <View style={s.notifRowTextWrap}>
                  <Text style={s.notifRowTitle}>{t('flightNotifOnlyTracked')}</Text>
                  <Text style={s.notifRowSub}>{t('flightNotifOnlyTrackedSub')}</Text>
                </View>
                <Switch
                  value={notifSettings.onlyTrackedAirlines}
                  onValueChange={(value) => { updateNotificationSettings({ onlyTrackedAirlines: value }).catch(() => {}); }}
                  trackColor={{ false: '#94A3B8', true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              <View style={s.notifRow}>
                <View style={s.notifRowTextWrap}>
                  <Text style={s.notifRowTitle}>{t('flightNotifArrivalsToggle')}</Text>
                  <Text style={s.notifRowSub}>{t('flightNotifArrivalsToggleSub')}</Text>
                </View>
                <Switch
                  value={notifSettings.includeArrivals}
                  onValueChange={(value) => { updateNotificationSettings({ includeArrivals: value }).catch(() => {}); }}
                  trackColor={{ false: '#94A3B8', true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              <View style={s.notifRow}>
                <View style={s.notifRowTextWrap}>
                  <Text style={s.notifRowTitle}>{t('flightNotifDeparturesToggle')}</Text>
                  <Text style={s.notifRowSub}>{t('flightNotifDeparturesToggleSub')}</Text>
                </View>
                <Switch
                  value={notifSettings.includeDepartures}
                  onValueChange={(value) => { updateNotificationSettings({ includeDepartures: value }).catch(() => {}); }}
                  trackColor={{ false: '#94A3B8', true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              <View style={s.notifRow}>
                <View style={s.notifRowTextWrap}>
                  <Text style={s.notifRowTitle}>{t('flightNotifShiftEndToggle')}</Text>
                  <Text style={s.notifRowSub}>{t('flightNotifShiftEndToggleSub')}</Text>
                </View>
                <Switch
                  value={notifSettings.includeShiftEnd}
                  onValueChange={(value) => { updateNotificationSettings({ includeShiftEnd: value }).catch(() => {}); }}
                  trackColor={{ false: '#94A3B8', true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              <View style={s.notifRow}>
                <View style={s.notifRowTextWrap}>
                  <Text style={s.notifRowTitle}>{t('flightNotifStickyToggle')}</Text>
                  <Text style={s.notifRowSub}>{t('flightNotifStickyToggleSub')}</Text>
                </View>
                <Switch
                  value={notifSettings.sticky}
                  onValueChange={(value) => { updateNotificationSettings({ sticky: value }).catch(() => {}); }}
                  trackColor={{ false: '#94A3B8', true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              <View style={s.notifDivider} />

              <View style={s.notifMinutesRow}>
                <Text style={s.notifRowTitle}>{t('flightNotifArrivalLead')}</Text>
                <View style={s.notifStepper}>
                  <TouchableOpacity
                    style={s.notifStepperBtn}
                    onPress={() => updateNotificationSettings({
                      arrivalLeadMinutes: clamp(notifSettings.arrivalLeadMinutes - 1, MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES),
                    }).catch(() => {})}
                  >
                    <MaterialIcons name="remove" size={18} color={colors.primaryDark} />
                  </TouchableOpacity>
                  <Text style={s.notifStepperValue}>{notifSettings.arrivalLeadMinutes}m</Text>
                  <TouchableOpacity
                    style={s.notifStepperBtn}
                    onPress={() => updateNotificationSettings({
                      arrivalLeadMinutes: clamp(notifSettings.arrivalLeadMinutes + 1, MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES),
                    }).catch(() => {})}
                  >
                    <MaterialIcons name="add" size={18} color={colors.primaryDark} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.notifMinutesRow}>
                <Text style={s.notifRowTitle}>{t('flightNotifDepartureLead')}</Text>
                <View style={s.notifStepper}>
                  <TouchableOpacity
                    style={s.notifStepperBtn}
                    onPress={() => updateNotificationSettings({
                      departureLeadMinutes: clamp(notifSettings.departureLeadMinutes - 1, MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES),
                    }).catch(() => {})}
                  >
                    <MaterialIcons name="remove" size={18} color={colors.primaryDark} />
                  </TouchableOpacity>
                  <Text style={s.notifStepperValue}>{notifSettings.departureLeadMinutes}m</Text>
                  <TouchableOpacity
                    style={s.notifStepperBtn}
                    onPress={() => updateNotificationSettings({
                      departureLeadMinutes: clamp(notifSettings.departureLeadMinutes + 1, MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES),
                    }).catch(() => {})}
                  >
                    <MaterialIcons name="add" size={18} color={colors.primaryDark} />
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={Boolean(notifDialog)}
        transparent
        animationType="fade"
        onRequestClose={() => setNotifDialog(null)}
      >
        <View style={s.alertOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setNotifDialog(null)} />
          <View style={s.alertCard}>
            <View style={s.alertHeader}>
              <View
                style={[
                  s.alertIconWrap,
                  notifDialog?.tone === 'success'
                    ? s.alertSuccess
                    : notifDialog?.tone === 'warning'
                      ? s.alertWarning
                      : s.alertInfo,
                ]}
              >
                <MaterialIcons
                  name={notifDialog?.tone === 'success' ? 'notifications-active' : notifDialog?.tone === 'warning' ? 'warning-amber' : 'info-outline'}
                  size={18}
                  color="#fff"
                />
              </View>
              <Text style={s.alertTitle}>{notifDialog?.title}</Text>
            </View>
            <Text style={s.alertMessage}>{notifDialog?.message}</Text>
            <TouchableOpacity style={s.alertBtn} onPress={() => setNotifDialog(null)} activeOpacity={0.85}>
              <Text style={s.alertBtnTxt}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: ThemeColors, isOperations = false) {
  const filterOptionActiveShadow = Platform.OS === 'android'
    ? {}
    : {
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: c.isDark ? 0.25 : 0.16,
      shadowRadius: 7,
    };
  const operationPanel = isOperations ? 'rgba(2,8,12,0.68)' : c.card;
  const operationPanelStrong = isOperations ? 'rgba(7,20,20,0.94)' : c.cardSecondary;
  const operationBorder = isOperations ? 'rgba(45,212,191,0.30)' : c.glassBorder;
  const operationBorderSoft = isOperations ? 'rgba(45,212,191,0.18)' : c.border;

  return StyleSheet.create({
    pageHeader: { backgroundColor: isOperations ? 'rgba(2,8,12,0.90)' : c.card, paddingHorizontal: 16, paddingVertical: isOperations ? 16 : 14, borderBottomWidth: 1, borderBottomColor: operationBorderSoft, flexDirection: 'row', alignItems: 'center' },
    notifBtn: { width: 42, height: 42, borderRadius: isOperations ? 14 : 21, backgroundColor: operationPanelStrong, justifyContent: 'center', alignItems: 'center', borderWidth: isOperations ? 1 : 0, borderColor: operationBorder },
    notifBtnActive: { backgroundColor: c.primary, shadowColor: c.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 5 },
    notifBadge: { position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: c.card },
    notifBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#fff' },
    pageTitle: { fontSize: isOperations ? 24 : 22, fontWeight: isOperations ? '900' : 'bold', color: isOperations ? c.text : c.primaryDark, letterSpacing: isOperations ? -0.5 : 0 },
    pageSub: { fontSize: 13, color: c.textSub, marginTop: 2, letterSpacing: isOperations ? 0.7 : 0 },
    controlsRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: isOperations ? 'rgba(2,8,12,0.76)' : c.card, borderBottomWidth: 1, borderBottomColor: operationBorderSoft },
    sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, marginBottom: 8, marginHorizontal: 16, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: isOperations ? 'rgba(45,212,191,0.12)' : c.primaryLight, borderWidth: 1, borderColor: operationBorder },
    sourceBadgeText: { fontSize: 11, fontWeight: '800', color: c.primaryDark },
    segment: { flex: 1, flexDirection: 'row', backgroundColor: isOperations ? 'rgba(2,8,12,0.76)' : c.bg, borderRadius: isOperations ? 14 : 8, padding: 3, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
    segBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: isOperations ? 11 : 6 },
    segBtnActive: { backgroundColor: isOperations ? 'rgba(45,212,191,0.16)' : c.card, borderWidth: 1, borderColor: isOperations ? operationBorder : c.primaryLight },
    segBtnText: { fontSize: 12, fontWeight: '600', color: c.textSub, letterSpacing: isOperations ? 0.6 : 0 },
    segBtnTextActive: { color: isOperations ? c.primaryDark : c.primary, fontWeight: '800' },
    card: { backgroundColor: operationPanel, borderRadius: isOperations ? 18 : 16, marginBottom: 10, overflow: 'hidden', shadowColor: c.primary, shadowOpacity: isOperations || c.isDark ? 0 : 0.08, shadowRadius: 10, elevation: isOperations || c.isDark ? 0 : 3, borderWidth: 1, borderColor: operationBorder, borderLeftWidth: isOperations ? 4 : 1 },
    cardShift: { borderWidth: 1.5, borderColor: '#F59E0B' },
    shiftBanner: { backgroundColor: '#F59E0B', paddingVertical: 5, paddingHorizontal: 12 },
    shiftBannerText: { color: '#fff', fontWeight: 'bold', fontSize: 11, letterSpacing: 0.5 },
    cardPinned: { borderWidth: 2, borderColor: '#F59E0B' },
    pinBanner: { backgroundColor: isOperations ? 'rgba(245,158,11,0.18)' : '#F59E0B', paddingVertical: 5, paddingHorizontal: 12, borderBottomWidth: isOperations ? 1 : 0, borderBottomColor: 'rgba(245,158,11,0.28)' },
    pinBannerText: { color: isOperations ? '#FBBF24' : '#fff', fontWeight: 'bold', fontSize: 11, letterSpacing: 0.5 },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: isOperations ? 10 : 20, marginTop: 8, alignSelf: 'flex-end', borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorderSoft : 'transparent' },
    statusText: { fontSize: 10, fontWeight: '800', letterSpacing: isOperations ? 0.6 : 0 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: isOperations ? 12 : 10, paddingHorizontal: 14, borderBottomWidth: isOperations ? 1 : 0, borderBottomColor: operationBorderSoft },
    airlineBrandRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: isOperations ? 5 : 0, opacity: 0.95 },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerFlightNum: { color: isOperations ? c.primaryDark : '#fff', fontWeight: '900', fontSize: isOperations ? 16 : 15, lineHeight: 18, letterSpacing: isOperations ? 0.6 : 0 },
    headerAirlineName: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.8)', fontSize: 10, letterSpacing: isOperations ? 0.5 : 0 },
    headerMetaFlash: { alignItems: 'flex-end', borderRadius: 12, marginRight: -8, paddingHorizontal: 8, paddingVertical: 4 },
    headerTime: { color: isOperations ? c.text : '#fff', fontWeight: '900', fontSize: isOperations ? 19 : 18, lineHeight: 20, textAlign: 'right', fontVariant: ['tabular-nums'] },
    headerDest: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.8)', fontSize: 10, textAlign: 'right' },
    cardBody: { flexDirection: 'column', paddingVertical: isOperations ? 12 : 10, paddingHorizontal: 14, backgroundColor: operationPanel },
    bodyInfo: { fontSize: 11, color: c.textSub },
    bodyTime: { fontWeight: '700', color: c.text },
    opsRow: { flexDirection: 'row', gap: 8 },
    opsBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isOperations ? 'rgba(45,212,191,0.10)' : c.primaryLight, borderRadius: isOperations ? 12 : 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
    opsIcon: { fontSize: 16 },
    opsLabel: { fontSize: 10, fontWeight: '600', color: c.textSub, letterSpacing: 0.5 },
    opsTime: { fontSize: 13, fontWeight: '800', color: c.primaryDark },
    pinBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
    pinBtnActive: { backgroundColor: 'rgba(245,158,11,0.25)' },
    filterBtn: { width: 42, height: 42, borderRadius: isOperations ? 14 : 21, backgroundColor: operationPanelStrong, justifyContent: 'center', alignItems: 'center', marginRight: 8, borderWidth: isOperations ? 1 : 0, borderColor: operationBorder },
    filterBtnActive: { backgroundColor: c.primary, shadowColor: c.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 5 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    alertOverlay: { flex: 1, backgroundColor: 'rgba(2,6,23,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    alertCard: {
      width: '100%',
      maxWidth: 440,
      borderRadius: 20,
      padding: 18,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.glassBorder,
    },
    alertHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
    alertIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    alertSuccess: { backgroundColor: '#16A34A' },
    alertWarning: { backgroundColor: '#EA580C' },
    alertInfo: { backgroundColor: c.primary },
    alertTitle: { flex: 1, fontSize: 28, fontWeight: '900', color: c.text },
    alertMessage: { fontSize: 17, lineHeight: 24, color: c.textSub, marginBottom: 16 },
    alertBtn: { alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
    alertBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
    filterSheet: { backgroundColor: isOperations ? '#071414' : c.card, borderTopLeftRadius: isOperations ? 28 : 24, borderTopRightRadius: isOperations ? 28 : 24, padding: 20, paddingBottom: 36, borderTopWidth: isOperations ? 1 : 0, borderColor: operationBorder },
    filterSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: isOperations ? 'rgba(45,212,191,0.34)' : c.border, alignSelf: 'center', marginBottom: 16 },
    filterSheetTitle: { fontSize: 16, fontWeight: '800', color: isOperations ? c.primaryDark : c.text, marginBottom: 16, textAlign: 'center', letterSpacing: isOperations ? 0.8 : 0 },
    notifSheetSub: { fontSize: 13, color: c.textSub, textAlign: 'center', marginTop: -8, marginBottom: 16 },
    notifRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    notifRowTextWrap: { flex: 1 },
    notifRowTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    notifRowSub: { fontSize: 12, color: c.textSub, marginTop: 2 },
    notifDivider: { height: 1, backgroundColor: c.border, marginVertical: 10 },
    notifMinutesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
    notifStepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg, borderRadius: 10, padding: 4 },
    notifStepperBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
    notifStepperValue: { minWidth: 54, textAlign: 'center', fontSize: 14, fontWeight: '800', color: c.primaryDark },
    filterOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, marginBottom: 8, borderWidth: 1.5 },
    filterOptionActive: {
      borderWidth: 1.5,
      ...filterOptionActiveShadow,
    },
    filterOptionText: { fontSize: 15, fontWeight: '600', color: c.text },
    filterOptionSub: { fontSize: 12, color: c.textSub, marginTop: 2 },
    filterBrandDotWrap: {
      width: 22,
      height: 22,
      borderRadius: 11,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
    },
    filterBrandDot: { width: 10, height: 10, borderRadius: 5 },
    smFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: isOperations ? 12 : 10, backgroundColor: operationPanel, borderTopWidth: isOperations ? 1 : 0, borderTopColor: operationBorderSoft },
    smPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: isOperations ? 'rgba(45,212,191,0.10)' : c.primaryLight, borderRadius: isOperations ? 10 : 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
    smPillText: { fontSize: 11, fontWeight: '700', color: c.primaryDark },
  });
}
