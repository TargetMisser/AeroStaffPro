import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Modal,
  FlatList, TouchableOpacity, RefreshControl,
  Animated, NativeModules, Platform, Linking, AppState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import BoardReveal from '../components/motion/BoardReveal';
import CockpitFlightProgress from '../components/motion/CockpitFlightProgress';
import TactilePressable from '../components/motion/TactilePressable';
import ValueChangeFlash from '../components/motion/ValueChangeFlash';
import { LogoPill } from '../components/flights/AirlineLogo';
import FlightFilterModal from '../components/flights/FlightFilterModal';
import FlightNotificationSettingsModal from '../components/flights/FlightNotificationSettingsModal';
import FlightSourceDebugModal from '../components/flights/FlightSourceDebugModal';
import { EmptyFlightState, FlightLoadingState } from '../components/flights/FlightStates';
import { SwipeableFlightCard } from '../components/flights/SwipeableFlightCard';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useAirport } from '../context/AirportContext';
import { getAirlineOps, getAirlineColor, getDepartureGateWindow } from '../utils/airlineOps';
import { fetchAirportScheduleRaw, type FlightScheduleProviderStatus } from '../utils/fr24api';
import { fetchStaffMonitorData, normalizeFlightNumber, type StaffMonitorFlight } from '../utils/staffMonitor';
import { formatAirportHeader, getAirportAirlines, getAirportInfo, getStoredAirportAirlines } from '../utils/airportSettings';
import { applyLiveArrivalEtas, applyLiveDepartureStatus, applyLiveOriginDepartures, fetchAdsbAircraft } from '../utils/liveArrivalEta';
import { WIDGET_CACHE_KEY, WIDGET_SHIFT_KEY } from '../widgets/widgetTaskHandler';
import type { WidgetData, WidgetFlight, WidgetShiftData } from '../widgets/widgetTaskHandler';
import { requestShiftWidgetUpdate } from '../widgets/widgetThemeSync';
import { useLanguage } from '../context/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { dismissPinnedFlightNotification, showOrUpdatePinnedFlightNotification } from '../utils/pinnedFlightOngoingNotification';
import { getBestArrivalTs, getBestDepartureTs } from '../utils/flightTimes';
import { isFlightEasyJet } from '../utils/easyjetOverlapMode';
import {
  compareFlightsChronologically,
  filterFlightsByAirlines,
  type FlightDirection,
  getFlightAirportDisplay,
  getFlightAirportLabel,
  getFlightMergeKey,
  isFlightAirlineMatch,
  mergeFlightLists,
  pruneExpiredFlights,
  pruneUnseenFlights,
} from '../utils/flightScheduleAdapter';
import {
  loadFlightScreenCache,
  saveFlightScreenCache,
} from '../utils/flightScreenCache';
import {
  FLIGHT_AUTO_REFRESH_INTERVAL_MS,
  shouldRefreshFlightsOnAppActive,
} from '../utils/flightRefreshPolicy';
import {
  shouldShowBlockingFlightLoader,
  shouldShowFlightRefreshIndicator,
} from '../utils/flightLoadingState';
import { formatFlightSourceLabel } from '../utils/flightSourceLabel';
import { buildFlightradar24FlightUrl } from '../utils/flightExternalLinks';
import {
  hexToRgba,
  mixHexColor,
} from '../utils/airlineBranding';
import {
  clamp,
  DEFAULT_NOTIFICATION_SETTINGS,
  sameAirlineKeys,
  sanitizeNotificationSettings,
  type FlightNotificationSettings,
} from '../utils/flightNotificationSettings';
import {
  appendNotificationDebugEvent,
  NOTIF_ENABLED_KEY,
  NOTIF_SETTINGS_KEY,
} from '../utils/notificationDiagnostics';
import {
  cancelPinnedNotifications,
  cancelPreviousNotifications,
  schedulePinnedNotifications,
  scheduleShiftNotifications,
} from '../utils/flightNotificationScheduler';

const WearDataSender = Platform.OS === 'android' ? NativeModules.WearDataSender : null;

