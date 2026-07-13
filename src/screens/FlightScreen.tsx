import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Modal,
  FlatList, TouchableOpacity, RefreshControl,
  Animated, Platform, Linking, AppState,
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
import { statusToToken, delayToToken } from '../utils/statusColors';
import {
  enrichFlightScheduleWithFr24Ids,
  fetchAirportScheduleRaw,
  resolveFlightradar24IdForFlight,
  type FlightScheduleProviderStatus,
} from '../utils/fr24api';
import { fetchStaffMonitorData, normalizeFlightNumber, type StaffMonitorFlight } from '../utils/staffMonitor';
import { formatAirportHeader, getAirportAirlines, getAirportInfo, getStoredAirportAirlines, reconcileSelectedAirlines } from '../utils/airportSettings';
import { applyLiveArrivalEtas, applyLiveDepartureStatus, applyLiveOriginDepartures, fetchAdsbAircraft } from '../utils/liveArrivalEta';
import { WIDGET_CACHE_KEY, WIDGET_SHIFT_KEY } from '../widgets/widgetTaskHandler';
import type { WidgetData, WidgetFlight, WidgetShiftData } from '../widgets/widgetTaskHandler';
import { requestShiftWidgetUpdate } from '../widgets/widgetThemeSync';
import { useLanguage } from '../context/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { dismissPinnedFlightNotification, showOrUpdatePinnedFlightNotification } from '../utils/pinnedFlightOngoingNotification';
import { getBestArrivalTs, getBestDepartureTs, getScheduledFlightTs } from '../utils/flightTimes';
import { isFlightEasyJet } from '../utils/easyjetOverlapMode';
import {
  filterFlightsByAirlines,
  type FlightDirection,
  getFlightAirportDisplay,
  getFlightAirportLabel,
  isFlightServiceMatch,
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
import {
  buildFlightradar24AirportBoardUrl,
  buildFlightradar24FlightPageUrl,
  getFlightradar24ArrivalTarget,
  getFlightradar24FlightId,
  mergeFlightExternalLinkMetadata,
} from '../utils/flightExternalLinks';
import {
  buildUnifiedFlightList,
  filterActiveUnifiedFlights,
  filterUnifiedFlightsByAirlines,
  TURNAROUND_MATCH_WINDOW_SECONDS,
  type UnifiedFlightListEntry,
} from '../utils/unifiedFlightList';
import {
  hexToRgba,
  mixHexColor,
} from '../utils/airlineBranding';
import {
  clamp,
  DEFAULT_NOTIFICATION_SETTINGS,
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
import { reconcilePinnedFlight } from '../utils/pinnedFlightLifecycle';
import {
  restoreStorageValueIfUnchanged,
  runEffectsForCurrentRequest,
  updateStorageForCurrentRequest,
} from '../utils/currentRequestEffects';
import { TYPE, WEIGHT } from '../theme/typography';
import { SPACING, RADIUS } from '../theme/spacing';

const PINNED_FLIGHT_KEY = 'pinned_flight_v1';
const FLIGHT_FILTER_KEY = 'aerostaff_flight_filter_v1';
const EMPTY_STAFF_MONITOR_FLIGHTS: StaffMonitorFlight[] = [];
type FlightAlertTone = 'success' | 'warning' | 'info';
type FlightDataSourceState = {
  airportCode: string;
  sourceLabel: string;
  fetchedAt: number;
  providerDiagnostics?: FlightScheduleProviderStatus[];
};
type FetchAllOptions = {
  markLoading?: boolean;
  markRefreshing?: boolean;
};

async function openFlightradar24Arrival(
  arrivalItem: any | null,
  airportCode: string,
): Promise<void> {
  const flightNumber = arrivalItem?.flight?.identification?.number?.default || '';
  let fr24Id = getFlightradar24FlightId(arrivalItem);
  if (arrivalItem && !fr24Id) {
    try {
      fr24Id = await resolveFlightradar24IdForFlight(airportCode, arrivalItem, 'arrival');
    } catch {}
  }
  const url = buildFlightradar24FlightPageUrl(flightNumber, fr24Id);
  if (!url) return;
  await Linking.openURL(url);
}

async function openFlightradar24AirportArrivals(airportCode: string): Promise<void> {
  const url = buildFlightradar24AirportBoardUrl(airportCode, 'arrival');
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
  linkedArrival?: any;
  index: number;
  direction: FlightDirection;
  airportCode: string;
  userShift: { start: number; end: number } | null;
  pinnedFlight: any | null;
  onPin: (item: any, direction: FlightDirection) => void;
  onUnpin: () => void;
  colors: ThemeColors;
  isOperations: boolean;
  s: ReturnType<typeof makeStyles>;
  smPool: StaffMonitorFlight[];
  locale: string;
  t: (key: TranslationKey) => string;
}

function FlightRowComponent({ item, linkedArrival, index, direction, airportCode, userShift, pinnedFlight, onPin, onUnpin, colors, isOperations, s, smPool, locale, t }: FlightRowProps) {
  const flightNumber = item.flight?.identification?.number?.default || 'N/A';
  const isArrival = direction === 'arrival';
  const directionLabel = t(isArrival ? 'flightArrival' : 'flightDeparture');
  const directionColor = isOperations ? (isArrival ? '#7DD3FC' : '#FBBF24') : '#FFFFFF';
  const directionBadgeBackground = isOperations
    ? hexToRgba(directionColor, 0.12)
    : 'rgba(15,23,42,0.82)';
  const directionBadgeBorder = isOperations ? directionColor : 'rgba(255,255,255,0.88)';
  const arrivalLinkItem = getFlightradar24ArrivalTarget(item, linkedArrival, direction);
  const arrivalLinkFlightNumber = arrivalLinkItem?.flight?.identification?.number?.default || '';
  const canOpenArrivalLink = Boolean(arrivalLinkItem && arrivalLinkFlightNumber);
  const fr24AccessibilityLabel = canOpenArrivalLink
    ? t('flightOpenOnFr24')
        .replace('{direction}', t('flightArrival').toLowerCase())
        .replace('{flight}', arrivalLinkFlightNumber)
    : t('flightLinkedArrivalPending');
  const airline = item.flight?.airline?.name || 'Sconosciuta';
  const iataCode = item.flight?.airline?.code?.iata || '';
  const icaoCode = item.flight?.airline?.code?.icao || '';
  const airlineIdentity = [airline, iataCode, icaoCode].filter(Boolean).join(' ');
  const statusText = item.flight?.status?.text || 'Scheduled';
  const raw = item.flight?.status?.generic?.status?.color || 'gray';
  const statusColor = statusToToken(raw, colors);
  const remoteAirport = isArrival
    ? item.flight?.airport?.origin
    : item.flight?.airport?.destination;
  const airportDisplay = getFlightAirportDisplay(remoteAirport, 'N/A');
  const originDest = getFlightAirportLabel(remoteAirport, 'N/A');
  const ts = isArrival ? item.flight?.time?.scheduled?.arrival : item.flight?.time?.scheduled?.departure;
  const isEasyJet = isFlightEasyJet(item);
  // Operational calculations and ordering are anchored to STA/STD. Live
  // estimates stay in the detail rows and never replace the header time.
  const time = ts ? new Date(ts * 1000).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: (isArrival && isEasyJet) ? '2-digit' : undefined,
  }) : 'N/A';
  const duringShift = userShift && ts && (() => {
    if (isArrival) return ts >= userShift.start && ts <= userShift.end;
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
  const ops = !isArrival ? getAirlineOps(airlineIdentity) : null;
  const scheduledDepartureTs = !isArrival ? item.flight?.time?.scheduled?.departure : undefined;
  const estimatedDepartureTs = !isArrival
    ? item.flight?.time?.estimated?.departure
    : undefined;
  const fmt = (offsetMin: number) =>
    ts ? new Date((ts - offsetMin * 60) * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '--:--';
  const fmtTs = (t: number) =>
    new Date(t * 1000).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: (isArrival && isEasyJet) ? '2-digit' : undefined,
    });
  const fmtOptionalTs = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? fmtTs(value) : '--:--';

  const linkedArrivalNumber = linkedArrival?.flight?.identification?.number?.default || '—';
  const linkedArrivalOrigin = getFlightAirportDisplay(linkedArrival?.flight?.airport?.origin, 'N/A');
  const linkedArrivalScheduledTs = linkedArrival?.flight?.time?.scheduled?.arrival;
  const linkedArrivalEstimatedTs = linkedArrival?.flight?.time?.estimated?.arrival;
  const linkedArrivalRealTs = linkedArrival?.flight?.time?.real?.arrival;
  const linkedArrivalCurrentTs = linkedArrivalRealTs ?? linkedArrivalEstimatedTs;
  const linkedArrivalDelayMinutes = linkedArrivalScheduledTs && linkedArrivalCurrentTs
    ? Math.round((linkedArrivalCurrentTs - linkedArrivalScheduledTs) / 60)
    : 0;
  const linkedArrivalColor = linkedArrivalCurrentTs
    ? delayToToken(linkedArrivalDelayMinutes, Boolean(linkedArrivalRealTs), colors, colors.success)
    : colors.neutral;

  const gateWindow = !isArrival && ts && ops
    ? getDepartureGateWindow(ts, ops)
    : null;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const [nowTs, setNowTs] = useState(() => Date.now() / 1000);

  const pinnedDirection: FlightDirection = pinnedFlight?._pinTab === 'arrivals' ? 'arrival' : 'departure';
  const primaryIsPinned = pinnedFlight != null
    && pinnedDirection === direction
    && isFlightServiceMatch(pinnedFlight, item, direction);
  const linkedArrivalIsPinned = pinnedFlight != null
    && linkedArrival != null
    && pinnedDirection === 'arrival'
    && isFlightServiceMatch(pinnedFlight, linkedArrival, 'arrival');
  const isPinned = primaryIsPinned || linkedArrivalIsPinned;

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

  const arrivalProgress = isArrival && ts ? (() => {
    const scheduledDep = item.flight?.time?.scheduled?.departure;
    const estimatedDep = item.flight?.time?.estimated?.departure;
    const realDep = item.flight?.time?.real?.departure;
    const estimatedArr = item.flight?.time?.estimated?.arrival;
    const realArr = item.flight?.time?.real?.arrival;
    const startTs = realDep || estimatedDep || scheduledDep;
    const endTs = realArr || estimatedArr || ts;
    if (!startTs || !endTs || endTs <= startTs) return null;

    const delayMin = Math.round((endTs - ts) / 60);
    const progressColor = delayToToken(delayMin, !!realArr, colors);

    return {
      startTs,
      endTs,
      progress: realArr ? 1 : clamp((Date.now() / 1000 - startTs) / (endTs - startTs), 0, 1),
      departureColor: realDep ? colors.primary : colors.neutral,
      arrivalColor: progressColor,
      planeColor: progressColor,
    };
  })() : null;

  const checkinShouldPulse = !isArrival && ts && ops ? (() => {
    const ciOpenTs = ts - ops.checkInOpen * 60;
    const ciCloseTs = ts - ops.checkInClose * 60;
    return (nowTs >= ciOpenTs - 10 * 60 && nowTs < ciOpenTs)
      || (nowTs >= ciCloseTs - 10 * 60 && nowTs < ciCloseTs);
  })() : false;
  const gateShouldPulse = !isArrival && ts && ops ? (() => {
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
        onToggle={() => isPinned ? onUnpin() : onPin(item, direction)}
      >
        <Animated.View style={pinnedPulseStyle ?? undefined}>
        <TactilePressable
          animatedStyle={[
            s.card,
            !isArrival && s.departureCard,
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
          disabled={!canOpenArrivalLink}
          onPress={canOpenArrivalLink
            ? () => { openFlightradar24Arrival(arrivalLinkItem, airportCode).catch(() => {}); }
            : undefined}
          accessibilityRole="link"
          accessibilityLabel={fr24AccessibilityLabel}
          accessibilityState={{ disabled: !canOpenArrivalLink }}
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
              <View style={s.headerFlightRow}>
                <Text numberOfLines={1} style={[s.headerFlightNum, isOperations && { color: brandAccent }]}>{flightNumber}</Text>
                <View style={[s.directionBadge, { borderColor: directionBadgeBorder, backgroundColor: directionBadgeBackground }]}>
                  <MaterialIcons name={isArrival ? 'flight-land' : 'flight-takeoff'} size={10} color={directionColor} />
                  <Text style={[s.directionBadgeText, { color: directionColor }]}>{directionLabel}</Text>
                </View>
              </View>
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
        {!isArrival && (
          <View style={s.linkedArrivalPanel}>
            <View style={s.linkedArrivalIdentity}>
              <View style={s.linkedArrivalTitleRow}>
                <MaterialIcons
                  name={linkedArrival ? 'flight-land' : 'link-off'}
                  size={16}
                  color={linkedArrival ? colors.primary : colors.neutral}
                />
                <Text style={s.linkedArrivalTitle}>{t('flightLinkedArrival')}</Text>
              </View>
              {linkedArrival ? (
                <Text numberOfLines={1} style={s.linkedArrivalRoute}>
                  {linkedArrivalNumber} · {linkedArrivalOrigin.compactLabel}
                </Text>
              ) : (
                <Text style={s.linkedArrivalPending}>{t('flightLinkedArrivalPending')}</Text>
              )}
            </View>
            {linkedArrival && (
              <View style={s.linkedArrivalTimes}>
                <View style={s.linkedArrivalTimeBlock}>
                  <Text style={s.linkedArrivalTimeLabel}>{t('flightSta')}</Text>
                  <Text style={s.linkedArrivalTime}>{fmtOptionalTs(linkedArrivalScheduledTs)}</Text>
                </View>
                <View style={s.linkedArrivalTimeBlock}>
                  <Text style={[s.linkedArrivalTimeLabel, { color: linkedArrivalColor }]}>
                    {linkedArrivalRealTs ? t('flightAta') : t('flightEta')}
                  </Text>
                  <Text style={[s.linkedArrivalTime, { color: linkedArrivalColor }]}>
                    {fmtOptionalTs(linkedArrivalCurrentTs)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
        {/* Body */}
        <View style={s.cardBody}>
          {!isArrival && ops ? (
            <>
              <View style={[s.opsRow, s.departureTimesRow]}>
                <ValueChangeFlash
                  valueKey={`scheduled|${scheduledDepartureTs ?? 'missing'}`}
                  enabled={isOperations}
                  style={[s.opsBadge, s.departureTimeBadge]}
                >
                  <MaterialIcons name="schedule" size={18} color={colors.textSub} />
                  <View style={s.opsTextWrap}>
                    <Text style={s.opsLabel}>{t('flightScheduledDeparture')}</Text>
                    <Text style={s.opsTime}>{fmtOptionalTs(scheduledDepartureTs)}</Text>
                  </View>
                </ValueChangeFlash>
                <ValueChangeFlash
                  valueKey={`estimated|${estimatedDepartureTs ?? 'missing'}`}
                  enabled={isOperations}
                  style={[s.opsBadge, s.departureTimeBadge]}
                >
                  <MaterialIcons name="update" size={18} color={colors.primary} />
                  <View style={s.opsTextWrap}>
                    <Text style={[s.opsLabel, { color: colors.primary }]}>{t('flightEstimatedDeparture')}</Text>
                    <Text style={s.opsTime}>{fmtOptionalTs(estimatedDepartureTs)}</Text>
                  </View>
                </ValueChangeFlash>
              </View>
              <View style={s.opsRow}>
                <ValueChangeFlash
                  valueKey={`${fmt(ops.checkInOpen)}|${fmt(ops.checkInClose)}`}
                  enabled={isOperations}
                  style={[s.opsBadge, checkinPulseStyle]}
                >
                  <MaterialIcons name="desktop-windows" size={18} color={colors.primary} />
                  <View style={s.opsTextWrap}>
                    <Text style={s.opsLabel}>{t('flightCheckin')}</Text>
                    <Text style={s.opsTime}>{fmt(ops.checkInOpen)} – {fmt(ops.checkInClose)}</Text>
                  </View>
                </ValueChangeFlash>
                <ValueChangeFlash
                  valueKey={`${gateWindow ? fmtTs(gateWindow.openTs) : fmt(ops.gateOpen)}|${gateWindow ? fmtTs(gateWindow.closeTs) : fmt(ops.gateClose)}`}
                  enabled={isOperations}
                  style={[s.opsBadge, gatePulseStyle]}
                >
                  <MaterialIcons name="meeting-room" size={18} color={colors.primary} />
                  <View style={s.opsTextWrap}>
                    <Text style={s.opsLabel}>{t('flightGate')}</Text>
                    <Text style={s.opsTime}>
                      {gateWindow ? fmtTs(gateWindow.openTs) : fmt(ops.gateOpen)} – {gateWindow ? fmtTs(gateWindow.closeTs) : fmt(ops.gateClose)}
                    </Text>
                  </View>
                </ValueChangeFlash>
              </View>
            </>
          ) : isArrival && ts ? (() => {
            const realDep = item.flight?.time?.real?.departure;
            const estDep = item.flight?.time?.estimated?.departure;
            const schedDep = item.flight?.time?.scheduled?.departure;
            const realArr = item.flight?.time?.real?.arrival;
            const estArr = item.flight?.time?.estimated?.arrival;
            const bestArr = realArr || estArr || ts;
            const delayMin = Math.round((bestArr - ts) / 60);
            const landed = !!realArr;
            const depEstimated = item.flight?._departureSource === 'adsb-estimate';

            const landColor = delayToToken(delayMin, landed, colors);
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
                  <MaterialIcons name="flight-takeoff" size={16} color={depTs ? colors.primary : colors.neutral} />
                  <View>
                    <Text style={s.opsLabel}>{t('flightDepartureTime')}</Text>
                    <Text style={[s.opsTime, !depTs && { color: colors.neutral }]}>{depTimeText}</Text>
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
          {isArrival && ts ? (() => {
            const rArr = item.flight?.time?.real?.arrival;
            const eArr = item.flight?.time?.estimated?.arrival;
            const bArr = rArr || eArr || ts;
            const dMin = Math.round((bArr - ts) / 60);
            const isLanded = !!rArr;
            const dText = isLanded ? 'Atterrato' : dMin > 0 ? `+${dMin} min` : 'In orario';
            const dColor = delayToToken(dMin, isLanded, colors, colors.success);
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
          {!isArrival ? (
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
  const [activeDay, setActiveDay] = useState<'today' | 'tomorrow'>('today');
  const [arrivals, setArrivals] = useState<any[]>([]);
  const [departures, setDepartures] = useState<any[]>([]);
  const [shifts, setShifts] = useState<{ today: { start: number; end: number } | null; tomorrow: { start: number; end: number } | null }>({ today: null, tomorrow: null });
  const [notifsEnabled, setNotifsEnabled] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [pinnedFlight, setPinnedFlight] = useState<any | null>(null);
  const [filterMenuVisible, setFilterMenuVisible] = useState(false);
  const [sourceDebugVisible, setSourceDebugVisible] = useState(false);
  const [notifSettingsVisible, setNotifSettingsVisible] = useState(false);
  const [notifDialog, setNotifDialog] = useState<{ title: string; message: string; tone: FlightAlertTone } | null>(null);
  const [allArrivalsFull, setAllArrivalsFull] = useState<any[]>([]);
  const [allDeparturesFull, setAllDeparturesFull] = useState<any[]>([]);
  const [flightSnapshotAirportCode, setFlightSnapshotAirportCode] = useState<string | null>(null);
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
  const selectedAirlinesRef = useRef<string[]>([]);
  const notifSettingsRef = useRef<FlightNotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const selectedAirlinesNotifSignatureRef = useRef<string>('');
  const airportCodeRef = useRef(airportCode);
  const fetchInFlightRef = useRef<{ airportCode: string; requestId: number } | null>(null);
  const flightRequestIdRef = useRef(0);
  const freshSnapshotAirportRef = useRef<string | null>(null);
  const lastFlightRefreshAttemptAtRef = useRef(0);
  airportCodeRef.current = airportCode;

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

    // A snapshot is only valid for the airport that produced it. Clear the
    // previous profile synchronously, then hydrate only a cache whose embedded
    // airportCode matches the newly selected airport.
    setAllArrivalsFull([]);
    setAllDeparturesFull([]);
    setArrivals([]);
    setDepartures([]);
    setFlightSnapshotAirportCode(null);
    setFlightDataSource(null);
    freshSnapshotAirportRef.current = null;

    loadFlightScreenCache(airportCode, true).then(cache => {
      if (!active || !cache || freshSnapshotAirportRef.current === airportCode) return;
      setAllArrivalsFull(cache.arrivals);
      setAllDeparturesFull(cache.departures);
      setFlightSnapshotAirportCode(airportCode);
      setFlightDataSource({
        airportCode,
        sourceLabel: cache.isStale ? `${cache.sourceLabel} · cache in aggiornamento` : cache.sourceLabel,
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
    if (airportLoading || !isFocused) {
      if (options.markLoading) setLoading(false);
      if (options.markRefreshing) setRefreshing(false);
      return;
    }
    if (fetchInFlightRef.current?.airportCode === airportCode) return;

    const requestAirportCode = airportCode;
    const requestId = ++flightRequestIdRef.current;
    const isCurrentRequest = () => (
      airportCodeRef.current === requestAirportCode
      && flightRequestIdRef.current === requestId
    );

    fetchInFlightRef.current = { airportCode: requestAirportCode, requestId };
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
      } = await fetchAirportScheduleRaw(requestAirportCode);
      if (!isCurrentRequest()) return;

      const nextAirportAirlines = getAirportAirlines(requestAirportCode);
      setAirportAirlines(nextAirportAirlines);

      // Le compagnie appena rilevate nello schedule NON vengono mai selezionate
      // in automatico: restano deselezionate nel filtro finché l'utente non le
      // spunta, così in bacheca non compaiono voli che non gestisce.
      const reconciledSelection = reconcileSelectedAirlines({
        savedProfileAirlines: activeProfile?.airportCode === requestAirportCode ? activeProfile.airlines : [],
        previousSelectedAirlines: selectedAirlinesRef.current,
        nextAirportAirlines,
      });
      if (reconciledSelection) {
        applySelectedAirlines(reconciledSelection);
      }
      // Accumula lo storico minimo della rotazione per arrivi e partenze. Le
      // partenze concluse verranno nascoste dalla lista, ma restano disponibili
      // al matcher per impedire che il loro inbound venga riusato più tardi.
      // Senza eviction la cache si auto-rinnova e conserva voli fantasma.
      let cachedArrs: any[] = [], cachedDeps: any[] = [];
      try {
        const cache = await loadFlightScreenCache(requestAirportCode);
        if (!isCurrentRequest()) return;
        const stampLegacy = (item: any) =>
          (typeof item?._seenAtMs === 'number' ? item : { ...item, _seenAtMs: cache?.savedAt ?? Date.now() });
        cachedArrs = (cache?.arrivals ?? []).map(stampLegacy);
        cachedDeps = (cache?.departures ?? []).map(stampLegacy);
      } catch {}
      const mergeNowMs = Date.now();
      let mergedArrs = pruneUnseenFlights(
        pruneExpiredFlights(
          mergeFlightLists(cachedArrs, allArrivals, 'arrival', mergeNowMs, mergeFlightExternalLinkMetadata),
          'arrival',
          mergeNowMs / 1000,
          TURNAROUND_MATCH_WINDOW_SECONDS,
        ),
        mergeNowMs,
        TURNAROUND_MATCH_WINDOW_SECONDS * 1000,
      );
      let mergedDeps = pruneUnseenFlights(
        pruneExpiredFlights(
          mergeFlightLists(cachedDeps, allDepartures, 'departure', mergeNowMs, mergeFlightExternalLinkMetadata),
          'departure',
          mergeNowMs / 1000,
          TURNAROUND_MATCH_WINDOW_SECONDS,
        ),
        mergeNowMs,
        TURNAROUND_MATCH_WINDOW_SECONDS * 1000,
      );

      // Overlay ETA live dai dati ADS-B aperti (stessa fonte grezza di FR24):
      // incrocia gli arrivi per registrazione/callsign con gli aerei in volo
      // e sostituisce la stima con distanza/velocità reali. Best-effort: se
      // l'ADS-B non risponde restano gli orari del FIDS.
      const liveEtaDiagnostics: FlightScheduleProviderStatus[] = [];
      try {
        const airportInfo = getAirportInfo(requestAirportCode);
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
            mergedArrs = await applyLiveOriginDepartures(
              mergedArrs,
              aircraft,
              airportInfo.latitude,
              airportInfo.longitude,
              undefined,
              adsbController.signal,
            );
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
      if (!isCurrentRequest()) return;

      const sourceState: FlightDataSourceState = {
        airportCode: requestAirportCode,
        sourceLabel: sourceLabel ?? 'Sconosciuta',
        fetchedAt: fetchedAt ?? Date.now(),
        providerDiagnostics: [...(providerDiagnostics ?? []), ...liveEtaDiagnostics],
      };
      freshSnapshotAirportRef.current = requestAirportCode;
      setAllArrivalsFull(mergedArrs);
      setAllDeparturesFull(mergedDeps);
      setFlightSnapshotAirportCode(requestAirportCode);
      setFlightDataSource(sourceState);
      // I voli sintetizzati dalla tabella rotte AirLabs sono stime di orario,
      // non voli osservati: mostrali pure come fallback, ma non persisterli
      // in cache, così spariscono al primo fetch buono invece di restare
      // come fantasmi per ore.
      const isPersistable = (item: any) => item?.flight?._source !== 'airlabs_routes';
      saveFlightScreenCache({
        airportCode: requestAirportCode,
        arrivals: mergedArrs.filter(isPersistable),
        departures: mergedDeps.filter(isPersistable),
        sourceLabel: sourceState.sourceLabel,
        fetchedAt: sourceState.fetchedAt,
        providerDiagnostics: sourceState.providerDiagnostics,
      }).catch(() => {});

      // Identity-only FR24 overlay: it runs after the board is visible, so a
      // blocked public endpoint never slows the primary StaffMonitor/API load.
      // The same resolver is retried on tap when this best-effort pass fails.
      enrichFlightScheduleWithFr24Ids(requestAirportCode, mergedArrs, mergedDeps).then(enriched => {
        if (!isCurrentRequest() || enriched.matched === 0) return;
        setAllArrivalsFull(enriched.allArrivals);
        setAllDeparturesFull(enriched.allDepartures);
        saveFlightScreenCache({
          airportCode: requestAirportCode,
          arrivals: enriched.allArrivals.filter(isPersistable),
          departures: enriched.allDepartures.filter(isPersistable),
          sourceLabel: sourceState.sourceLabel,
          fetchedAt: sourceState.fetchedAt,
          providerDiagnostics: sourceState.providerDiagnostics,
        }).catch(() => {});
      }).catch(() => {});

      setArrivals(fetchedArrivals);
      setDepartures(fetchedDepartures);

      // Refresh the pinned snapshot from the latest schedule before deciding it
      // has expired. A delayed flight must remain pinned past its original STD.
      const notificationsEnabledNow = (await AsyncStorage.getItem(NOTIF_ENABLED_KEY)) === 'true';
      if (!isCurrentRequest()) return;
      const pinnedRaw = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
      if (!isCurrentRequest()) return;
      if (pinnedRaw) {
        try {
          const pinned = JSON.parse(pinnedRaw);
          const pinTab = pinned._pinTab || 'departures';
          // Keep the pin alive through a temporary provider gap and include the
          // live ADS-B overlay when it is available.
          const pool = pinTab === 'arrivals' ? mergedArrs : mergedDeps;
          const reconciliation = reconcilePinnedFlight(pinned, pool, Date.now() / 1000);

          if (reconciliation.kind === 'clear') {
            const pinCleared = await updateStorageForCurrentRequest(
              AsyncStorage,
              PINNED_FLIGHT_KEY,
              null,
              pinnedRaw,
              isCurrentRequest,
            );
            if (!pinCleared) return;

            const effectsApplied = await runEffectsForCurrentRequest(isCurrentRequest, [
              () => cancelPinnedNotifications('pinned flight expired or missing', false, isCurrentRequest),
              () => dismissPinnedFlightNotification(isCurrentRequest),
            ]);
            if (!effectsApplied) {
              await restoreStorageValueIfUnchanged(AsyncStorage, PINNED_FLIGHT_KEY, null, pinnedRaw);
              return;
            }
            setPinnedFlight(null);
          } else {
            const { item: refreshedPinned, tab } = reconciliation;
            const refreshedPinnedRaw = JSON.stringify(refreshedPinned);
            const pinRefreshed = await updateStorageForCurrentRequest(
              AsyncStorage,
              PINNED_FLIGHT_KEY,
              refreshedPinnedRaw,
              pinnedRaw,
              isCurrentRequest,
            );
            if (!pinRefreshed) return;

            const pinEffects: Array<() => Promise<unknown>> = [];
            if (notificationsEnabledNow) {
              pinEffects.push(
                async () => {
                  try {
                    await schedulePinnedNotifications(
                      refreshedPinned,
                      tab,
                      locale,
                      notifSettingsRef.current,
                      isCurrentRequest,
                    );
                  } catch (e) {
                    if (__DEV__) console.warn('[pinnedNotifRefresh]', e);
                  }
                },
                () => showOrUpdatePinnedFlightNotification(
                  refreshedPinned,
                  tab,
                  notifSettingsRef.current.sticky,
                  isCurrentRequest,
                ),
              );
            } else {
              pinEffects.push(
                () => cancelPinnedNotifications('flight refresh notifications disabled', false, isCurrentRequest),
                () => dismissPinnedFlightNotification(isCurrentRequest),
              );
            }

            const effectsApplied = await runEffectsForCurrentRequest(isCurrentRequest, pinEffects);
            if (!effectsApplied) {
              await restoreStorageValueIfUnchanged(
                AsyncStorage,
                PINNED_FLIGHT_KEY,
                refreshedPinnedRaw,
                pinnedRaw,
              );
              return;
            }
            setPinnedFlight(refreshedPinned);
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
      if (!isCurrentRequest()) return;

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
          if (!isCurrentRequest()) return;
          let pinnedDeparture: any | null = null;
          if (pinnedRawW) {
            try {
              const storedPin = JSON.parse(pinnedRawW);
              if (storedPin?._pinTab !== 'arrivals') pinnedDeparture = storedPin;
            } catch {}
          }
          const wFilterRaw = await AsyncStorage.getItem(FLIGHT_FILTER_KEY);
          if (!isCurrentRequest()) return;
          const wAllowedAirlines: string[] = wFilterRaw ? JSON.parse(wFilterRaw) : [];
          const wFlights: WidgetFlight[] = filterFlightsByAirlines(mergedDeps, wAllowedAirlines)
            .filter(item => {
              const stdTs = getScheduledFlightTs(item, 'departure');
              if (stdTs == null) return false;
              const airline = item.flight?.airline?.name || '';
              const ops = getAirlineOps(airline);
              const ciO = stdTs - ops.checkInOpen * 60, ciC = stdTs - ops.checkInClose * 60;
              const gO = stdTs - ops.gateOpen * 60, gC = stdTs - ops.gateClose * 60;
              return (ciO <= activeWidgetShift.end && ciC >= activeWidgetShift.start) || (gO <= activeWidgetShift.end && gC >= activeWidgetShift.start);
            })
            .map(item => {
              const etdTs = getBestDepartureTs(item)!;
              const stdTs = getScheduledFlightTs(item, 'departure')!;
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
                departureTs: etdTs,
                departureTime: fmtT(etdTs),
                ciOpen: fmtOff(stdTs, ops.checkInOpen), ciClose: fmtOff(stdTs, ops.checkInClose),
                gateOpen: fmtOff(stdTs, ops.gateOpen), gateClose: fmtOff(stdTs, ops.gateClose),
                airlineColor: getAirlineColor(airlineIdentity),
                isPinned: pinnedDeparture != null
                  && isFlightServiceMatch(pinnedDeparture, item, 'departure'),
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
        if (!isCurrentRequest()) return;
        await AsyncStorage.setItem(WIDGET_CACHE_KEY, JSON.stringify(widgetData));
        if (Platform.OS === 'android') {
          requestShiftWidgetUpdate(widgetData).catch(() => {});
        }
      } catch {}

      if (!isCurrentRequest()) return;

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
          isCurrentRequest,
        );
        if (!isCurrentRequest()) return;
        setScheduledCount(count);
      } else {
        await cancelPreviousNotifications('flight refresh inactive', false, isCurrentRequest);
        if (!isCurrentRequest()) return;
        setScheduledCount(0);
      }
    } catch (e) {
      if (!isCurrentRequest()) return;

      const message = e instanceof Error ? e.message : String(e);
      const providerUnavailable = message.includes('NO_FLIGHT_PROVIDER_AVAILABLE');

      if (providerUnavailable) {
        setFlightDataSource({
          airportCode: requestAirportCode,
          sourceLabel: 'Nessuna fonte voli disponibile',
          fetchedAt: Date.now(),
          providerDiagnostics: [{
            provider: 'cache',
            label: 'Fonti voli',
            status: 'failed',
            message,
          }],
        });
      } else {
        // Non-fatal refresh failure: keep whatever flights are already on
        // screen but surface that the update failed. Previously this branch
        // only logged under __DEV__, so in production the error vanished and
        // crew saw silently stale times/gates with no indication anything
        // had gone wrong.
        setFlightDataSource({
          airportCode: requestAirportCode,
          sourceLabel: 'Aggiornamento non riuscito · dati non aggiornati',
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
      if (fetchInFlightRef.current?.requestId === requestId) {
        fetchInFlightRef.current = null;
      }
      if (isCurrentRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
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
    let active = true;
    const loadPinnedFlight = async () => {
      const raw = await AsyncStorage.getItem(PINNED_FLIGHT_KEY);
      if (!raw) return;
      try {
        const pinned = JSON.parse(raw);
        if (pinned?._pinTab === 'arrivals') {
          try { await AsyncStorage.removeItem(PINNED_FLIGHT_KEY); } catch {}
          try { await cancelPinnedNotifications('legacy arrival pin removed', false); } catch {}
          try { await dismissPinnedFlightNotification(); } catch {}
          if (active) setPinnedFlight(null);
          return;
        }
        if (active && pinned.flight?.identification?.number?.default) {
          setPinnedFlight(pinned);
        }
      } catch {}
    };
    loadPinnedFlight().catch(() => {});
    return () => {
      active = false;
    };
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

    if (notifsEnabled && pinnedFlight) {
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
  }, [locale, notifsEnabled, persistNotificationSettings, pinnedFlight, scheduleNotificationsForCurrentShift]);

  useEffect(() => {
    const signature = selectedAirlines.join('|');
    const changed = signature !== selectedAirlinesNotifSignatureRef.current;
    selectedAirlinesNotifSignatureRef.current = signature;
    if (!changed || !notifsEnabled) return;
    scheduleNotificationsForCurrentShift().catch(() => {});
  }, [notifsEnabled, scheduleNotificationsForCurrentShift, selectedAirlines]);

  const pinFlight = useCallback(async (item: any, direction: FlightDirection) => {
    try {
      const id = item.flight?.identification?.number?.default;
      if (!id) return;
      const tab = direction === 'arrival' ? 'arrivals' : 'departures';
      const pinnedItem = { ...item, _pinTab: tab, _pinnedAt: Date.now() };
      await AsyncStorage.setItem(PINNED_FLIGHT_KEY, JSON.stringify(pinnedItem));
      setPinnedFlight(pinnedItem);
      if (notifsEnabled) {
        try { await schedulePinnedNotifications(pinnedItem, tab, locale, notifSettingsRef.current); } catch (e) { if (__DEV__) console.warn('[pinnedNotif]', e); }
        await showOrUpdatePinnedFlightNotification(pinnedItem, tab, notifSettingsRef.current.sticky);
      } else {
        await dismissPinnedFlightNotification();
      }
    } catch {}
  }, [locale, notifsEnabled]);

  const unpinFlight = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(PINNED_FLIGHT_KEY);
      try { await cancelPinnedNotifications(); } catch (e) { if (__DEV__) console.warn('[cancelPinNotif]', e); }
      await dismissPinnedFlightNotification();
      setPinnedFlight(null);
    } catch (e) { if (__DEV__) console.error('[unpin]', e); }
  }, []);

  const userShift = activeDay === 'today' ? shifts.today : shifts.tomorrow;
  const selectedDate = activeDay === 'today' ? new Date() : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })();
  const useStaffMonitorRegistrationHints = airportCode === 'PSA' && activeDay === 'today';
  const visibleStaffMonitorDepartures = useStaffMonitorRegistrationHints
    ? staffMonitorDeps
    : EMPTY_STAFF_MONITOR_FLIGHTS;

  const allSelected = airportAirlines.length > 0 && airportAirlines.every(k => selectedAirlines.includes(k));
  const snapshotMatchesAirport = flightSnapshotAirportCode === airportCode;
  const visibleFlightDataSource = flightDataSource?.airportCode === airportCode ? flightDataSource : null;

  const currentDayRotationData = snapshotMatchesAirport
    ? buildUnifiedFlightList(
        allArrivalsFull,
        allDeparturesFull,
        selectedDate,
        useStaffMonitorRegistrationHints ? staffMonitorArrs : [],
        useStaffMonitorRegistrationHints ? staffMonitorDeps : [],
      )
    : [];
  const currentDayRawData = filterActiveUnifiedFlights(currentDayRotationData);
  const currentData = filterUnifiedFlightsByAirlines(currentDayRawData, selectedAirlines);
  const hasFlightSnapshot = snapshotMatchesAirport
    && (allArrivalsFull.length > 0 || allDeparturesFull.length > 0);
  const showBlockingLoader = shouldShowBlockingFlightLoader({
    isLoading: loading,
    hasVisibleFlights: hasFlightSnapshot,
  });
  const showRefreshIndicator = shouldShowFlightRefreshIndicator({
    isLoading: loading,
    isRefreshing: refreshing,
    hasVisibleFlights: hasFlightSnapshot,
  });

  const renderFlight = useCallback(({ item: entry, index }: { item: UnifiedFlightListEntry; index: number }) => (
    <FlightRow
      item={entry.item}
      linkedArrival={entry.linkedArrival}
      index={index}
      direction={entry.direction}
      airportCode={airportCode}
      userShift={userShift}
      pinnedFlight={pinnedFlight}
      onPin={pinFlight}
      onUnpin={unpinFlight}
      colors={colors}
      isOperations={isOperations}
      s={s}
      smPool={visibleStaffMonitorDepartures}
      locale={locale}
      t={t}
    />
  ), [airportCode, userShift, s, pinnedFlight, pinFlight, unpinFlight, colors, isOperations, visibleStaffMonitorDepartures, locale, t]);
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

      {/* Day selector: each row is an outbound operation with inbound context. */}
      <View style={s.controlsRow}>
        <View style={s.segment}>
          {(['today', 'tomorrow'] as const).map(d => (
            <TouchableOpacity
              key={d}
              style={[s.segBtn, activeDay === d && s.segBtnActive]}
              onPress={() => setActiveDay(d)}
              accessibilityRole="button"
              accessibilityState={{ selected: activeDay === d }}
            >
              <Text style={[s.segBtnText, activeDay === d && s.segBtnTextActive]}>{d === 'today' ? t('flightToday') : t('flightTomorrow')}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={s.fr24ArrivalsBtn}
          onPress={() => { openFlightradar24AirportArrivals(airportCode).catch(() => {}); }}
          activeOpacity={0.82}
          accessibilityRole="link"
          accessibilityLabel={t('flightOpenAirportArrivalsFr24').replace('{airport}', airportCode)}
        >
          <MaterialIcons name="flight-land" size={17} color={colors.primary} />
          <Text numberOfLines={1} style={s.fr24ArrivalsBtnText}>{t('flightAirportArrivalsFr24')}</Text>
        </TouchableOpacity>
      </View>

      {(visibleFlightDataSource || showRefreshIndicator) && (
        <View style={s.sourceRow}>
          {visibleFlightDataSource && (
            <TouchableOpacity
              style={s.sourceBadge}
              activeOpacity={0.85}
              onPress={() => setSourceDebugVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t('flightSourceDebugTitle')}
            >
              <MaterialIcons name="hub" size={14} color={colors.primary} />
              <Text style={s.sourceBadgeText}>
                {t('flightDataSource')}: {formatFlightSourceLabel(visibleFlightDataSource.sourceLabel)}
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
          keyExtractor={entry => entry.key}
          renderItem={renderFlight}
          contentContainerStyle={{
            paddingHorizontal: SPACING.lg,
            paddingTop: isOperations ? 8 : 18,
            paddingBottom: isOperations ? 176 : 120,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { fetchAll({ markRefreshing: true }); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyFlightState
              activeDay={activeDay}
              activeTab="all"
              rawDayCount={currentDayRawData.length}
              sourceLabel={visibleFlightDataSource?.sourceLabel}
              diagnostics={visibleFlightDataSource?.providerDiagnostics}
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
        activeTab="all"
        sourceLabel={visibleFlightDataSource?.sourceLabel}
        fetchedAt={visibleFlightDataSource?.fetchedAt}
        diagnostics={visibleFlightDataSource?.providerDiagnostics}
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
    pageHeader: { backgroundColor: isOperations ? 'rgba(2,8,12,0.90)' : c.card, paddingHorizontal: SPACING.lg, paddingVertical: isOperations ? 12 : 14, borderBottomWidth: 1, borderBottomColor: operationBorderSoft, flexDirection: 'row', alignItems: 'center' },
    notifBtn: { width: 42, height: 42, borderRadius: isOperations ? 14 : 21, backgroundColor: operationPanelStrong, justifyContent: 'center', alignItems: 'center', borderWidth: isOperations ? 1 : 0, borderColor: operationBorder },
    notifBtnActive: { backgroundColor: c.primary, shadowColor: c.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 5 },
    notifBadge: { position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: RADIUS.sm, backgroundColor: c.danger, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: c.card },
    notifBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#fff' },
    pageTitle: { ...(isOperations ? TYPE.titleLg : TYPE.title), color: isOperations ? c.text : c.primaryDark, letterSpacing: isOperations ? -0.5 : 0 },
    pageSub: { fontSize: 13, color: c.textSub, marginTop: 2, letterSpacing: isOperations ? 0.7 : 0 },
    controlsRow: { flexDirection: 'row', gap: SPACING.sm, padding: isOperations ? 9 : 12, backgroundColor: isOperations ? 'rgba(2,8,12,0.76)' : c.card, borderBottomWidth: 1, borderBottomColor: operationBorderSoft },
    fr24ArrivalsBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 10, borderRadius: isOperations ? 14 : 8, backgroundColor: isOperations ? 'rgba(125,211,252,0.10)' : c.primaryLight, borderWidth: 1, borderColor: isOperations ? 'rgba(125,211,252,0.28)' : c.primary },
    fr24ArrivalsBtnText: { fontSize: 10, lineHeight: 13, fontWeight: '900', color: c.primaryDark, letterSpacing: 0.25 },
    sourceRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: SPACING.sm, marginTop: isOperations ? 8 : 10, marginBottom: isOperations ? 2 : 8, marginHorizontal: SPACING.lg },
    sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', flexShrink: 1, paddingHorizontal: 10, paddingVertical: isOperations ? 6 : 7, borderRadius: RADIUS.pill, backgroundColor: isOperations ? 'rgba(45,212,191,0.12)' : c.primaryLight, borderWidth: 1, borderColor: operationBorder },
    sourceBadgeText: { flexShrink: 1, flexWrap: 'wrap', fontSize: 11, lineHeight: 15, fontWeight: '800', color: c.primaryDark },
    refreshBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: isOperations ? 6 : 7, borderRadius: RADIUS.pill, backgroundColor: isOperations ? 'rgba(15,23,42,0.82)' : c.cardSecondary, borderWidth: 1, borderColor: operationBorderSoft },
    refreshBadgeText: { fontSize: 11, fontWeight: '800', color: c.textSub },
    segment: { flex: 1, flexDirection: 'row', backgroundColor: isOperations ? 'rgba(2,8,12,0.76)' : c.bg, borderRadius: isOperations ? 14 : 8, padding: 3, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
    segBtn: { flex: 1, minHeight: 44, paddingVertical: isOperations ? 6 : 7, alignItems: 'center', justifyContent: 'center', borderRadius: isOperations ? 11 : 6 },
    segBtnActive: { backgroundColor: isOperations ? 'rgba(45,212,191,0.16)' : c.card, borderWidth: 1, borderColor: isOperations ? operationBorder : c.primaryLight },
    segBtnText: { ...TYPE.caption, color: c.textSub, letterSpacing: isOperations ? 0.6 : 0 },
    segBtnTextActive: { color: c.primaryText, fontWeight: '800' },
    card: { backgroundColor: operationPanel, borderRadius: isOperations ? 20 : 18, marginBottom: 10, overflow: 'hidden', shadowColor: c.primary, shadowOpacity: isOperations || c.isDark ? 0 : 0.08, shadowRadius: 12, elevation: isOperations || c.isDark ? 0 : 4, borderWidth: 1, borderColor: operationBorder, borderLeftWidth: isOperations ? 4 : 1 },
    departureCard: { minHeight: isOperations ? 300 : 330 },
    cardShift: { borderWidth: 1.5, borderColor: c.warning },
    shiftBanner: { backgroundColor: c.warning, paddingVertical: 5, paddingHorizontal: SPACING.md },
    shiftBannerText: { color: '#fff', fontWeight: WEIGHT.semibold, fontSize: 11, letterSpacing: 0.5 },
    cardPinned: { borderWidth: 2, borderColor: c.warning },
    pinBanner: { backgroundColor: isOperations ? 'rgba(245,158,11,0.18)' : c.warning, paddingVertical: 5, paddingHorizontal: SPACING.md, borderBottomWidth: isOperations ? 1 : 0, borderBottomColor: 'rgba(245,158,11,0.28)' },
    pinBannerText: { color: isOperations ? '#FBBF24' : '#fff', fontWeight: WEIGHT.semibold, fontSize: 11, letterSpacing: 0.5 },
    statusPill: { paddingHorizontal: 10, paddingVertical: isOperations ? 3 : 4, borderRadius: isOperations ? 10 : 20, marginTop: isOperations ? 6 : 8, alignSelf: 'flex-end', borderWidth: isOperations ? 1 : 0, borderColor: isOperations ? operationBorderSoft : 'transparent' },
    statusText: { ...TYPE.micro, letterSpacing: isOperations ? 0.6 : 0 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: isOperations ? 12 : 14, paddingHorizontal: 16, borderBottomWidth: isOperations ? 1 : 0, borderBottomColor: operationBorderSoft },
    airlineBrandRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: isOperations ? 5 : 0, opacity: 0.95 },
    headerLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerText: { flex: 1, minWidth: 0 },
    headerFlightRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
    headerFlightNum: { color: isOperations ? c.primaryDark : '#fff', fontWeight: '900', fontSize: isOperations ? 18 : 17, lineHeight: 21, letterSpacing: isOperations ? 0.6 : 0 },
    directionBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0, paddingHorizontal: 7, paddingVertical: 3, borderRadius: RADIUS.pill, borderWidth: 1 },
    directionBadgeText: { fontSize: 10, lineHeight: 12, fontWeight: '900', letterSpacing: 0.45, textTransform: 'uppercase' },
    headerAirlineName: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.8)', fontSize: 11, lineHeight: 15, letterSpacing: isOperations ? 0.5 : 0 },
    headerMetaFlash: { alignItems: 'flex-end', borderRadius: RADIUS.md, marginRight: -8, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, maxWidth: isOperations ? 150 : 142, flexShrink: 0 },
    headerTime: { color: isOperations ? c.text : '#fff', fontWeight: '900', fontSize: isOperations ? 21 : 20, lineHeight: 23, textAlign: 'right', fontVariant: ['tabular-nums'] },
    headerDest: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.8)', fontSize: 10, textAlign: 'right' },
    headerAirportCode: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.86)', fontSize: isOperations ? 11 : 10, lineHeight: 13, fontWeight: '900', letterSpacing: isOperations ? 1.1 : 0.8, textAlign: 'right' },
    headerAirportName: { color: isOperations ? c.textSub : 'rgba(255,255,255,0.72)', fontSize: isOperations ? 9 : 8.5, lineHeight: isOperations ? 10.5 : 10, textAlign: 'right' },
    linkedArrivalPanel: { minHeight: isOperations ? 66 : 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: isOperations ? 9 : 11, paddingHorizontal: 16, backgroundColor: isOperations ? 'rgba(125,211,252,0.07)' : c.cardSecondary, borderBottomWidth: 1, borderBottomColor: operationBorderSoft },
    linkedArrivalIdentity: { flex: 1, minWidth: 0 },
    linkedArrivalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    linkedArrivalTitle: { fontSize: 10, lineHeight: 13, fontWeight: '900', color: c.textSub, letterSpacing: 0.65, textTransform: 'uppercase' },
    linkedArrivalRoute: { marginTop: 4, fontSize: 13, lineHeight: 17, fontWeight: '800', color: c.text },
    linkedArrivalPending: { marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: '700', color: c.neutral },
    linkedArrivalTimes: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    linkedArrivalTimeBlock: { minWidth: 48, alignItems: 'flex-end' },
    linkedArrivalTimeLabel: { fontSize: 9, lineHeight: 12, fontWeight: '900', color: c.textSub, letterSpacing: 0.7 },
    linkedArrivalTime: { marginTop: 2, fontSize: 14, lineHeight: 17, fontWeight: '900', color: c.primaryDark, fontVariant: ['tabular-nums'] },
    cardBody: { flexDirection: 'column', paddingVertical: isOperations ? 12 : 14, paddingHorizontal: 16, backgroundColor: operationPanel },
    bodyInfo: { fontSize: 11, color: c.textSub },
    bodyTime: { fontWeight: '700', color: c.text },
    opsRow: { flexDirection: 'row', gap: 10 },
    departureTimesRow: { marginBottom: 10 },
    departureTimeBadge: { backgroundColor: isOperations ? 'rgba(45,212,191,0.08)' : c.cardSecondary },
    opsBadge: { flex: 1, minHeight: isOperations ? 62 : 68, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: isOperations ? 'rgba(45,212,191,0.10)' : c.primaryLight, borderRadius: isOperations ? 14 : 12, paddingHorizontal: 12, paddingVertical: isOperations ? 9 : 11, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
    opsTextWrap: { flex: 1, minWidth: 0 },
    opsIcon: { fontSize: 16 },
    opsLabel: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: c.textSub, letterSpacing: 0.35 },
    opsTime: { fontSize: 15, lineHeight: 19, fontWeight: '900', color: c.primaryDark, fontVariant: ['tabular-nums'] },
    pinBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
    pinBtnActive: { backgroundColor: 'rgba(245,158,11,0.25)' },
    filterBtn: { width: 42, height: 42, borderRadius: isOperations ? 14 : 21, backgroundColor: operationPanelStrong, justifyContent: 'center', alignItems: 'center', marginRight: SPACING.sm, borderWidth: isOperations ? 1 : 0, borderColor: operationBorder },
    filterBtnActive: { backgroundColor: c.primary, shadowColor: c.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 5 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    alertOverlay: { flex: 1, backgroundColor: 'rgba(2,6,23,0.55)', justifyContent: 'center', alignItems: 'center', padding: SPACING.xxl },
    alertCard: {
      width: '100%',
      maxWidth: 440,
      borderRadius: RADIUS.xl,
      padding: 18,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.glassBorder,
    },
    alertHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md, gap: 10 },
    alertIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    alertSuccess: { backgroundColor: c.success },
    alertWarning: { backgroundColor: c.warning },
    alertInfo: { backgroundColor: c.primary },
    alertTitle: { flex: 1, fontSize: 28, fontWeight: '900', color: c.text },
    alertMessage: { fontSize: 17, lineHeight: 24, color: c.textSub, marginBottom: SPACING.lg },
    alertBtn: { alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: c.primary },
    alertBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
    filterSheet: { backgroundColor: isOperations ? '#071414' : c.card, borderTopLeftRadius: isOperations ? 28 : 24, borderTopRightRadius: isOperations ? 28 : 24, padding: SPACING.xl, paddingBottom: 36, borderTopWidth: isOperations ? 1 : 0, borderColor: operationBorder },
    filterSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: isOperations ? 'rgba(45,212,191,0.34)' : c.border, alignSelf: 'center', marginBottom: SPACING.lg },
    filterSheetTitle: { fontSize: 16, fontWeight: '800', color: isOperations ? c.primaryDark : c.text, marginBottom: SPACING.lg, textAlign: 'center', letterSpacing: isOperations ? 0.8 : 0 },
    notifSheetSub: { fontSize: 13, color: c.textSub, textAlign: 'center', marginTop: -8, marginBottom: SPACING.lg },
    notifRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: 10 },
    notifRowTextWrap: { flex: 1 },
    notifRowTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    notifRowSub: { fontSize: 12, color: c.textSub, marginTop: 2 },
    notifDivider: { height: 1, backgroundColor: c.border, marginVertical: 10 },
    notifMinutesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
    notifStepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg, borderRadius: 10, padding: SPACING.xs },
    notifStepperBtn: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
    notifStepperValue: { minWidth: 54, textAlign: 'center', fontSize: 14, fontWeight: '800', color: c.primaryDark },
    filterOption: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: 14, borderRadius: 14, marginBottom: SPACING.sm, borderWidth: 1.5 },
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
    smFooter: { minHeight: isOperations ? 48 : 54, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 4, paddingHorizontal: 16, paddingBottom: isOperations ? 10 : 14, backgroundColor: operationPanel, borderTopWidth: isOperations ? 1 : 0, borderTopColor: operationBorderSoft },
    smPill: { minHeight: isOperations ? 30 : 34, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, backgroundColor: isOperations ? 'rgba(45,212,191,0.10)' : c.primaryLight, borderRadius: isOperations ? 11 : 10, paddingHorizontal: 10, paddingVertical: isOperations ? 5 : 6, borderWidth: isOperations ? 1 : 0, borderColor: operationBorderSoft },
    smPillText: { fontSize: 12, lineHeight: 15, fontWeight: '800', color: c.primaryDark },
  });
}
