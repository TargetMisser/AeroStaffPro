import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform, TextInput, Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme, ThemeMode } from '../context/ThemeContext';
import { useAirport } from '../context/AirportContext';
import { useLanguage } from '../context/LanguageContext';
import {
  formatAirportSettingLabel,
} from '../utils/airportSettings';
import {
  APP_VERSION,
  checkForUpdate,
  getCachedUpdateInfo,
  markUpdateSeen,
  type UpdateInfo,
} from '../utils/updateChecker';
import UpdateModal from '../components/UpdateModal';
import ProfileSwitcherModal from '../components/ProfileSwitcherModal';
import { exportBackup, importBackup } from '../utils/backupManager';
import {
  clearAeroDataBoxApiKey,
  clearAirLabsApiKey,
  clearFr24ApiKey,
  getAeroDataBoxApiKey,
  getAirLabsApiKey,
  getFr24ApiKey,
  getFlightProviderSettingsState,
  saveAeroDataBoxApiKey,
  saveAeroDataBoxGateway,
  saveFlightProviderPreference,
  saveAirLabsApiKey,
  saveFr24ApiKey,
  type AeroDataBoxGateway,
  type AeroDataBoxKeyState,
  type AirLabsKeyState,
  type Fr24KeyState,
  type FlightProviderPreference,
} from '../utils/flightProviderSettings';
import {
  getCachedFlightProviderDiagnostics,
  type FlightProviderDiagnosticsSnapshot,
} from '../utils/fr24api';
import { formatProviderDiagnostic } from '../utils/flightDiagnostics';
import {
  getStaffMonitorDebugColumns,
  getStaffMonitorDebugFlights,
  getStaffMonitorDebugStatus,
} from '../utils/staffMonitor';
import {
  cancelAeroStaffScheduledNotifications,
  getNotificationDebugSnapshot,
  type NotificationDebugEvent,
  type NotificationDebugSnapshot,
} from '../utils/notificationDiagnostics';

const STAFF_MONITOR_LINKS = {
  main: 'https://servizi.pisa-airport.com/staffMonitor/staffMonitor.html',
  departures: 'https://servizi.pisa-airport.com/staffMonitor/staffMonitor?trans=true&nature=D',
  arrivals: 'https://servizi.pisa-airport.com/staffMonitor/staffMonitor?trans=true&nature=A',
};

function notificationEventTone(event: NotificationDebugEvent): string {
  if (event.type.includes('error') || event.type.includes('denied')) return '#EF4444';
  if (event.type.includes('skip') || event.type.includes('cancel')) return '#F59E0B';
  if (event.type.includes('schedule') || event.type.includes('enabled')) return '#10B981';
  return '#94A3B8';
}

// ─── Tema picker ──────────────────────────────────────────────────────────────
type ThemeOption = {
  id: ThemeMode;
  label: string;
  sublabel: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  previewBg: string;
  previewAccent: string;
};

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'light',
    label: 'Chiaro',
    sublabel: 'Tema standard, sfondo bianco',
    icon: 'light-mode',
    previewBg: '#F3F4F6',
    previewAccent: '#F47B16',
  },
  {
    id: 'dark',
    label: 'Scuro',
    sublabel: 'Tema control room con UI tecnica',
    icon: 'dashboard',
    previewBg: '#0B1114',
    previewAccent: '#2DD4BF',
  },
  {
    id: 'auto',
    label: 'Automatico',
    sublabel: 'Cambia in base all\'orario',
    icon: 'brightness-auto',
    previewBg: '#111827',
    previewAccent: '#10B981',
  },
];

