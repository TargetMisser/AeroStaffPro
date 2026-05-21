import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme } from '../context/ThemeContext';
import { useAirport } from '../context/AirportContext';
import { formatAirportSettingLabel } from '../utils/airportSettings';
import { getFlightProviderSettingsState, type FlightProviderSettingsState } from '../utils/flightProviderSettings';
import { getNotificationDebugSnapshot, NOTIF_ENABLED_KEY, type NotificationDebugSnapshot } from '../utils/notificationDiagnostics';
import {
  buildSetupChecklist,
  ONBOARDING_SETUP_STORAGE_KEY,
  type SetupChecklist,
  type SetupChecklistItem,
  type SetupPermissionState,
} from '../utils/appSetup';

type OnboardingScreenProps = {
  onComplete: () => void;
  onOpenProfiles: () => void;
  onOpenFlightApis: () => void;
  onOpenSettings: () => void;
};

function normalizePermission(status?: string | null): SetupPermissionState {
  if (status === 'granted' || status === 'denied' || status === 'undetermined') {
    return status;
  }
  return 'unknown';
}

function StepIcon({ item }: { item: SetupChecklistItem }) {
  const { colors } = useAppTheme();
  const icon = item.status === 'ready'
    ? 'check-circle'
    : item.status === 'missing'
      ? 'error-outline'
      : 'radio-button-unchecked';
  const color = item.status === 'ready'
    ? '#10B981'
    : item.status === 'missing'
      ? '#EF4444'
      : colors.primary;

  return (
    <View style={[styles.stepIcon, { backgroundColor: `${color}20` }]}>
      <MaterialIcons name={icon} size={22} color={color} />
    </View>
  );
}