const PINNED_FLIGHT_KEY = 'pinned_flight_v1';
const FLIGHT_FILTER_KEY = 'aerostaff_flight_filter_v1';
type FlightAlertTone = 'success' | 'warning' | 'info';
type FlightDataSourceState = {
  sourceLabel: string;
  fetchedAt: number;
  providerDiagnostics?: FlightScheduleProviderStatus[];
};
type FetchAllOptions = {
  markLoading?: boolean;
  markRefreshing?: boolean;
};

async function openFlightradar24Flight(flightNumber: string): Promise<void> {
  const url = buildFlightradar24FlightUrl(flightNumber);
  if (!url) return;
  await Linking.openURL(url);
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
  const icaoCode = item.flight?.airline?.code?.icao || '';
  const airlineIdentity = [airline, iataCode, icaoCode].filter(Boolean).join(' ');
  const statusText = item.flight?.status?.text || 'Scheduled';
  const raw = item.flight?.status?.generic?.status?.color || 'gray';
  const statusColor = raw === 'green' ? '#10b981' : raw === 'red' ? '#ef4444' : raw === 'yellow' ? '#f59e0b' : '#6b7280';
  const remoteAirport = activeTab === 'arrivals'
    ? item.flight?.airport?.origin
    : item.flight?.airport?.destination;
  const airportDisplay = getFlightAirportDisplay(remoteAirport, 'N/A');
  const originDest = getFlightAirportLabel(remoteAirport, 'N/A');
  const ts = activeTab === 'arrivals' ? item.flight?.time?.scheduled?.arrival : item.flight?.time?.scheduled?.departure;
  const isEasyJet = isFlightEasyJet(item);
  // Header shows the live time (real > estimated > scheduled), so delays surface immediately
  // instead of the card always displaying the original timetable time.
  const bestTs = activeTab === 'arrivals' ? getBestArrivalTs(item) : getBestDepartureTs(item);
  const time = bestTs ? new Date(bestTs * 1000).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: (activeTab === 'arrivals' && isEasyJet) ? '2-digit' : undefined,
  }) : 'N/A';
  const duringShift = userShift && ts && (() => {
    if (activeTab === 'arrivals') return ts >= userShift.start && ts <= userShift.end;
    const opsData = getAirlineOps(airlineIdentity);
    const ciOpen = ts - opsData.checkInOpen * 60;
    const ciClose = ts - opsData.checkInClose * 60;
    const gOpen = ts - opsData.gateOpen * 60;
    const gClose = ts - opsData.gateClose * 60;
    const ciOverlap = ciOpen <= userShift.end && ciClose >= userShift.start;
    const gateOverlap = gOpen <= userShift.end && gClose >= userShift.start;
    return ciOverlap || gateOverlap;
  })();
  const color = getAirlineColor(airlineIdentity);
  const brandAccent = isOperations ? mixHexColor(color, '#FFFFFF', 0.34) : color;
  const airlineTint = hexToRgba(brandAccent, isOperations ? 0.20 : 0.14);
  const airlineTintStrong = hexToRgba(brandAccent, isOperations ? 0.42 : 0.22);
  const airlineBorder = hexToRgba(brandAccent, isOperations ? 0.62 : 0.36);
  const ops = activeTab === 'departures' && ts ? getAirlineOps(airlineIdentity) : null;
  const fmt = (offsetMin: number) =>
    ts ? new Date((ts - offsetMin * 60) * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
  const fmtTs = (t: number) =>
    new Date(t * 1000).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: (activeTab === 'arrivals' && isEasyJet) ? '2-digit' : undefined,
    });

  const reg = item.flight?.aircraft?.registration;
  const inboundTs = reg ? inboundArrivals[reg] : undefined;
  const gateWindow = activeTab === 'departures' && ts && ops
    ? getDepartureGateWindow(ts, ops, inboundTs)
    : null;
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
    const gateOpenTs = gateWindow?.openTs ?? (ts - ops.gateOpen * 60);
    const gateCloseTs = gateWindow?.closeTs ?? (ts - ops.gateClose * 60);
    return (nowTs >= gateOpenTs - 5 * 60 && nowTs < gateOpenTs)
      || (nowTs >= gateCloseTs - 5 * 60 && nowTs < gateCloseTs);
  })() : false;

  useEffect(() => {
    if (!checkinShouldPulse && !gateShouldPulse && !isPinned) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 750, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [checkinShouldPulse, gateShouldPulse, isPinned, pulseAnim]);

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
  const pinnedPulseStyle = isPinned
    ? {
        borderWidth: 2,
        borderColor: pulseAnim.interpolate({
          inputRange: [0, 1],
          outputRange: ['#F59E0B', '#FFF7ED'],
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
        compact={isOperations}
        onToggle={() => isPinned ? onUnpin() : onPin(item)}
      >
        <Animated.View style={pinnedPulseStyle ?? undefined}>
        <TactilePressable
          animatedStyle={[
            s.card,
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
            <View style={s.headerText}>
              <Text numberOfLines={1} style={[s.headerFlightNum, isOperations && { color: brandAccent }]}>{flightNumber}</Text>
              <Text numberOfLines={1} style={[s.headerAirlineName, isOperations && { color: hexToRgba(brandAccent, 0.82) }]}>{airline}</Text>
            </View>
          </View>
          <ValueChangeFlash
            valueKey={`${time}|${airportDisplay.label}`}
            enabled={isOperations}
            style={s.headerMetaFlash}
          >
            <Text style={s.headerTime}>{time}</Text>
            <Text style={s.headerAirportCode}>{airportDisplay.code || airportDisplay.compactLabel}</Text>
            {airportDisplay.name && Boolean(airportDisplay.code) && (
              <Text numberOfLines={2} style={s.headerAirportName}>{airportDisplay.name}</Text>
            )}
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
                valueKey={`${gateWindow ? fmtTs(gateWindow.openTs) : fmt(ops.gateOpen)}|${gateWindow ? fmtTs(gateWindow.closeTs) : fmt(ops.gateClose)}`}
                enabled={isOperations}
                style={[s.opsBadge, gatePulseStyle]}
              >
                <MaterialIcons name="meeting-room" size={16} color={colors.primary} />
                <View>
                  <Text style={s.opsLabel}>{t('flightGate')}</Text>
                  <Text style={s.opsTime}>
                    {gateWindow ? fmtTs(gateWindow.openTs) : fmt(ops.gateOpen)} – {gateWindow ? fmtTs(gateWindow.closeTs) : fmt(ops.gateClose)}
                  </Text>
                </View>
              </ValueChangeFlash>
            </View>
          ) : activeTab === 'arrivals' && ts ? (() => {
            const realDep = item.flight?.time?.real?.departure;
            const estDep = item.flight?.time?.estimated?.departure;
            const schedDep = item.flight?.time?.scheduled?.departure;
            const realArr = item.flight?.time?.real?.arrival;
            const estArr = item.flight?.time?.estimated?.arrival;
            const bestArr = realArr || estArr || ts;
            const delayMin = Math.round((bestArr - ts) / 60);
            const landed = !!realArr;
            const depEstimated = item.flight?._departureSource === 'adsb-estimate';

            const landColor = landed ? '#10B981'
              : delayMin > 20 ? '#EF4444'
              : delayMin > 5 ? '#F59E0B'
              : colors.primary;
            // Arrival card = the inbound's journey: Partenza (from origin) -> Atterraggio
            // (here). Left box is always the departure time (real > ADS-B estimate "~" >
            // scheduled, or --:-- when unknown); right box is the landing, shown as the
            // real touchdown once landed, otherwise the expected landing time.
            const landLabel = landed ? t('flightLanded') : t('flightLandingTime');

            const depTs = realDep ?? estDep ?? schedDep;
            const depApprox = !!depTs && !realDep && depEstimated;
            const depTimeText = depTs ? `${depApprox ? '~' : ''}${fmtTs(depTs)}` : '--:--';

            return (
              <View style={s.opsRow}>
                <ValueChangeFlash
                  valueKey={`dep|${depTimeText}`}
                  enabled={isOperations}
                  style={s.opsBadge}
                >
                  <MaterialIcons name="flight-takeoff" size={16} color={depTs ? colors.primary : '#6B7280'} />
                  <View>
                    <Text style={s.opsLabel}>{t('flightDepartureTime')}</Text>
                    <Text style={[s.opsTime, !depTs && { color: '#6B7280' }]}>{depTimeText}</Text>
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
        </Animated.View>
      </SwipeableFlightCard>
    </BoardReveal>
  );
}

const FlightRow = React.memo(FlightRowComponent);

// ─── Screen ────────────────────────────────────────────────────────────────────
export default function FlightScreen({ isFocused = true }: { isFocused?: boolean }) {
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
  const isOperations = colors.isDark;
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
  const [sourceDebugVisible, setSourceDebugVisible] = useState(false);
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
  const fetchInFlightRef = useRef(false);
  const lastFlightRefreshAttemptAtRef = useRef(0);

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
        providerDiagnostics: cache.providerDiagnostics,
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

  const fetchAll = useCallback(async (options: FetchAllOptions = {}) => {
    if (airportLoading || !isFocused || fetchInFlightRef.current) {
      if (options.markLoading) setLoading(false);
      if (options.markRefreshing) setRefreshing(false);
      return;
    }

    fetchInFlightRef.current = true;
    lastFlightRefreshAttemptAtRef.current = Date.now();
    if (options.markLoading) setLoading(true);
    if (options.markRefreshing) setRefreshing(true);

    try {
      const {
        allArrivals,
        allDepartures,
        departures: fetchedDepartures,
        arrivals: fetchedArrivals,
        sourceLabel,
        fetchedAt,
        providerDiagnostics,
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
      // I voli in cache che NESSUNA fonte conferma da più di 2 ore decadono
      // (cancellati o mai esistiti): senza eviction la cache si auto-rinnova
      // e i voli fantasma sopravvivono fino al loro orario previsto.
      let cachedArrs: any[] = [], cachedDeps: any[] = [];
      try {
        const cache = await loadFlightScreenCache(airportCode);
        const stampLegacy = (item: any) =>
          (typeof item?._seenAtMs === 'number' ? item : { ...item, _seenAtMs: cache?.savedAt ?? Date.now() });
        cachedArrs = (cache?.arrivals ?? []).map(stampLegacy);
        cachedDeps = (cache?.departures ?? []).map(stampLegacy);
      } catch {}
      let mergedArrs = pruneUnseenFlights(
        pruneExpiredFlights(mergeFlightLists(cachedArrs, allArrivals, 'arrival'), 'arrival'),
      );
      let mergedDeps = pruneUnseenFlights(
        pruneExpiredFlights(mergeFlightLists(cachedDeps, allDepartures, 'departure'), 'departure'),
      );

      // Overlay ETA live dai dati ADS-B aperti (stessa fonte grezza di FR24):
      // incrocia gli arrivi per registrazione/callsign con gli aerei in volo
      // e sostituisce la stima con distanza/velocità reali. Best-effort: se
      // l'ADS-B non risponde restano gli orari del FIDS.
      const liveEtaDiagnostics: FlightScheduleProviderStatus[] = [];
      try {
        const airportInfo = getAirportInfo(airportCode);
        if (airportInfo.latitude != null && airportInfo.longitude != null) {
          const adsbController = new AbortController();
          const adsbTimer = setTimeout(() => adsbController.abort(), 8_000);
          const startedAt = Date.now();
          try {
            const aircraft = await fetchAdsbAircraft(
              airportInfo.latitude,
              airportInfo.longitude,
              undefined,
              adsbController.signal,
            );
            mergedArrs = applyLiveArrivalEtas(mergedArrs, aircraft, airportInfo.latitude, airportInfo.longitude);
            // Estimate the inbound's origin-departure time from its route + how far
            // it has flown, but only for arrivals no schedule provider gave a
            // departure time for (a key-backed exact time always wins).
            mergedArrs = await applyLiveOriginDepartures(mergedArrs, aircraft, airportInfo.latitude, airportInfo.longitude);
            // Mark outbound flights whose aircraft is already airborne and
            // climbing away from the field as departed, ahead of the FIDS.
            mergedDeps = applyLiveDepartureStatus(mergedDeps, aircraft, airportInfo.latitude, airportInfo.longitude);
            const matched = mergedArrs.filter(item => item.flight?._etaSource === 'adsb').length;
            const depMatched = mergedArrs.filter(item => item.flight?._departureSource === 'adsb-estimate').length;
            const departed = mergedDeps.filter(item => item.flight?._departureStatusSource === 'adsb').length;
            liveEtaDiagnostics.push({
              provider: 'liveEta',
              label: 'Live ETA (ADS-B)',
              status: 'success',
              arrivals: matched,
              departures: departed,
              durationMs: Date.now() - startedAt,
              message: `${aircraft.length} aerei nel raggio, ${matched} ETA, ${depMatched} decolli stimati, ${departed} decollati`,
            });
          } finally {
            clearTimeout(adsbTimer);
          }
        }
      } catch (e) {
        if (__DEV__) console.log('[liveEta]', e);
        liveEtaDiagnostics.push({
          provider: 'liveEta',
          label: 'Live ETA (ADS-B)',
          status: 'failed',
          message: String((e as any)?.message ?? e).slice(0, 120),
        });
      }
      const sourceState: FlightDataSourceState = {
        sourceLabel: sourceLabel ?? 'Sconosciuta',
        fetchedAt: fetchedAt ?? Date.now(),
        providerDiagnostics: [...(providerDiagnostics ?? []), ...liveEtaDiagnostics],
      };
      setAllArrivalsFull(mergedArrs);
      setAllDeparturesFull(mergedDeps);
      setFlightDataSource(sourceState);
      // I voli sintetizzati dalla tabella rotte AirLabs sono stime di orario,
      // non voli osservati: mostrali pure come fallback, ma non persisterli
      // in cache, così spariscono al primo fetch buono invece di restare
      // come fantasmi per ore.
      const isPersistable = (item: any) => item?.flight?._source !== 'airlabs_routes';
      saveFlightScreenCache({
        airportCode,
        arrivals: mergedArrs.filter(isPersistable),
        departures: mergedDeps.filter(isPersistable),
        sourceLabel: sourceState.sourceLabel,
        fetchedAt: sourceState.fetchedAt,
        providerDiagnostics: sourceState.providerDiagnostics,
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
        const activeWidgetShift = (shiftToday && nowSec <= shiftToday.end)
          ? { date: todayIso, ...shiftToday, isNext: false }
          : ((!shiftToday || nowSec > shiftToday.end) && nextShift && nextShift.start > nowSec)
            ? { ...nextShift, isNext: true }
            : null;

        let widgetData: WidgetData;
        if (activeWidgetShift) {
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
              const airlineIdentity = [
                airline,
                item.flight?.airline?.code?.iata,
                item.flight?.airline?.code?.icao,
              ].filter(Boolean).join(' ');
              const ops = getAirlineOps(airlineIdentity);
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
                airlineColor: getAirlineColor(airlineIdentity),
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
        } else if (isRestDay) {
          widgetData = { state: 'rest' };
        } else {
          widgetData = { state: 'no_shift' };
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
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const providerUnavailable = message.includes('NO_FLIGHT_PROVIDER_AVAILABLE');

      if (providerUnavailable) {
        setAllArrivalsFull([]);
        setAllDeparturesFull([]);
        setArrivals([]);
        setDepartures([]);
        setFlightDataSource({
          sourceLabel: 'Nessuna fonte voli disponibile',
          fetchedAt: Date.now(),
          providerDiagnostics: [{
            provider: 'cache',
            label: 'Fonti voli',
            status: 'failed',
            message,
          }],
        });
      }

      if (__DEV__) {
        if (providerUnavailable) console.log('[fetchAll]', message);
        else console.error('[fetchAll]', e);
      }
    } finally {
      fetchInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeProfile, airportCode, airportLoading, applySelectedAirlines, isFocused]);

  useEffect(() => {
    if (airportLoading || !isFocused) return;
    fetchAll({ markLoading: true });
  }, [airportLoading, fetchAll, isFocused]);

  // Auto-refresh flight data every 2 minutes so status/times stay current
  useEffect(() => {
    if (airportLoading || !isFocused) return;
    const iv = setInterval(() => { fetchAll(); }, FLIGHT_AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [airportLoading, fetchAll, isFocused]);

  useEffect(() => {
    if (airportLoading || !isFocused) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (!shouldRefreshFlightsOnAppActive({
        isFocused,
        airportLoading,
        lastRefreshAttemptAt: lastFlightRefreshAttemptAtRef.current,
        nowMs: Date.now(),
      })) {
        return;
      }
      fetchAll({ markRefreshing: true });
    });
    return () => subscription.remove();
  }, [airportLoading, fetchAll, isFocused]);

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
    if (!isFocused) return;
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
  }, [isFocused]);

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
        const airlineIdentity = [
          item.flight?.airline?.name,
          item.flight?.airline?.code?.iata,
          item.flight?.airline?.code?.icao,
        ].filter(Boolean).join(' ');
        const payload = JSON.stringify({
          flightNumber: item.flight?.identification?.number?.default || '',
          airline: item.flight?.airline?.name || '',
          airlineColor: getAirlineColor(airlineIdentity),
          iataCode: item.flight?.airline?.code?.iata || '',
          tab,
          destination: getFlightAirportLabel(item.flight?.airport?.destination, ''),
          origin: getFlightAirportLabel(item.flight?.airport?.origin, ''),
          scheduledTime: tab === 'departures' ? item.flight?.time?.scheduled?.departure : item.flight?.time?.scheduled?.arrival,
          estimatedTime: tab === 'departures' ? item.flight?.time?.estimated?.departure : item.flight?.time?.estimated?.arrival,
          realDeparture: item.flight?.time?.real?.departure || null,
          realArrival: item.flight?.time?.real?.arrival || null,
          ops: tab === 'departures' ? getAirlineOps(airlineIdentity) : null,
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

  const currentDayRawData = (() => {
    const source = activeTab === 'arrivals' ? allArrivalsFull : allDeparturesFull;
    const timeField = activeTab === 'arrivals' ? 'arrival' : 'departure';
    const seen = new Set<string>();
    return source.filter(item => {
      const ts = activeTab === 'arrivals' ? getBestArrivalTs(item) : getBestDepartureTs(item);
      if (!ts || !isSameDay(new Date(ts * 1000), selectedDate)) return false;
      const dedupeKey = getFlightMergeKey(item, timeField);
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    }).sort(compareFlightsChronologically(timeField));
  })();

  const currentData = (() => {
    const timeField: FlightDirection = activeTab === 'arrivals' ? 'arrival' : 'departure';
    return filterFlightsByAirlines(currentDayRawData, selectedAirlines)
      .sort(compareFlightsChronologically(timeField));
  })();
  const hasFlightSnapshot = allArrivalsFull.length > 0 || allDeparturesFull.length > 0;
  const showBlockingLoader = shouldShowBlockingFlightLoader({
    isLoading: loading,
    hasVisibleFlights: hasFlightSnapshot,
  });
  const showRefreshIndicator = shouldShowFlightRefreshIndicator({
    isLoading: loading,
    isRefreshing: refreshing,
    hasVisibleFlights: hasFlightSnapshot,
  });

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

      {(flightDataSource || showRefreshIndicator) && (
        <View style={s.sourceRow}>
          {flightDataSource && (
            <TouchableOpacity
              style={s.sourceBadge}
              activeOpacity={0.85}
              onPress={() => setSourceDebugVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t('flightSourceDebugTitle')}
            >
              <MaterialIcons name="hub" size={14} color={colors.primary} />
              <Text style={s.sourceBadgeText}>
                {t('flightDataSource')}: {formatFlightSourceLabel(flightDataSource.sourceLabel)}
              </Text>
            </TouchableOpacity>
          )}
          {showRefreshIndicator && (
            <View style={s.refreshBadge}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={s.refreshBadgeText}>{t('flightRefreshing')}</Text>
            </View>
          )}
        </View>
      )}

      {showBlockingLoader ? (
        <FlightLoadingState colors={colors} t={t} />
      ) : (
        <FlatList
          data={currentData}
          keyExtractor={(item, i) => item.flight?.identification?.id || String(i)}
          renderItem={renderFlight}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: isOperations ? 8 : 18,
            paddingBottom: isOperations ? 176 : 120,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { fetchAll({ markRefreshing: true }); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyFlightState
              activeDay={activeDay}
              activeTab={activeTab}
              rawDayCount={currentDayRawData.length}
              sourceLabel={flightDataSource?.sourceLabel}
              diagnostics={flightDataSource?.providerDiagnostics}
              colors={colors}
              t={t}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <FlightFilterModal
        visible={filterMenuVisible}
        allSelected={allSelected}
        airportAirlines={airportAirlines}
        selectedAirlines={selectedAirlines}
        colors={colors}
        styles={s}
        t={t}
        onClose={() => setFilterMenuVisible(false)}
        onApplySelectedAirlines={applySelectedAirlines}
      />

      <FlightSourceDebugModal
        visible={sourceDebugVisible}
        activeDay={activeDay}
        activeTab={activeTab}
        sourceLabel={flightDataSource?.sourceLabel}
        fetchedAt={flightDataSource?.fetchedAt}
        diagnostics={flightDataSource?.providerDiagnostics}
        visibleCount={currentData.length}
        rawDayCount={currentDayRawData.length}
        selectedAirlinesCount={selectedAirlines.length}
        airportAirlinesCount={airportAirlines.length}
        isRefreshing={showRefreshIndicator}
        colors={colors}
        t={t}
        locale={locale}
        onClose={() => setSourceDebugVisible(false)}
      />

      <FlightNotificationSettingsModal
        visible={notifSettingsVisible}
        notifsEnabled={notifsEnabled}
        notifSummary={notifSummary}
        notifSettings={notifSettings}
        colors={colors}
        styles={s}
        t={t}
        onClose={() => setNotifSettingsVisible(false)}
        onSetNotificationsEnabled={setNotificationsEnabled}
        onUpdateNotificationSettings={updateNotificationSettings}
      />

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
    pageHeader: { backgroundColor: isOperations ? 'rgba(2,8,12,0.90)' : c.card, paddingHorizontal: 16, paddingVertical: isOperations ? 12 : 14, borderBottomWidth: 1, borderBottomColor: operationBorderSoft, flexDirection: 'row', alignItems: 'center' },
    notifBtn: { width: 42, height: 42, borderRadius: isOperations ? 14 : 21, backgroundColor: operationPanelStrong, justifyContent: 'center', alignItems: 'center', borderWidth: isOperations ? 1 : 0, borderColor: operationBorder },
    notifBtnActive: { backgroundColor: c.primary, shadowColor: c.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 5 },
    notifBadge: { position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: c.card },
    notifBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#fff' },
    pageTitle: { fontSize: isOperations ? 24 : 22, fontWeight: isOperations ? '900' : 'bold', color: isOperations ? c.text : c.primaryDark, letterSpacing: isOperations ? -0.5 : 0 },
    pageSub: { fontSize: 13, color: c.textSub, marginTop: 2, letterSpacing: isOperations ? 0.7 : 0 },
    controlsRow: { flexDirection: 'row', gap: 8, padding: isOperations ? 9 : 12, backgroundColor: isOperations ? 'rgba(2,8,12,0.76)' : c.card, borderBottomWidth: 1, borderBottomColor: operationBorderSoft },
    sourceRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginTop: isOperations ? 8 : 10, marginBottom: isOperations ? 2 : 8, marginHorizontal: 16 },
    sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', flexShrink: 1, paddingHorizontal: 10, paddingVertical: isOperations ? 6 : 7, borderRadius: 999, backgroundColor: isOperations ? 'rgba(45,212,191,0.12)' : c.primaryLight, borderWidth: 1, borderColor: operationBorder },
    sourceBadgeText: { flexShrink: 1, flexWrap: 'wrap', fontSize: 11, lineHeight: 15, fontWeight: '800', color: c.primaryDark },
    refreshBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: isOperations ? 6 : 7, borderRadius: 999, backgroundColor: isOperations ? 'rgba(15,23,42,0.82)' : c.cardSecondary, borderWidth: 1, borderColor: operationBorderSoft },
    refreshBadgeText: { fontSize: 11, fontWeight: '800', color: c.textSub },
    segment: { flex: 1, flexDirection: 'row', backgroundColor: isOperations ? 'rgba(2,8,12,0.76)' : c.bg, borderRadius: isOperations ? 14 : 8, padding: 3, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
    segBtn: { flex: 1, paddingVertical: isOperations ? 6 : 7, alignItems: 'center', borderRadius: isOperations ? 11 : 6 },
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
    statusPill: { paddingHorizontal: 10, paddingVertical: isOperations ? 3 : 4, borderRadius: isOperations ? 10 : 20, marginTop: isOperations ? 6 : 8, alignSelf: 'flex-end', borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorderSoft : 'transparent' },
    statusText: { fontSize: 10, fontWeight: '800', letterSpacing: isOperations ? 0.6 : 0 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: isOperations ? 9 : 10, paddingHorizontal: 14, borderBottomWidth: isOperations ? 1 : 0, borderBottomColor: operationBorderSoft },
    airlineBrandRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: isOperations ? 5 : 0, opacity: 0.95 },
    headerLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerText: { flex: 1, minWidth: 0 },
    headerFlightNum: { color: isOperations ? c.primaryDark : '#fff', fontWeight: '900', fontSize: isOperations ? 16 : 15, lineHeight: 18, letterSpacing: isOperations ? 0.6 : 0 },
    headerAirlineName: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.8)', fontSize: 10, letterSpacing: isOperations ? 0.5 : 0 },
    headerMetaFlash: { alignItems: 'flex-end', borderRadius: 12, marginRight: -8, paddingHorizontal: 8, paddingVertical: 4, maxWidth: isOperations ? 150 : 142, flexShrink: 0 },
    headerTime: { color: isOperations ? c.text : '#fff', fontWeight: '900', fontSize: isOperations ? 19 : 18, lineHeight: 20, textAlign: 'right', fontVariant: ['tabular-nums'] },
    headerDest: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.8)', fontSize: 10, textAlign: 'right' },
    headerAirportCode: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.86)', fontSize: isOperations ? 11 : 10, lineHeight: 13, fontWeight: '900', letterSpacing: isOperations ? 1.1 : 0.8, textAlign: 'right' },
    headerAirportName: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.72)', fontSize: isOperations ? 9 : 8.5, lineHeight: isOperations ? 10.5 : 10, textAlign: 'right' },
    cardBody: { flexDirection: 'column', paddingVertical: isOperations ? 9 : 10, paddingHorizontal: 14, backgroundColor: operationPanel },
    bodyInfo: { fontSize: 11, color: c.textSub },
    bodyTime: { fontWeight: '700', color: c.text },
    opsRow: { flexDirection: 'row', gap: 8 },
    opsBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isOperations ? 'rgba(45,212,191,0.10)' : c.primaryLight, borderRadius: isOperations ? 12 : 10, paddingHorizontal: 10, paddingVertical: isOperations ? 6 : 8, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
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
    smFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: isOperations ? 8 : 10, backgroundColor: operationPanel, borderTopWidth: isOperations ? 1 : 0, borderTopColor: operationBorderSoft },
    smPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: isOperations ? 'rgba(45,212,191,0.10)' : c.primaryLight, borderRadius: isOperations ? 10 : 8, paddingHorizontal: 8, paddingVertical: isOperations ? 3 : 4, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
    smPillText: { fontSize: 11, fontWeight: '700', color: c.primaryDark },
  });
}