function ThemeCard({ option, selected, onSelect, activeLabel }: {
  option: ThemeOption;
  selected: boolean;
  onSelect: () => void;
  activeLabel: string;
}) {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity
      style={[
        styles.themeCard,
        { backgroundColor: colors.card, borderColor: selected ? colors.primary : colors.border },
        selected && styles.themeCardSelected,
      ]}
      onPress={onSelect}
      activeOpacity={0.8}
    >
      {/* Anteprima miniatura */}
      <View style={[styles.preview, { backgroundColor: option.previewBg }]}>
        <View style={[styles.previewBar, { backgroundColor: option.previewBg === '#F3F4F6' ? '#fff' : 'rgba(255,255,255,0.12)' }]} />
        <View style={styles.previewContent}>
          <View style={[styles.previewCard, { backgroundColor: option.previewBg === '#F3F4F6' ? '#fff' : 'rgba(255,255,255,0.15)' }]} />
          <View style={[styles.previewCard, { backgroundColor: option.previewBg === '#F3F4F6' ? '#fff' : 'rgba(255,255,255,0.15)', width: '60%' }]} />
        </View>
        <View style={[styles.previewTab, { backgroundColor: option.previewBg === '#F3F4F6' ? '#fff' : 'rgba(255,255,255,0.12)' }]}>
          <View style={[styles.previewDot, { backgroundColor: option.previewAccent }]} />
        </View>
      </View>

      {/* Info */}
      <View style={styles.themeInfo}>
        <View style={styles.themeInfoTop}>
          <MaterialIcons name={option.icon} size={18} color={selected ? colors.primary : colors.textSub} />
          <Text style={[styles.themeLabel, { color: colors.text }, selected && { color: colors.primary }]}>
            {option.label}
          </Text>
          {selected && (
            <View style={[styles.activeBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.activeBadgeTxt}>{activeLabel}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.themeSub, { color: colors.textMuted }]}>{option.sublabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Riga impostazione generica ───────────────────────────────────────────────
function SettingRow({
  icon, label, sublabel, type, value, onToggle, onPress, disabled,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  sublabel?: string;
  type: 'arrow' | 'toggle' | 'info';
  value?: boolean;
  onToggle?: (v: boolean) => void;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const isPressable = type === 'arrow' && !!onPress && !disabled;
  const content = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
        <MaterialIcons name={icon} size={20} color={disabled ? colors.textMuted : colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {sublabel && <Text style={[styles.rowSub, { color: colors.textMuted }]}>{sublabel}</Text>}
      </View>
      {type === 'arrow' && <MaterialIcons name="chevron-right" size={20} color={colors.border} />}
      {type === 'toggle' && <Switch value={value ?? false} onValueChange={onToggle} disabled={disabled} trackColor={{ true: colors.primary }} thumbColor="#fff" />}
    </>
  );

  if (isPressable) {
    return (
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.row, disabled && { opacity: 0.45 }]}>
      {content}
    </View>
  );
}

type DialogTone = 'success' | 'error' | 'warning' | 'info';
type DialogAction = {
  label: string;
  style?: 'primary' | 'secondary' | 'danger';
  onPress?: () => void | Promise<void>;
};
type DialogState = {
  title: string;
  message: string;
  tone: DialogTone;
  actions?: DialogAction[];
  scrollable?: boolean;
};

type SettingsScreenProps = {
  initialModal?: 'providers' | 'debug' | null;
  onInitialModalConsumed?: () => void;
  onOpenOnboarding?: () => void;
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SettingsScreen({
  initialModal = null,
  onInitialModalConsumed,
  onOpenOnboarding,
}: SettingsScreenProps = {}) {
  const { colors, mode, setMode, isLoading } = useAppTheme();
  const {
    airportCode,
    isLoading: airportLoading,
    activeProfile,
  } = useAirport();
  const { t, lang, setLang, languages } = useLanguage();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  const translatedOptions = THEME_OPTIONS.map(opt => ({
    ...opt,
    label: opt.id === 'light'
      ? t('themeLight')
      : opt.id === 'dark'
        ? t('themeDark')
        : t('themeAuto'),
    sublabel: opt.id === 'light'
      ? t('themeLightSub')
      : opt.id === 'dark'
        ? t('themeDarkSub')
        : t('themeAutoSub'),
  }));
  const [aeroDataBoxInput, setAeroDataBoxInput] = useState('');
  const [aeroDataBoxGateway, setAeroDataBoxGateway] = useState<AeroDataBoxGateway>('apiMarket');
  const [airLabsInput, setAirLabsInput] = useState('');
  const [fr24Input, setFr24Input] = useState('');
  const [providerPreference, setProviderPreference] = useState<FlightProviderPreference>('auto');
  const [aeroDataBoxConfigured, setAeroDataBoxConfigured] = useState(false);
  const [airLabsConfigured, setAirLabsConfigured] = useState(false);
  const [fr24Configured, setFr24Configured] = useState(false);
  const [aeroDataBoxStatus, setAeroDataBoxStatus] = useState(t('aeroDataBoxKeyNotConfigured'));
  const [airLabsStatus, setAirLabsStatus] = useState(t('airLabsKeyNotConfigured'));
  const [fr24Status, setFr24Status] = useState(t('fr24KeyNotConfigured'));
  const [providerSummary, setProviderSummary] = useState(t('flightProviderAuto'));
  const [providerDebug, setProviderDebug] = useState<FlightProviderDiagnosticsSnapshot | null>(null);
  const [staffMonitorDebug, setStaffMonitorDebug] = useState('');
  const [notificationDebug, setNotificationDebug] = useState<NotificationDebugSnapshot | null>(null);
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const [savingAeroDataBox, setSavingAeroDataBox] = useState(false);
  const [savingAirLabs, setSavingAirLabs] = useState(false);
  const [savingFr24, setSavingFr24] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const consumedInitialModal = useRef<string | null>(null);
  useEffect(() => {
    getCachedUpdateInfo().then(setUpdateInfo);
  }, []);

  const profileSummary = useMemo(() => {
    if (airportLoading) {
      return t('profileSettingsLoading');
    }

    if (!activeProfile) {
      return t('profileSettingsEmpty');
    }

    return t('profileSettingsSummary')
      .replace('{name}', activeProfile.name)
      .replace('{airport}', formatAirportSettingLabel(activeProfile.airportCode))
      .replace('{count}', String(activeProfile.airlines.length));
  }, [activeProfile, airportLoading, t]);

  const providerPreferenceLabel = useCallback((preference: FlightProviderPreference) => {
    switch (preference) {
      case 'aeroDataBox':
        return t('flightProviderAeroDataBox');
      case 'airlabs':
        return t('flightProviderAirLabs');
      case 'staffMonitor':
        return t('flightProviderStaffMonitor');
      case 'fr24':
        return t('flightProviderFr24');
      case 'auto':
      default:
        return t('flightProviderAuto');
    }
  }, [t]);

  const formatAeroDataBoxStatus = useCallback((state: AeroDataBoxKeyState) => {
    if (!state.configured) {
      return t('aeroDataBoxKeyNotConfigured');
    }

    const sourceLabel = state.source === 'device' ? t('airLabsKeyDevice') : t('airLabsKeyBuild');
    return `${sourceLabel}${state.masked ? ` · ${state.masked}` : ''}`;
  }, [t]);

  const formatAirLabsStatus = useCallback((state: AirLabsKeyState) => {
    if (!state.configured) {
      return t('airLabsKeyNotConfigured');
    }

    const sourceLabel = state.source === 'device' ? t('airLabsKeyDevice') : t('airLabsKeyBuild');
    return `${sourceLabel}${state.masked ? ` · ${state.masked}` : ''}`;
  }, [t]);

  const formatFr24Status = useCallback((state: Fr24KeyState) => {
    if (!state.configured) {
      return t('fr24KeyNotConfigured');
    }

    const sourceLabel = state.source === 'device' ? t('airLabsKeyDevice') : t('airLabsKeyBuild');
    return `${sourceLabel}${state.masked ? ` · ${state.masked}` : ''}`;
  }, [t]);

  const refreshProviderSettings = useCallback(async () => {
    const state = await getFlightProviderSettingsState();
    const aeroDataBoxLabel = formatAeroDataBoxStatus(state.aeroDataBox);
    const airLabsLabel = formatAirLabsStatus(state.airLabs);
    const fr24Label = formatFr24Status(state.fr24);
    setProviderPreference(state.preference);
    setAeroDataBoxGateway(state.aeroDataBoxGateway);
    setAeroDataBoxConfigured(state.aeroDataBox.configured);
    setAirLabsConfigured(state.airLabs.configured);
    setFr24Configured(state.fr24.configured);
    setAeroDataBoxStatus(aeroDataBoxLabel);
    setAirLabsStatus(airLabsLabel);
    setFr24Status(fr24Label);
    setProviderSummary(`${providerPreferenceLabel(state.preference)} · AeroDataBox ${state.aeroDataBox.configured ? 'ok' : 'no'} · FR24 ${state.fr24.configured ? 'ok' : 'no'} · AirLabs ${state.airLabs.configured ? 'ok' : 'no'}`);
  }, [formatAeroDataBoxStatus, formatAirLabsStatus, formatFr24Status, providerPreferenceLabel]);

  const refreshProviderDebug = useCallback(async () => {
    const snapshot = await getCachedFlightProviderDiagnostics(airportCode);
    setProviderDebug(snapshot);
    setStaffMonitorDebug([
      getStaffMonitorDebugStatus(),
      getStaffMonitorDebugColumns(),
      getStaffMonitorDebugFlights(),
    ].filter(Boolean).join('\n'));
  }, [airportCode]);

  const refreshNotificationDebug = useCallback(async () => {
    const snapshot = await getNotificationDebugSnapshot();
    setNotificationDebug(snapshot);
  }, []);

  useEffect(() => {
    refreshProviderSettings().catch(() => {});
    refreshProviderDebug().catch(() => {});
    refreshNotificationDebug().catch(() => {});
  }, [refreshNotificationDebug, refreshProviderDebug, refreshProviderSettings]);

  const showDialog = useCallback((dialog: DialogState) => {
    setDialogState(dialog);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState(null);
  }, []);

  const handleDialogAction = useCallback((action?: DialogAction) => {
    setDialogState(null);
    Promise.resolve()
      .then(() => action?.onPress?.())
      .catch(() => {});
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    const info = await checkForUpdate(true);
    setUpdateInfo(info);
    setCheckingUpdate(false);
    if (!info) {
      showDialog({
        title: t('error'),
        message: t('updateCheckErrorMessage'),
        tone: 'error',
      });
    } else if (info.available) {
      setShowUpdateModal(true);
    } else {
      showDialog({
        title: t('updateCheckOkTitle'),
        message: t('updateCheckOkMessage').replace('{version}', APP_VERSION),
        tone: 'success',
      });
    }
  }, [showDialog, t]);

  const handleDownload = useCallback(() => {
    if (updateInfo?.available) {
      setShowUpdateModal(true);
    }
  }, [updateInfo]);

  const handleExport = useCallback(async () => {
    setExportingBackup(true);
    const result = await exportBackup();
    setExportingBackup(false);
    if (result.ok) {
      showDialog({
        title: 'Backup esportato',
        message: 'File salvato nella cartella selezionata. Password e PIN non vengono inclusi per sicurezza.',
        tone: 'success',
      });
    } else if (result.error !== 'Permesso negato' && result.error !== 'Annullato') {
      showDialog({
        title: t('error'),
        message: result.error,
        tone: 'error',
      });
    }
  }, [showDialog, t]);

  const handleImport = useCallback(async () => {
    showDialog({
      title: 'Importa backup',
      message: 'I dati compatibili del backup (note, rubrica, manuali e impostazioni) sovrascriveranno quelli attuali. I backup recenti non includono password e PIN. Continuare?',
      tone: 'warning',
      actions: [
        { label: t('cancel'), style: 'secondary' },
        {
          label: 'Importa',
          style: 'danger',
          onPress: async () => {
            setImportingBackup(true);
            const result = await importBackup();
            setImportingBackup(false);
            if (result.ok) {
              showDialog({
                title: 'Backup importato',
                message: 'Riavvia l\'app per applicare tutte le modifiche.',
                tone: 'success',
              });
            } else if (result.error !== 'Annullato') {
              showDialog({
                title: t('error'),
                message: result.error,
                tone: 'error',
              });
            }
          },
        },
      ],
    });
  }, [showDialog, t]);

  const openProviderModal = async () => {
    await refreshProviderSettings();
    setAeroDataBoxInput(await getAeroDataBoxApiKey() ?? '');
    setAirLabsInput(await getAirLabsApiKey() ?? '');
    setFr24Input(await getFr24ApiKey() ?? '');
    setProviderModalOpen(true);
  };

  const closeProviderModal = () => {
    setProviderModalOpen(false);
    setAeroDataBoxInput('');
    setAirLabsInput('');
    setFr24Input('');
  };

  const openDebugModal = async () => {
    await Promise.all([
      refreshProviderDebug(),
      refreshNotificationDebug(),
    ]);
    setDebugModalOpen(true);
  };

  const closeDebugModal = () => {
    setDebugModalOpen(false);
  };

  useEffect(() => {
    if (!initialModal || consumedInitialModal.current === initialModal) {
      return;
    }

    consumedInitialModal.current = initialModal;
    const openInitialModal = initialModal === 'providers' ? openProviderModal : openDebugModal;
    openInitialModal()
      .catch(() => {})
      .finally(() => onInitialModalConsumed?.());
  }, [initialModal, onInitialModalConsumed]);

  const chooseProviderPreference = async (preference: FlightProviderPreference) => {
    setProviderPreference(preference);
    await saveFlightProviderPreference(preference);
    await refreshProviderSettings();
  };

  const chooseAeroDataBoxGateway = async (gateway: AeroDataBoxGateway) => {
    setAeroDataBoxGateway(gateway);
    await saveAeroDataBoxGateway(gateway);
    await refreshProviderSettings();
  };

  const openExternalLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      showDialog({
        title: t('error'),
        message: t('flightDebugOpenLinkError'),
        tone: 'error',
      });
    });
  }, [showDialog, t]);

  const clearScheduledNotifications = useCallback(async () => {
    setClearingNotifications(true);
    try {
      const cancelled = await cancelAeroStaffScheduledNotifications({
        includeShift: true,
        includePinned: true,
        reason: 'settings debug clear',
        source: 'settings',
        logEmpty: true,
      });
      await refreshNotificationDebug();
      showDialog({
        title: t('notificationDebugClearedTitle'),
        message: t('notificationDebugClearedMsg').replace('{count}', String(cancelled)),
        tone: 'success',
      });
    } finally {
      setClearingNotifications(false);
    }
  }, [refreshNotificationDebug, showDialog, t]);

  const saveAeroDataBoxKey = async () => {
    setSavingAeroDataBox(true);
    try {
      await saveAeroDataBoxApiKey(aeroDataBoxInput);
      await refreshProviderSettings();
      setAeroDataBoxInput(await getAeroDataBoxApiKey() ?? '');
    } catch {
      showDialog({
        title: t('error'),
        message: t('aeroDataBoxKeyErrorMsg'),
        tone: 'error',
      });
    } finally {
      setSavingAeroDataBox(false);
    }
  };

  const removeAeroDataBoxKey = async () => {
    setSavingAeroDataBox(true);
    try {
      await clearAeroDataBoxApiKey();
      await refreshProviderSettings();
      setAeroDataBoxInput('');
    } catch {
      showDialog({
        title: t('error'),
        message: t('aeroDataBoxKeyErrorMsg'),
        tone: 'error',
      });
    } finally {
      setSavingAeroDataBox(false);
    }
  };

  const saveAirLabsKey = async () => {
    setSavingAirLabs(true);
    try {
      await saveAirLabsApiKey(airLabsInput);
      await refreshProviderSettings();
      setAirLabsInput(await getAirLabsApiKey() ?? '');
    } catch {
      showDialog({
        title: t('error'),
        message: t('airLabsKeyErrorMsg'),
        tone: 'error',
      });
    } finally {
      setSavingAirLabs(false);
    }
  };

  const removeAirLabsKey = async () => {
    setSavingAirLabs(true);
    try {
      await clearAirLabsApiKey();
      await refreshProviderSettings();
      setAirLabsInput('');
    } catch {
      showDialog({
        title: t('error'),
        message: t('airLabsKeyErrorMsg'),
        tone: 'error',
      });
    } finally {
      setSavingAirLabs(false);
    }
  };

  const saveFr24Key = async () => {
    setSavingFr24(true);
    try {
      await saveFr24ApiKey(fr24Input);
      await refreshProviderSettings();
      setFr24Input(await getFr24ApiKey() ?? '');
    } catch {
      showDialog({
        title: t('error'),
        message: t('fr24KeyErrorMsg'),
        tone: 'error',
      });
    } finally {
      setSavingFr24(false);
    }
  };

  const removeFr24Key = async () => {
    setSavingFr24(true);
    try {
      await clearFr24ApiKey();
      await refreshProviderSettings();
      setFr24Input('');
    } catch {
      showDialog({
        title: t('error'),
        message: t('fr24KeyErrorMsg'),
        tone: 'error',
      });
    } finally {
      setSavingFr24(false);
    }
  };

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      {/* Header */}
      <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }, colors.isDark ? { shadowOpacity: 0, elevation: 0, borderWidth: 1 } : { shadowColor: colors.primary }]}>
        <View style={[styles.bannerIcon, { backgroundColor: colors.primaryLight }]}>
          <MaterialIcons name="settings" size={28} color={colors.primary} />
        </View>
        <View>
          <Text style={[styles.bannerTitle, { color: colors.primaryDark }]}>{t('settingsTitle')}</Text>
          <Text style={[styles.bannerSub, { color: colors.textMuted }]}>AeroStaff Pro · v{APP_VERSION}</Text>
        </View>
      </View>

      {/* ── Sezione Tema ── */}
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{t('sectionTheme')}</Text>

      {isLoading ? (
        <View style={[styles.card, { backgroundColor: colors.card, alignItems: 'center', padding: 24 }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.rowSub, { color: colors.textMuted, marginTop: 8 }]}>
            {t('themeLoading')}
          </Text>
        </View>
      ) : (
        <View style={styles.themeGrid}>
          {translatedOptions.map(opt => (
            <ThemeCard
              key={opt.id}
              option={opt}
              selected={mode === opt.id}
              onSelect={() => setMode(opt.id)}
              activeLabel={t('themeActive')}
            />
          ))}
        </View>
      )}

      {/* ── Sezione Account ── */}
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{t('sectionAccount')}</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, colors.isDark && { elevation: 0, shadowOpacity: 0, borderWidth: 1 }]}>
        {onOpenOnboarding && (
          <>
            <SettingRow
              icon="tune"
              label="Setup guidato"
              sublabel="Rivedi profilo, permessi, API voli, notifiche e widget"
              type="arrow"
              onPress={onOpenOnboarding}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </>
        )}
        <SettingRow
          icon="badge"
          label={t('profileTitle')}
          sublabel={profileSummary}
          type="arrow"
          onPress={() => setProfileModalOpen(true)}
          disabled={airportLoading}
        />
      </View>

      {/* ── Sezione Fonti voli ── */}
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{t('sectionFlightData')}</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, colors.isDark && { elevation: 0, shadowOpacity: 0, borderWidth: 1 }]}>
        <SettingRow
          icon="vpn-key"
          label={t('flightProviderSettingsTitle')}
          sublabel={providerSummary}
          type="arrow"
          onPress={() => { openProviderModal().catch(() => {}); }}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <SettingRow
          icon="bug-report"
          label={t('flightDebugMenuTitle')}
          sublabel={providerDebug
            ? `${providerDebug.sourceLabel} · ${new Date(providerDebug.fetchedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`
            : t('flightDebugMenuSub')}
          type="arrow"
          onPress={() => { openDebugModal().catch(() => {}); }}
        />
      </View>

      {/* ── Info app ── */}
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{t('sectionApp')}</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, colors.isDark && { elevation: 0, shadowOpacity: 0, borderWidth: 1 }]}>
        <SettingRow icon="info-outline" label={t('appVersion')} sublabel={`v${APP_VERSION}`} type="info" />
      </View>

      {/* ── Sezione Aggiornamenti ── */}
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>AGGIORNAMENTI</Text>
      <View style={[styles.updateCard, { backgroundColor: colors.card, borderColor: updateInfo?.available ? colors.primary : colors.border }, colors.isDark && { elevation: 0, borderWidth: 1 }]}>
        {/* Version row */}
        <View style={styles.updateTop}>
          <View style={[styles.updateIconWrap, { backgroundColor: updateInfo?.available ? colors.primary : colors.primaryLight }]}>
            <MaterialIcons name="system-update" size={24} color={updateInfo?.available ? '#fff' : colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.updateTitle, { color: colors.text }]}>
              {updateInfo?.available ? `Aggiornamento disponibile` : 'AeroStaff Pro'}
            </Text>
            <Text style={[styles.updateSub, { color: colors.textMuted }]}>
              {updateInfo?.available
                ? `Versione ${updateInfo.latestVersion} pronta`
                : `v${APP_VERSION} · versione installata`}
            </Text>
          </View>
          {updateInfo?.available && (
            <View style={[styles.newBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.newBadgeTxt}>NEW</Text>
            </View>
          )}
        </View>
        {/* Action buttons */}
        <View style={styles.updateActions}>
          <TouchableOpacity
            style={[styles.updateBtn, { backgroundColor: colors.primaryLight, borderColor: colors.border, borderWidth: 1 }, checkingUpdate && { opacity: 0.6 }]}
            onPress={handleCheckUpdate}
            disabled={checkingUpdate}
            activeOpacity={0.8}
          >
            {checkingUpdate
              ? <ActivityIndicator size={14} color={colors.primary} />
              : <MaterialIcons name="refresh" size={16} color={colors.primary} />}
            <Text style={[styles.updateBtnTxt, { color: colors.primary }]}>
              {checkingUpdate ? 'Controllo…' : 'Controlla'}
            </Text>
          </TouchableOpacity>
          {updateInfo?.available && (
            <TouchableOpacity
              style={[styles.updateBtn, { backgroundColor: colors.primary, flex: 1 }]}
              onPress={handleDownload}
              activeOpacity={0.8}
            >
              <MaterialIcons name="download" size={16} color="#fff" />
              <Text style={[styles.updateBtnTxt, { color: '#fff', fontWeight: '800' }]}>
                Gestisci v{updateInfo.latestVersion.replace(/^v/i, '')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Sezione Backup ── */}
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>BACKUP</Text>
      <View style={styles.backupRow}>
        {/* Esporta */}
        <TouchableOpacity
          style={[styles.backupTile, { backgroundColor: colors.card, borderColor: colors.border }, colors.isDark && { borderWidth: 1 }, exportingBackup && { opacity: 0.6 }]}
          onPress={handleExport}
          disabled={exportingBackup}
          activeOpacity={0.8}
        >
          <View style={[styles.backupTileIcon, { backgroundColor: '#10B98122' }]}>
            {exportingBackup
              ? <ActivityIndicator size={22} color="#10B981" />
              : <MaterialIcons name="upload" size={26} color="#10B981" />}
          </View>
          <Text style={[styles.backupTileLabel, { color: colors.text }]}>Esporta</Text>
          <Text style={[styles.backupTileSub, { color: colors.textMuted }]}>Salva su file</Text>
        </TouchableOpacity>
        {/* Importa */}
        <TouchableOpacity
          style={[styles.backupTile, { backgroundColor: colors.card, borderColor: colors.border }, colors.isDark && { borderWidth: 1 }, importingBackup && { opacity: 0.6 }]}
          onPress={handleImport}
          disabled={importingBackup}
          activeOpacity={0.8}
        >
          <View style={[styles.backupTileIcon, { backgroundColor: '#3B82F622' }]}>
            {importingBackup
              ? <ActivityIndicator size={22} color="#3B82F6" />
              : <MaterialIcons name="download" size={26} color="#3B82F6" />}
          </View>
          <Text style={[styles.backupTileLabel, { color: colors.text }]}>Importa</Text>
          <Text style={[styles.backupTileSub, { color: colors.textMuted }]}>Ripristina da file</Text>
        </TouchableOpacity>
      </View>

      {/* ── Sezione Lingua ── */}
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{t('sectionLanguage')}</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, colors.isDark && { elevation: 0, shadowOpacity: 0, borderWidth: 1 }]}>
        {languages.map((langOpt, idx) => (
          <React.Fragment key={langOpt.code}>
            {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            <TouchableOpacity
              style={[styles.row, lang === langOpt.code && { backgroundColor: colors.primaryLight }]}
              onPress={() => setLang(langOpt.code)}
              activeOpacity={0.8}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
                <MaterialIcons name="language" size={18} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{langOpt.label}</Text>
              </View>
              {lang === langOpt.code && (
                <MaterialIcons name="check-circle" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {showUpdateModal && updateInfo && (
        <UpdateModal
          info={updateInfo}
          onDismiss={() => {
            markUpdateSeen(updateInfo.latestVersion).catch(() => {});
            setShowUpdateModal(false);
          }}
        />
      )}

      {dialogState && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={closeDialog}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeDialog} />
            <View style={[styles.statusModalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[
                styles.statusModalIconWrap,
                {
                  backgroundColor:
                    dialogState.tone === 'success'
                      ? colors.primaryLight
                      : dialogState.tone === 'warning'
                        ? '#F59E0B22'
                        : dialogState.tone === 'info'
                          ? '#2563EB22'
                          : '#DC262622',
                },
              ]}>
                <MaterialIcons
                  name={
                    dialogState.tone === 'success'
                      ? 'verified'
                      : dialogState.tone === 'warning'
                        ? 'warning-amber'
                        : dialogState.tone === 'info'
                          ? 'info-outline'
                          : 'error-outline'
                  }
                  size={24}
                  color={
                    dialogState.tone === 'success'
                      ? colors.primary
                      : dialogState.tone === 'warning'
                        ? '#D97706'
                        : dialogState.tone === 'info'
                          ? '#2563EB'
                          : '#DC2626'
                  }
                />
              </View>
              <Text style={[styles.statusModalTitle, { color: colors.text }]}>{dialogState.title}</Text>
              {dialogState.scrollable ? (
                <ScrollView
                  style={styles.statusModalScroll}
                  contentContainerStyle={styles.statusModalScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={[styles.statusModalMessage, { color: colors.textSub }]}>{dialogState.message}</Text>
                </ScrollView>
              ) : (
                <Text style={[styles.statusModalMessage, { color: colors.textSub }]}>{dialogState.message}</Text>
              )}
              <View style={styles.statusModalActions}>
                {(dialogState.actions ?? [{ label: t('ok'), style: 'primary' }]).map((action, index) => {
                  const actionStyle = action.style ?? 'primary';
                  return (
                    <TouchableOpacity
                      key={`${action.label}_${index}`}
                      style={[
                        styles.statusModalBtn,
                        actionStyle === 'primary' && { backgroundColor: colors.primary },
                        actionStyle === 'secondary' && {
                          backgroundColor: colors.cardSecondary,
                          borderColor: colors.border,
                          borderWidth: 1,
                        },
                        actionStyle === 'danger' && { backgroundColor: '#DC2626' },
                      ]}
                      onPress={() => { handleDialogAction(action); }}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.statusModalBtnText,
                          actionStyle === 'secondary' && { color: colors.text },
                        ]}
                      >
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </Modal>
      )}

      <ProfileSwitcherModal
        visible={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
      />

      <Modal
        visible={providerModalOpen}
        animationType="slide"
        onRequestClose={closeProviderModal}
      >
        <KeyboardAvoidingView
          style={[styles.providerRoot, { backgroundColor: colors.bg }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.providerHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.providerCloseBtn, { backgroundColor: colors.cardSecondary }]}
              onPress={closeProviderModal}
              activeOpacity={0.85}
            >
              <MaterialIcons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.providerHeaderText}>
              <Text style={[styles.providerTitle, { color: colors.primaryDark }]}>
                {t('flightProviderSettingsTitle')}
              </Text>
              <Text style={[styles.providerSubtitle, { color: colors.textMuted }]}>
                {t('flightProviderSettingsSub')}
              </Text>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.providerContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('flightProviderPreferredTitle')}
            </Text>
            <View style={styles.providerOptions}>
              {([
                {
                  id: 'auto',
                  icon: 'auto-awesome',
                  title: t('flightProviderAuto'),
                  sub: t('flightProviderAutoSub'),
                },
                {
                  id: 'staffMonitor',
                  icon: 'flight-takeoff',
                  title: t('flightProviderStaffMonitor'),
                  sub: t('flightProviderStaffMonitorSub'),
                },
                {
                  id: 'aeroDataBox',
                  icon: 'hub',
                  title: t('flightProviderAeroDataBox'),
                  sub: aeroDataBoxConfigured ? t('flightProviderAeroDataBoxSub') : t('flightProviderAeroDataBoxNeedsKey'),
                },
                {
                  id: 'airlabs',
                  icon: 'travel-explore',
                  title: t('flightProviderAirLabs'),
                  sub: airLabsConfigured ? t('flightProviderAirLabsSub') : t('flightProviderAirLabsNeedsKey'),
                },
                {
                  id: 'fr24',
                  icon: 'public',
                  title: t('flightProviderFr24'),
                  sub: fr24Configured ? t('flightProviderFr24Sub') : t('flightProviderFr24NeedsKey'),
                },
              ] as Array<{
                id: FlightProviderPreference;
                icon: keyof typeof MaterialIcons.glyphMap;
                title: string;
                sub: string;
              }>).map(option => {
                const selected = providerPreference === option.id;
                const warn = (option.id === 'aeroDataBox' && !aeroDataBoxConfigured)
                  || (option.id === 'airlabs' && !airLabsConfigured)
                  || (option.id === 'fr24' && !fr24Configured);
                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.providerOption,
                      {
                        backgroundColor: selected ? colors.primaryLight : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => { chooseProviderPreference(option.id).catch(() => {}); }}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.providerOptionIcon, { backgroundColor: selected ? colors.primary : colors.primaryLight }]}>
                      <MaterialIcons name={option.icon} size={20} color={selected ? '#fff' : colors.primary} />
                    </View>
                    <View style={styles.providerOptionText}>
                      <Text style={[styles.providerOptionTitle, { color: selected ? colors.primaryDark : colors.text }]}>
                        {option.title}
                      </Text>
                      <Text style={[styles.providerOptionSub, { color: warn ? '#D97706' : colors.textMuted }]}>
                        {option.sub}
                      </Text>
                    </View>
                    {selected && <MaterialIcons name="check-circle" size={22} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('flightProviderKeysTitle')}
            </Text>
            <Text style={[styles.providerSectionHelp, { color: colors.textMuted }]}>
              {t('flightProviderKeysSub')}
            </Text>

            <View style={[styles.providerKeyCard, styles.providerKeyCardFeatured, { backgroundColor: colors.card, borderColor: colors.primary }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primary }]}>
                  <MaterialIcons name="hub" size={20} color="#fff" />
                </View>
                <View style={styles.providerOptionText}>
                  <View style={styles.providerKeyTitleRow}>
                    <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                      {t('aeroDataBoxKey')}
                    </Text>
                    <View style={[styles.providerKeyBadge, { backgroundColor: colors.primaryLight }]}>
                      <Text style={[styles.providerKeyBadgeText, { color: colors.primaryDark }]}>
                        {t('flightProviderSchedulesBadge')}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {aeroDataBoxStatus}
                  </Text>
                </View>
              </View>

              <Text style={[styles.modalCopy, { color: colors.textMuted }]}>
                {t('aeroDataBoxModalCopy')}
              </Text>

              <Text style={[styles.modalLabel, { color: colors.textMuted }]}>
                {t('aeroDataBoxGatewayTitle')}
              </Text>
              <View style={styles.gatewayToggle}>
                {([
                  { id: 'apiMarket', label: t('aeroDataBoxGatewayApiMarket') },
                  { id: 'rapidApi', label: t('aeroDataBoxGatewayRapidApi') },
                ] as Array<{ id: AeroDataBoxGateway; label: string }>).map(gateway => {
                  const selected = aeroDataBoxGateway === gateway.id;
                  return (
                    <TouchableOpacity
                      key={gateway.id}
                      style={[
                        styles.gatewayBtn,
                        {
                          backgroundColor: selected ? colors.primary : colors.cardSecondary,
                          borderColor: selected ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => { chooseAeroDataBoxGateway(gateway.id).catch(() => {}); }}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.gatewayBtnText, { color: selected ? '#fff' : colors.text }]}>
                        {gateway.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.modalLabel, { color: colors.textMuted }]}>
                {t('aeroDataBoxModalLabel')}
              </Text>
              <TextInput
                value={aeroDataBoxInput}
                onChangeText={setAeroDataBoxInput}
                placeholder={aeroDataBoxGateway === 'rapidApi' ? 'X-RapidAPI-Key' : 'x-magicapi-key'}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#DC2626' }, savingAeroDataBox && { opacity: 0.6 }]}
                  onPress={removeAeroDataBoxKey}
                  disabled={savingAeroDataBox}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.modalBtnTxt, { color: '#fff' }]}>{t('remove')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: colors.primary }, savingAeroDataBox && { opacity: 0.6 }]}
                  onPress={saveAeroDataBoxKey}
                  disabled={savingAeroDataBox}
                  activeOpacity={0.85}
                >
                  {savingAeroDataBox
                    ? <ActivityIndicator size={16} color="#fff" />
                    : <Text style={[styles.modalBtnTxt, { color: '#fff' }]}>{t('save')}</Text>}
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.providerKeyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="key" size={20} color={colors.primary} />
                </View>
                <View style={styles.providerOptionText}>
                  <View style={styles.providerKeyTitleRow}>
                    <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                      {t('airLabsKey')}
                    </Text>
                    <View style={[styles.providerKeyBadge, { backgroundColor: colors.primaryLight }]}>
                      <Text style={[styles.providerKeyBadgeText, { color: colors.primaryDark }]}>
                        {t('flightProviderSchedulesBadge')}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {airLabsStatus}
                  </Text>
                </View>
              </View>

              <Text style={[styles.modalCopy, { color: colors.textMuted }]}>
                {t('airLabsModalCopy')}
              </Text>
              <Text style={[styles.modalLabel, { color: colors.textMuted }]}>
                {t('airLabsModalLabel')}
              </Text>
              <TextInput
                value={airLabsInput}
                onChangeText={setAirLabsInput}
                placeholder="api_key"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#DC2626' }, savingAirLabs && { opacity: 0.6 }]}
                  onPress={removeAirLabsKey}
                  disabled={savingAirLabs}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.modalBtnTxt, { color: '#fff' }]}>{t('remove')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: colors.primary }, savingAirLabs && { opacity: 0.6 }]}
                  onPress={saveAirLabsKey}
                  disabled={savingAirLabs}
                  activeOpacity={0.85}
                >
                  {savingAirLabs
                    ? <ActivityIndicator size={16} color="#fff" />
                    : <Text style={[styles.modalBtnTxt, { color: '#fff' }]}>{t('save')}</Text>}
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.providerKeyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="public" size={20} color={colors.primary} />
                </View>
                <View style={styles.providerOptionText}>
                  <View style={styles.providerKeyTitleRow}>
                    <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                      {t('fr24Key')}
                    </Text>
                    <View style={[styles.providerKeyBadge, { backgroundColor: colors.primaryLight }]}>
                      <Text style={[styles.providerKeyBadgeText, { color: colors.primaryDark }]}>
                        {t('flightProviderLiveBadge')}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {fr24Status}
                  </Text>
                </View>
              </View>

              <Text style={[styles.modalCopy, { color: colors.textMuted }]}>
                {t('fr24ModalCopy')}
              </Text>
              <Text style={[styles.modalLabel, { color: colors.textMuted }]}>
                {t('fr24ModalLabel')}
              </Text>
              <TextInput
                value={fr24Input}
                onChangeText={setFr24Input}
                placeholder="API token"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#DC2626' }, savingFr24 && { opacity: 0.6 }]}
                  onPress={removeFr24Key}
                  disabled={savingFr24}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.modalBtnTxt, { color: '#fff' }]}>{t('remove')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: colors.primary }, savingFr24 && { opacity: 0.6 }]}
                  onPress={saveFr24Key}
                  disabled={savingFr24}
                  activeOpacity={0.85}
                >
                  {savingFr24
                    ? <ActivityIndicator size={16} color="#fff" />
                    : <Text style={[styles.modalBtnTxt, { color: '#fff' }]}>{t('save')}</Text>}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.hiddenDebugLegacy}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('flightDebugLinksTitle')}
            </Text>
            <View style={[styles.providerKeyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="link" size={20} color={colors.primary} />
                </View>
                <View style={styles.providerOptionText}>
                  <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                    {t('flightDebugStaffMonitorTitle')}
                  </Text>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {t('flightDebugStaffMonitorSub')}
                  </Text>
                </View>
              </View>
              <View style={styles.providerLinkGrid}>
                <TouchableOpacity
                  style={[styles.providerLinkBtn, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}
                  onPress={() => openExternalLink(STAFF_MONITOR_LINKS.main)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="open-in-new" size={15} color={colors.primary} />
                  <Text style={[styles.providerLinkText, { color: colors.primaryDark }]}>{t('flightDebugStaffMonitorMain')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.providerLinkBtn, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}
                  onPress={() => openExternalLink(STAFF_MONITOR_LINKS.departures)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="flight-takeoff" size={15} color={colors.primary} />
                  <Text style={[styles.providerLinkText, { color: colors.primaryDark }]}>{t('flightDepartures')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.providerLinkBtn, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}
                  onPress={() => openExternalLink(STAFF_MONITOR_LINKS.arrivals)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="flight-land" size={15} color={colors.primary} />
                  <Text style={[styles.providerLinkText, { color: colors.primaryDark }]}>{t('flightArrivals')}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('flightDebugTitle')}
            </Text>
            <View style={[styles.providerKeyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="bug-report" size={20} color={colors.primary} />
                </View>
                <View style={styles.providerOptionText}>
                  <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                    {t('flightDebugLastFetch')}
                  </Text>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {providerDebug
                      ? `${providerDebug.sourceLabel} · ${new Date(providerDebug.fetchedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`
                      : t('flightDebugNoData')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.providerRefreshBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
                  onPress={() => { refreshProviderDebug().catch(() => {}); }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="refresh" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {providerDebug ? (
                <>
                  <View style={styles.debugMetaGrid}>
                    <View style={[styles.debugMetaPill, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('airportBase')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{providerDebug.airportCode}</Text>
                    </View>
                    <View style={[styles.debugMetaPill, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('flightArrivals')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{providerDebug.arrivals}</Text>
                    </View>
                    <View style={[styles.debugMetaPill, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('flightDepartures')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{providerDebug.departures}</Text>
                    </View>
                  </View>

                  <View style={styles.debugProviderList}>
                    {providerDebug.diagnostics.length > 0 ? providerDebug.diagnostics.map((item, index) => {
                      const statusColor = item.status === 'success'
                        ? '#10B981'
                        : item.status === 'skipped'
                          ? '#94A3B8'
                          : '#EF4444';
                      return (
                        <View
                          key={`${item.provider}_${index}`}
                          style={[styles.debugProviderRow, { borderColor: colors.border, backgroundColor: colors.cardSecondary }]}
                        >
                          <View style={[styles.debugStatusDot, { backgroundColor: statusColor }]} />
                          <View style={styles.providerOptionText}>
                            <Text style={[styles.debugProviderName, { color: colors.text }]}>{item.label}</Text>
                            <Text style={[styles.debugProviderSub, { color: colors.textMuted }]}>
                              {formatProviderDiagnostic(item)}
                            </Text>
                          </View>
                        </View>
                      );
                    }) : (
                      <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>{t('flightDebugNoProviderDetails')}</Text>
                    )}
                  </View>
                </>
              ) : (
                <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                  {t('flightDebugNoDataSub')}
                </Text>
              )}

              <Text style={[styles.modalLabel, { color: colors.textMuted, marginTop: 16 }]}>
                {t('flightDebugStaffMonitorParser')}
              </Text>
              <Text style={[styles.debugMono, { color: colors.textMuted, backgroundColor: colors.bg, borderColor: colors.border }]}>
                {staffMonitorDebug || t('flightDebugNoStaffMonitorDebug')}
              </Text>
            </View>

            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('notificationDebugTitle')}
            </Text>
            <View style={[styles.providerKeyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="notifications-active" size={20} color={colors.primary} />
                </View>
                <View style={styles.providerOptionText}>
                  <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                    {t('notificationDebugTitle')}
                  </Text>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {notificationDebug
                      ? t('notificationDebugSubtitle')
                        .replace('{pending}', String(notificationDebug.pendingAeroStaff))
                        .replace('{duplicates}', String(notificationDebug.possibleDuplicates.length))
                      : t('notificationDebugNoData')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.providerRefreshBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
                  onPress={() => { refreshNotificationDebug().catch(() => {}); }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="refresh" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {notificationDebug ? (
                <>
                  <View style={styles.debugMetaWrap}>
                    <View style={[styles.debugMetaPillSmall, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('notificationDebugEnabled')}</Text>
                      <Text style={[styles.debugMetaValue, { color: notificationDebug.enabled ? '#10B981' : colors.text }]}>
                        {notificationDebug.enabled ? t('yes') : t('no')}
                      </Text>
                    </View>
                    <View style={[styles.debugMetaPillSmall, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('notificationDebugPending')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{notificationDebug.pendingAeroStaff}</Text>
                    </View>
                    <View style={[styles.debugMetaPillSmall, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('notificationDebugSavedShift')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{notificationDebug.savedShiftIds}</Text>
                    </View>
                    <View style={[styles.debugMetaPillSmall, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('notificationDebugSavedPinned')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{notificationDebug.savedPinnedIds}</Text>
                    </View>
                    <View style={[styles.debugMetaPillSmall, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('notificationDebugDuplicates')}</Text>
                      <Text style={[styles.debugMetaValue, { color: notificationDebug.possibleDuplicates.length > 0 ? '#EF4444' : colors.text }]}>
                        {notificationDebug.possibleDuplicates.length}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.notificationDebugActions}>
                    <TouchableOpacity
                      style={[styles.notificationClearBtn, { backgroundColor: '#DC262622', borderColor: '#DC262655' }, clearingNotifications && { opacity: 0.6 }]}
                      onPress={() => { clearScheduledNotifications().catch(() => {}); }}
                      disabled={clearingNotifications}
                      activeOpacity={0.85}
                    >
                      {clearingNotifications
                        ? <ActivityIndicator size={15} color="#DC2626" />
                        : <MaterialIcons name="delete-sweep" size={16} color="#DC2626" />}
                      <Text style={styles.notificationClearText}>{t('notificationDebugClear')}</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.modalLabel, { color: colors.textMuted }]}>
                    {t('notificationDebugPendingList')}
                  </Text>
                  <Text style={[styles.debugMono, { color: colors.textMuted, backgroundColor: colors.bg, borderColor: colors.border }]}>
                    {notificationDebug.pendingRequests.length > 0
                      ? notificationDebug.pendingRequests
                        .slice(0, 8)
                        .map(item => `${item.kind}/${item.type} · ${item.flightNumber}\n${item.trigger}\n${item.dedupeKey}`)
                        .join('\n\n')
                      : t('notificationDebugNoPending')}
                  </Text>

                  <Text style={[styles.modalLabel, { color: colors.textMuted, marginTop: 16 }]}>
                    {t('notificationDebugDuplicateList')}
                  </Text>
                  <Text style={[styles.debugMono, { color: colors.textMuted, backgroundColor: colors.bg, borderColor: colors.border }]}>
                    {notificationDebug.possibleDuplicates.length > 0
                      ? notificationDebug.possibleDuplicates
                        .slice(0, 5)
                        .map(item => `${item.count}x ${item.key}${item.titles.length > 0 ? `\n${item.titles.join(', ')}` : ''}`)
                        .join('\n\n')
                      : t('notificationDebugNoDuplicates')}
                  </Text>

                  <Text style={[styles.modalLabel, { color: colors.textMuted, marginTop: 16 }]}>
                    {t('notificationDebugLastEvents')}
                  </Text>
                  <View style={styles.debugProviderList}>
                    {notificationDebug.lastEvents.length > 0 ? notificationDebug.lastEvents.slice(0, 6).map((event, index) => {
                      const meta = [
                        typeof event.scheduled === 'number' ? `${t('notificationDebugScheduledShort')}:${event.scheduled}` : null,
                        typeof event.cancelled === 'number' ? `${t('notificationDebugCancelledShort')}:${event.cancelled}` : null,
                        typeof event.pending === 'number' ? `${t('notificationDebugPendingShort')}:${event.pending}` : null,
                      ].filter(Boolean).join(' · ');
                      return (
                        <View
                          key={`${event.at}_${index}`}
                          style={[styles.debugProviderRow, { borderColor: colors.border, backgroundColor: colors.cardSecondary }]}
                        >
                          <View style={[styles.debugStatusDot, { backgroundColor: notificationEventTone(event) }]} />
                          <View style={styles.providerOptionText}>
                            <Text style={[styles.debugProviderName, { color: colors.text }]}>
                              {event.source} · {event.type} · {new Date(event.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                            <Text style={[styles.debugProviderSub, { color: colors.textMuted }]}>
                              {event.message}{meta ? ` · ${meta}` : ''}
                            </Text>
                          </View>
                        </View>
                      );
                    }) : (
                      <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>{t('notificationDebugNoEvents')}</Text>
                    )}
                  </View>
                </>
              ) : (
                <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                  {t('notificationDebugNoDataSub')}
                </Text>
              )}
            </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={debugModalOpen}
        animationType="slide"
        onRequestClose={closeDebugModal}
      >
        <View style={[styles.providerRoot, { backgroundColor: colors.bg }]}>
          <View style={[styles.providerHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.providerCloseBtn, { backgroundColor: colors.cardSecondary }]}
              onPress={closeDebugModal}
              activeOpacity={0.85}
            >
              <MaterialIcons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.providerHeaderText}>
              <Text style={[styles.providerTitle, { color: colors.primaryDark }]}>
                {t('flightDebugMenuTitle')}
              </Text>
              <Text style={[styles.providerSubtitle, { color: colors.textMuted }]}>
                {t('flightDebugMenuSub')}
              </Text>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.providerContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('flightDebugLinksTitle')}
            </Text>
            <View style={[styles.providerKeyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="link" size={20} color={colors.primary} />
                </View>
                <View style={styles.providerOptionText}>
                  <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                    {t('flightDebugStaffMonitorTitle')}
                  </Text>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {t('flightDebugStaffMonitorSub')}
                  </Text>
                </View>
              </View>
              <View style={styles.providerLinkGrid}>
                <TouchableOpacity
                  style={[styles.providerLinkBtn, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}
                  onPress={() => openExternalLink(STAFF_MONITOR_LINKS.main)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="open-in-new" size={15} color={colors.primary} />
                  <Text style={[styles.providerLinkText, { color: colors.primaryDark }]}>{t('flightDebugStaffMonitorMain')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.providerLinkBtn, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}
                  onPress={() => openExternalLink(STAFF_MONITOR_LINKS.departures)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="flight-takeoff" size={15} color={colors.primary} />
                  <Text style={[styles.providerLinkText, { color: colors.primaryDark }]}>{t('flightDepartures')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.providerLinkBtn, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}
                  onPress={() => openExternalLink(STAFF_MONITOR_LINKS.arrivals)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="flight-land" size={15} color={colors.primary} />
                  <Text style={[styles.providerLinkText, { color: colors.primaryDark }]}>{t('flightArrivals')}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('flightDebugTitle')}
            </Text>
            <View style={[styles.providerKeyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="bug-report" size={20} color={colors.primary} />
                </View>
                <View style={styles.providerOptionText}>
                  <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                    {t('flightDebugLastFetch')}
                  </Text>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {providerDebug
                      ? `${providerDebug.sourceLabel} · ${new Date(providerDebug.fetchedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`
                      : t('flightDebugNoData')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.providerRefreshBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
                  onPress={() => { refreshProviderDebug().catch(() => {}); }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="refresh" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {providerDebug ? (
                <>
                  <View style={styles.debugMetaGrid}>
                    <View style={[styles.debugMetaPill, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('airportBase')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{providerDebug.airportCode}</Text>
                    </View>
                    <View style={[styles.debugMetaPill, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('flightArrivals')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{providerDebug.arrivals}</Text>
                    </View>
                    <View style={[styles.debugMetaPill, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('flightDepartures')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{providerDebug.departures}</Text>
                    </View>
                  </View>

                  <View style={styles.debugProviderList}>
                    {providerDebug.diagnostics.length > 0 ? providerDebug.diagnostics.map((item, index) => {
                      const statusColor = item.status === 'success'
                        ? '#10B981'
                        : item.status === 'skipped'
                          ? '#94A3B8'
                          : '#EF4444';
                      return (
                        <View
                          key={`debug_${item.provider}_${index}`}
                          style={[styles.debugProviderRow, { borderColor: colors.border, backgroundColor: colors.cardSecondary }]}
                        >
                          <View style={[styles.debugStatusDot, { backgroundColor: statusColor }]} />
                          <View style={styles.providerOptionText}>
                            <Text style={[styles.debugProviderName, { color: colors.text }]}>{item.label}</Text>
                            <Text style={[styles.debugProviderSub, { color: colors.textMuted }]}>
                              {formatProviderDiagnostic(item)}
                            </Text>
                          </View>
                        </View>
                      );
                    }) : (
                      <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>{t('flightDebugNoProviderDetails')}</Text>
                    )}
                  </View>
                </>
              ) : (
                <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                  {t('flightDebugNoDataSub')}
                </Text>
              )}

              <Text style={[styles.modalLabel, { color: colors.textMuted, marginTop: 16 }]}>
                {t('flightDebugStaffMonitorParser')}
              </Text>
              <Text style={[styles.debugMono, { color: colors.textMuted, backgroundColor: colors.bg, borderColor: colors.border }]}>
                {staffMonitorDebug || t('flightDebugNoStaffMonitorDebug')}
              </Text>
            </View>

            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('notificationDebugTitle')}
            </Text>
            <View style={[styles.providerKeyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.providerKeyTop}>
                <View style={[styles.providerOptionIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="notifications-active" size={20} color={colors.primary} />
                </View>
                <View style={styles.providerOptionText}>
                  <Text style={[styles.providerOptionTitle, { color: colors.text }]}>
                    {t('notificationDebugTitle')}
                  </Text>
                  <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                    {notificationDebug
                      ? t('notificationDebugSubtitle')
                        .replace('{pending}', String(notificationDebug.pendingAeroStaff))
                        .replace('{duplicates}', String(notificationDebug.possibleDuplicates.length))
                      : t('notificationDebugNoData')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.providerRefreshBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
                  onPress={() => { refreshNotificationDebug().catch(() => {}); }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="refresh" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {notificationDebug ? (
                <>
                  <View style={styles.debugMetaWrap}>
                    <View style={[styles.debugMetaPillSmall, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('notificationDebugEnabled')}</Text>
                      <Text style={[styles.debugMetaValue, { color: notificationDebug.enabled ? '#10B981' : colors.text }]}>
                        {notificationDebug.enabled ? t('yes') : t('no')}
                      </Text>
                    </View>
                    <View style={[styles.debugMetaPillSmall, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('notificationDebugPending')}</Text>
                      <Text style={[styles.debugMetaValue, { color: colors.text }]}>{notificationDebug.pendingAeroStaff}</Text>
                    </View>
                    <View style={[styles.debugMetaPillSmall, { backgroundColor: colors.cardSecondary }]}>
                      <Text style={[styles.debugMetaLabel, { color: colors.textMuted }]}>{t('notificationDebugDuplicates')}</Text>
                      <Text style={[styles.debugMetaValue, { color: notificationDebug.possibleDuplicates.length > 0 ? '#EF4444' : colors.text }]}>
                        {notificationDebug.possibleDuplicates.length}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.notificationDebugActions}>
                    <TouchableOpacity
                      style={[styles.notificationClearBtn, { backgroundColor: '#DC262622', borderColor: '#DC262655' }, clearingNotifications && { opacity: 0.6 }]}
                      onPress={() => { clearScheduledNotifications().catch(() => {}); }}
                      disabled={clearingNotifications}
                      activeOpacity={0.85}
                    >
                      {clearingNotifications
                        ? <ActivityIndicator size={15} color="#DC2626" />
                        : <MaterialIcons name="delete-sweep" size={16} color="#DC2626" />}
                      <Text style={styles.notificationClearText}>{t('notificationDebugClear')}</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.modalLabel, { color: colors.textMuted }]}>
                    {t('notificationDebugLastEvents')}
                  </Text>
                  <View style={styles.debugProviderList}>
                    {notificationDebug.lastEvents.length > 0 ? notificationDebug.lastEvents.slice(0, 6).map((event, index) => (
                      <View
                        key={`debug_event_${event.at}_${index}`}
                        style={[styles.debugProviderRow, { borderColor: colors.border, backgroundColor: colors.cardSecondary }]}
                      >
                        <View style={[styles.debugStatusDot, { backgroundColor: notificationEventTone(event) }]} />
                        <View style={styles.providerOptionText}>
                          <Text style={[styles.debugProviderName, { color: colors.text }]}>
                            {event.source} · {event.type} · {new Date(event.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                          <Text style={[styles.debugProviderSub, { color: colors.textMuted }]}>
                            {event.message}
                          </Text>
                        </View>
                      </View>
                    )) : (
                      <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>{t('notificationDebugNoEvents')}</Text>
                    )}
                  </View>
                </>
              ) : (
                <Text style={[styles.providerOptionSub, { color: colors.textMuted }]}>
                  {t('notificationDebugNoDataSub')}
                </Text>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1 },
  content: { padding: 16, paddingBottom: 96 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, padding: 18, marginBottom: 20,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  bannerIcon:  { width: 52, height: 52, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  bannerTitle: { fontSize: 18, fontWeight: '800' },
  bannerSub:   { fontSize: 12, marginTop: 2 },

  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginBottom: 8, paddingLeft: 4, marginTop: 4 },

  // Theme grid
  themeGrid: { flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  themeCard: {
    flex: 1, minWidth: 100,
    borderRadius: 16, borderWidth: 2,
    overflow: 'hidden',
  },
  themeCardSelected: {
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 5,
  },
  preview: { height: 80, justifyContent: 'space-between' },
  previewBar:     { height: 12, width: '100%' },
  previewContent: { flex: 1, padding: 6, gap: 4 },
  previewCard:    { height: 10, borderRadius: 4, width: '100%' },
  previewTab:     { height: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  previewDot:     { width: 8, height: 8, borderRadius: 4 },
  themeInfo:      { padding: 10 },
  themeInfoTop:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3, flexWrap: 'wrap' },
  themeLabel:     { fontSize: 13, fontWeight: '700' },
  activeBadge:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, flexShrink: 0 },
  activeBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#fff' },
  themeSub:       { fontSize: 10, lineHeight: 14 },

  // Generic rows
  card: {
    borderRadius: 16, marginBottom: 20,
    shadowColor: '#F47B16', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, overflow: 'hidden',
  },
  divider: { height: 1, marginLeft: 56 },
  row:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 },
  iconWrap:{ width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  rowText: { flex: 1 },
  rowLabel:{ fontSize: 14, fontWeight: '600' },
  rowSub:  { fontSize: 12, marginTop: 1 },
  modalOverlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(15,23,42,0.48)' },
  modalCopy: { fontSize: 13, lineHeight: 20, marginBottom: 16 },
  modalLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  modalBtnTxt: { fontSize: 14, fontWeight: '700' },
  providerRoot: { flex: 1 },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'android' ? 26 : 54,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  providerCloseBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  providerHeaderText: { flex: 1 },
  providerTitle: { fontSize: 22, fontWeight: '900' },
  providerSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  providerContent: { padding: 16, paddingBottom: 42 },
  providerOptions: { gap: 10, marginBottom: 22 },
  providerSectionHelp: { fontSize: 12, lineHeight: 17, marginTop: -2, marginBottom: 12, paddingHorizontal: 4 },
  providerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  providerOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  providerOptionText: { flex: 1 },
  providerOptionTitle: { fontSize: 15, fontWeight: '800' },
  providerOptionSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  providerKeyCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  providerKeyCardFeatured: {
    borderWidth: 2,
    shadowColor: '#2DD4BF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
  },
  gatewayToggle: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  gatewayBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 13,
    paddingVertical: 10,
    alignItems: 'center',
  },
  gatewayBtnText: { fontSize: 12, fontWeight: '900' },
  providerKeyTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  providerKeyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  providerKeyBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  providerKeyBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  providerLinkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  providerLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  providerLinkText: { fontSize: 12, fontWeight: '800' },
  providerRefreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  debugMetaGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  debugMetaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  debugMetaPill: { flex: 1, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 9 },
  debugMetaPillSmall: { minWidth: 92, flexGrow: 1, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 9 },
  debugMetaLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  debugMetaValue: { fontSize: 15, fontWeight: '900', marginTop: 2 },
  debugProviderList: { gap: 8 },
  debugProviderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
  },
  debugStatusDot: { width: 10, height: 10, borderRadius: 5 },
  debugProviderName: { fontSize: 13, fontWeight: '800' },
  debugProviderSub: { fontSize: 11, marginTop: 2 },
  debugMono: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    fontSize: 11,
    lineHeight: 16,
  },
  notificationDebugActions: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 },
  notificationClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notificationClearText: { color: '#DC2626', fontSize: 12, fontWeight: '900' },
  hiddenDebugLegacy: { display: 'none' },
  statusModalCard: {
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 14,
    alignItems: 'center',
  },
  statusModalIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  statusModalTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  statusModalScroll: {
    width: '100%',
    maxHeight: 240,
    marginTop: 10,
    marginBottom: 18,
  },
  statusModalScrollContent: {
    paddingHorizontal: 2,
  },
  statusModalMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  statusModalActions: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  statusModalBtn: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
  },
  statusModalBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },

  // Update card
  updateCard: {
    borderRadius: 16, marginBottom: 20, padding: 16,
    borderWidth: 1,
    shadowColor: '#F47B16', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3,
  },
  updateTop:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  updateIconWrap:{ width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  updateTitle:   { fontSize: 15, fontWeight: '700' },
  updateSub:     { fontSize: 12, marginTop: 2 },
  newBadge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  newBadgeTxt:   { fontSize: 11, fontWeight: '800', color: '#fff' },
  updateActions: { flexDirection: 'row', gap: 10 },
  updateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16,
  },
  updateBtnTxt: { fontSize: 13, fontWeight: '700' },

  // Backup tiles
  backupRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  backupTile: {
    flex: 1, borderRadius: 16, padding: 18, alignItems: 'center', gap: 8,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  backupTileIcon: { width: 52, height: 52, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  backupTileLabel:{ fontSize: 14, fontWeight: '800' },
  backupTileSub:  { fontSize: 11, textAlign: 'center' },
});