export default function OnboardingScreen({
  onComplete,
  onOpenProfiles,
  onOpenFlightApis,
  onOpenSettings,
}: OnboardingScreenProps) {
  const { colors, mode } = useAppTheme();
  const { activeProfile, airportCode, airport, isLoading: airportLoading } = useAirport();
  const [calendarPermission, setCalendarPermission] = useState<SetupPermissionState>('unknown');
  const [notificationPermission, setNotificationPermission] = useState<SetupPermissionState>('unknown');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [providerState, setProviderState] = useState<FlightProviderSettingsState | null>(null);
  const [notificationDebug, setNotificationDebug] = useState<NotificationDebugSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const isOperations = colors.isDark;
  const stylesForTheme = useMemo(() => makeStyles(isOperations), [isOperations]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [calendar, notifications, notifEnabledRaw, providers, notifDebug] = await Promise.all([
        Calendar.getCalendarPermissionsAsync().catch(() => null),
        Notifications.getPermissionsAsync().catch(() => null),
        AsyncStorage.getItem(NOTIF_ENABLED_KEY).catch(() => null),
        getFlightProviderSettingsState().catch(() => null),
        getNotificationDebugSnapshot().catch(() => null),
      ]);

      setCalendarPermission(normalizePermission(calendar?.status));
      setNotificationPermission(normalizePermission(notifications?.status));
      setNotificationsEnabled(notifEnabledRaw === 'true');
      setProviderState(providers);
      setNotificationDebug(notifDebug);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const checklist: SetupChecklist = useMemo(() => buildSetupChecklist({
    hasProfile: Boolean(activeProfile),
    airportLabel: formatAirportSettingLabel(airportCode),
    calendarPermission,
    notificationPermission,
    notificationsEnabled,
    providerPreference: providerState?.preference ?? 'auto',
    hasAeroDataBoxKey: providerState?.aeroDataBox.configured ?? false,
    hasFr24Key: providerState?.fr24.configured ?? false,
    hasAirLabsKey: providerState?.airLabs.configured ?? false,
    pendingNotifications: notificationDebug?.pendingAeroStaff ?? 0,
    duplicateNotifications: notificationDebug?.possibleDuplicates.length ?? 0,
  }), [
    activeProfile,
    airportCode,
    calendarPermission,
    notificationPermission,
    notificationDebug,
    notificationsEnabled,
    providerState,
  ]);

  const completeSetup = async () => {
    await AsyncStorage.setItem(ONBOARDING_SETUP_STORAGE_KEY, 'true');
    onComplete();
  };

  const requestCalendar = async () => {
    const result = await Calendar.requestCalendarPermissionsAsync();
    setCalendarPermission(normalizePermission(result.status));
    await refresh();
  };

  const requestNotifications = async () => {
    const result = await Notifications.requestPermissionsAsync();
    setNotificationPermission(normalizePermission(result.status));
    if (result.status === 'granted') {
      await AsyncStorage.setItem(NOTIF_ENABLED_KEY, 'true');
      setNotificationsEnabled(true);
    }
    await refresh();
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={[stylesForTheme.hero, { backgroundColor: colors.card, borderColor: colors.glassBorder }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.primaryLight }]}>
          <MaterialIcons name="tune" size={28} color={colors.primary} />
        </View>
        <View style={styles.heroText}>
          <Text style={[styles.kicker, { color: colors.primary }]}>SETUP GUIDATO</Text>
          <Text style={[styles.title, { color: colors.text }]}>Prepara AeroStaff Pro</Text>
          <Text style={[styles.copy, { color: colors.textSub }]}>
            Configura il minimo utile: aeroporto, calendario, fonti voli, notifiche e widget.
          </Text>
        </View>
      </View>

      <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View>
          <Text style={[styles.progressTitle, { color: colors.text }]}>
            {checklist.readyCount}/{checklist.totalCount} pronti
          </Text>
          <Text style={[styles.progressSub, { color: colors.textMuted }]}>
            {checklist.requiredComplete
              ? 'La base e pronta. Puoi rifinire API e notifiche quando vuoi.'
              : 'Completa almeno profilo e calendario per rendere utile la Home.'}
          </Text>
        </View>
        {loading || airportLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <MaterialIcons
            name={checklist.requiredComplete ? 'verified' : 'priority-high'}
            size={26}
            color={checklist.requiredComplete ? '#10B981' : '#F59E0B'}
          />
        )}
      </View>

      <View style={styles.steps}>
        {checklist.items.map(item => (
          <View
            key={item.id}
            style={[styles.stepCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <StepIcon item={item} />
            <View style={styles.stepText}>
              <View style={styles.stepTitleRow}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>{item.title}</Text>
                {item.required && <Text style={[styles.required, { color: colors.primary }]}>richiesto</Text>}
              </View>
              <Text style={[styles.stepDetail, { color: colors.textSub }]}>{item.detail}</Text>
            </View>
            {item.id === 'profile' && (
              <TouchableOpacity style={[styles.stepAction, { borderColor: colors.border }]} onPress={onOpenProfiles}>
                <Text style={[styles.stepActionText, { color: colors.primary }]}>Apri</Text>
              </TouchableOpacity>
            )}
            {item.id === 'calendar' && item.status !== 'ready' && (
              <TouchableOpacity style={[styles.stepAction, { borderColor: colors.border }]} onPress={requestCalendar}>
                <Text style={[styles.stepActionText, { color: colors.primary }]}>Consenti</Text>
              </TouchableOpacity>
            )}
            {item.id === 'flightData' && (
              <TouchableOpacity style={[styles.stepAction, { borderColor: colors.border }]} onPress={onOpenFlightApis}>
                <Text style={[styles.stepActionText, { color: colors.primary }]}>API</Text>
              </TouchableOpacity>
            )}
            {item.id === 'notifications' && item.status !== 'ready' && (
              <TouchableOpacity style={[styles.stepAction, { borderColor: colors.border }]} onPress={requestNotifications}>
                <Text style={[styles.stepActionText, { color: colors.primary }]}>Attiva</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      <View style={[styles.airportCard, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
        <Text style={[styles.airportLabel, { color: colors.textMuted }]}>Profilo attivo</Text>
        <Text style={[styles.airportValue, { color: colors.text }]}>
          {activeProfile?.name ?? airport.city} · {airport.code} / {airport.icao}
        </Text>
      </View>

      <View style={styles.footerActions}>
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={onOpenSettings}
          activeOpacity={0.85}
        >
          <Text style={[styles.secondaryText, { color: colors.text }]}>Impostazioni</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={completeSetup}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryText}>
            {checklist.requiredComplete ? 'Completa setup' : 'Salta per ora'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 116, gap: 14 },
  heroText: { flex: 1, gap: 4 },
  heroIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.7 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.7 },
  copy: { fontSize: 13, lineHeight: 19 },
  progressCard: { borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressTitle: { fontSize: 18, fontWeight: '900' },
  progressSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  steps: { gap: 10 },
  stepCard: { borderWidth: 1, borderRadius: 18, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  stepIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, gap: 2 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  stepTitle: { fontSize: 15, fontWeight: '900' },
  required: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  stepDetail: { fontSize: 12, lineHeight: 17 },
  stepAction: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  stepActionText: { fontSize: 12, fontWeight: '900' },
  airportCard: { borderWidth: 1, borderRadius: 18, padding: 14 },
  airportLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  airportValue: { fontSize: 15, fontWeight: '900', marginTop: 3 },
  footerActions: { flexDirection: 'row', gap: 10 },
  secondaryBtn: { flex: 1, borderWidth: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  secondaryText: { fontSize: 14, fontWeight: '900' },
  primaryBtn: { flex: 1.3, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});

function makeStyles(isOperations: boolean) {
  return StyleSheet.create({
    hero: {
      borderWidth: 1,
      borderRadius: isOperations ? 26 : 22,
      padding: 16,
      flexDirection: 'row',
      gap: 14,
      alignItems: 'center',
    },
  });
}
