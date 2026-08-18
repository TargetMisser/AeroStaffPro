import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as SystemCalendar from 'expo-calendar';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { isOwnedShiftEvent } from '../utils/shiftCalendar';
import {
  A4_LANDSCAPE_PDF_SIZE,
  buildPrintableShiftCalendarHtml,
  printPrintableCalendarWithFallback,
  summarizePrintableShiftMonth,
  type PrintableShiftEvent,
} from '../utils/printableShiftCalendar';
import { RADIUS, SPACING } from '../theme/spacing';
import { TYPE, WEIGHT } from '../theme/typography';
import { devError, devWarn } from '../utils/devLog';
import {
  COMPENSATION_RULES_KEY,
  DEFAULT_COMPENSATION_RULES,
  buildCompensationCsv,
  buildCompensationReportHtml,
  normalizeCompensationRules,
  parseCompensationRules,
  summarizeCompensationMonth,
  type CompensationRules,
} from '../utils/shiftCompensation';

type CalendarLoadState = 'loading' | 'ready' | 'permission' | 'unavailable' | 'error';
type BusyAction = 'print' | 'share' | 'reportPdf' | 'reportCsv' | null;

type CompensationDraft = Record<keyof CompensationRules, string>;

function rulesToDraft(rules: CompensationRules): CompensationDraft {
  return {
    hourlyRate: String(rules.hourlyRate),
    nightBonusPercent: String(rules.nightBonusPercent),
    holidayBonusPercent: String(rules.holidayBonusPercent),
    overtimeBonusPercent: String(rules.overtimeBonusPercent),
    dailyOvertimeThresholdHours: String(rules.dailyOvertimeThresholdHours),
  };
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toLocalIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function PrintableCalendarScreen() {
  const { colors } = useAppTheme();
  const { t, months, weekDaysShort, locale } = useLanguage();
  const [month, setMonth] = useState(() => getMonthStart(new Date()));
  const [eventsByDate, setEventsByDate] = useState<Record<string, PrintableShiftEvent[]>>({});
  const [loadState, setLoadState] = useState<CalendarLoadState>('loading');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [compensationRules, setCompensationRules] = useState<CompensationRules>(DEFAULT_COMPENSATION_RULES);
  const [compensationDraft, setCompensationDraft] = useState<CompensationDraft>(() => rulesToDraft(DEFAULT_COMPENSATION_RULES));
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const mondayFirstWeekDays = useMemo(
    () => [...weekDaysShort.slice(1), weekDaysShort[0]],
    [weekDaysShort],
  );

  const loadMonth = useCallback(async () => {
    setLoadState('loading');
    try {
      const { status } = await SystemCalendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        setEventsByDate({});
        setLoadState('permission');
        return;
      }

      const calendars = await SystemCalendar.getCalendarsAsync(SystemCalendar.EntityTypes.EVENT);
      const calendar =
        calendars.find(item => item.allowsModifications && item.isPrimary)
        ?? calendars.find(item => item.allowsModifications);
      if (!calendar) {
        setEventsByDate({});
        setLoadState('unavailable');
        return;
      }

      const rangeStart = getMonthStart(month);
      const rangeEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      const events = await SystemCalendar.getEventsAsync([calendar.id], rangeStart, rangeEnd);
      const next: Record<string, PrintableShiftEvent[]> = {};
      for (const event of events) {
        if (!isOwnedShiftEvent(event)) continue;
        const iso = toLocalIso(new Date(event.startDate));
        next[iso] ??= [];
        next[iso].push({
          title: event.title,
          startDate: event.startDate,
          endDate: event.endDate,
          notes: event.notes,
        });
      }
      setEventsByDate(next);
      setLoadState('ready');
    } catch (error) {
      devError('[printableCalendar]', error);
      setEventsByDate({});
      setLoadState('error');
    }
  }, [month]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  useEffect(() => {
    AsyncStorage.getItem(COMPENSATION_RULES_KEY).then(raw => {
      const rules = parseCompensationRules(raw);
      setCompensationRules(rules);
      setCompensationDraft(rulesToDraft(rules));
    });
  }, []);

  const copy = useMemo(() => ({
    title: t('printCalTitle'),
    work: t('calTypeWork'),
    rest: t('calTypeRest'),
    noShift: t('printCalNoShift'),
    totalHours: t('printCalTotalHours'),
    workShifts: t('printCalWorkShifts'),
    restDays: t('printCalRestDays'),
    generatedBy: t('printCalGeneratedBy'),
  }), [t]);

  const html = useMemo(() => buildPrintableShiftCalendarHtml({
    month,
    eventsByDate,
    locale,
    monthNames: months,
    weekDaysMondayFirst: mondayFirstWeekDays,
    copy,
  }), [copy, eventsByDate, locale, mondayFirstWeekDays, month, months]);

  const summary = useMemo(
    () => summarizePrintableShiftMonth(month, eventsByDate),
    [eventsByDate, month],
  );

  const compensationSummary = useMemo(
    () => summarizeCompensationMonth(month, eventsByDate, compensationRules),
    [compensationRules, eventsByDate, month],
  );

  const monthLabel = `${months[month.getMonth()]} ${month.getFullYear()}`;
  const compensationHtml = useMemo(
    () => buildCompensationReportHtml(month, compensationSummary, compensationRules, locale, monthLabel),
    [compensationRules, compensationSummary, locale, month, monthLabel],
  );
  const previewCells = useMemo(() => {
    const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
    const leadingBlankDays = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - leadingBlankDays + 1;
      if (day < 1 || day > daysInMonth) return null;
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const events = eventsByDate[toLocalIso(date)] ?? [];
      const work = events.find(event => event.title.includes('Lavoro'));
      const rest = events.find(event => event.title.includes('Riposo'));
      return { day, work, rest };
    });
  }, [eventsByDate, month]);

  const changeMonth = (delta: number) => {
    setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const printCalendar = async () => {
    setBusyAction('print');
    try {
      const result = await printPrintableCalendarWithFallback(html, {
        createPdf: options => Print.printToFileAsync(options),
        printPdf: uri => Print.printAsync({
          uri,
          orientation: Print.Orientation.landscape,
        }),
        canSharePdf: Sharing.isAvailableAsync,
        sharePdf: uri => Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: `${t('printCalTitle')} - ${monthLabel}`,
        }),
      });
      if (result.mode === 'shared') {
        devWarn(
          '[printableCalendar.print] Native print unavailable; opened PDF fallback.',
          result.printError,
        );
      }
    } catch (error) {
      devError('[printableCalendar.print]', error);
      Alert.alert(t('error'), t('printCalPrintError'));
    } finally {
      setBusyAction(null);
    }
  };

  const shareCalendar = async () => {
    setBusyAction('share');
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(t('error'), t('printCalShareUnavailable'));
        return;
      }
      const { uri } = await Print.printToFileAsync({
        html,
        ...A4_LANDSCAPE_PDF_SIZE,
      });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: `${t('printCalTitle')} - ${monthLabel}`,
      });
    } catch (error) {
      devError('[printableCalendar.share]', error);
      Alert.alert(t('error'), t('printCalShareError'));
    } finally {
      setBusyAction(null);
    }
  };

  const saveCompensationRules = async () => {
    const rules = normalizeCompensationRules({
      hourlyRate: compensationDraft.hourlyRate.replace(',', '.'),
      nightBonusPercent: compensationDraft.nightBonusPercent.replace(',', '.'),
      holidayBonusPercent: compensationDraft.holidayBonusPercent.replace(',', '.'),
      overtimeBonusPercent: compensationDraft.overtimeBonusPercent.replace(',', '.'),
      dailyOvertimeThresholdHours: compensationDraft.dailyOvertimeThresholdHours.replace(',', '.'),
    });
    setCompensationRules(rules);
    setCompensationDraft(rulesToDraft(rules));
    await AsyncStorage.setItem(COMPENSATION_RULES_KEY, JSON.stringify(rules));
    Alert.alert('Regole salvate', 'Il consuntivo è stato ricalcolato.');
  };

  const shareCompensationPdf = async () => {
    setBusyAction('reportPdf');
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t('error'), t('printCalShareUnavailable'));
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: compensationHtml });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: `Consuntivo turni - ${monthLabel}`,
      });
    } catch (error) {
      devError('[compensation.pdf]', error);
      Alert.alert(t('error'), 'Non sono riuscito a creare il consuntivo PDF.');
    } finally {
      setBusyAction(null);
    }
  };

  const shareCompensationCsv = async () => {
    setBusyAction('reportCsv');
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t('error'), t('printCalShareUnavailable'));
        return;
      }
      if (!FileSystem.cacheDirectory) throw new Error('CACHE_DIRECTORY_UNAVAILABLE');
      const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
      const uri = `${FileSystem.cacheDirectory}AeroStaffPro-consuntivo-${monthKey}.csv`;
      const csv = buildCompensationCsv(month, compensationSummary, compensationRules, locale);
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
        dialogTitle: `Consuntivo turni - ${monthLabel}`,
      });
    } catch (error) {
      devError('[compensation.csv]', error);
      Alert.alert(t('error'), 'Non sono riuscito a creare il consuntivo CSV.');
    } finally {
      setBusyAction(null);
    }
  };

  const actionDisabled = loadState !== 'ready' || busyAction !== null;
  const compensationFields: Array<{ key: keyof CompensationRules; label: string; suffix: string }> = [
    { key: 'hourlyRate', label: 'Paga oraria', suffix: 'EUR' },
    { key: 'nightBonusPercent', label: 'Maggiorazione notte', suffix: '%' },
    { key: 'holidayBonusPercent', label: 'Maggiorazione festivi', suffix: '%' },
    { key: 'overtimeBonusPercent', label: 'Maggiorazione extra', suffix: '%' },
    { key: 'dailyOvertimeThresholdHours', label: 'Soglia straordinario', suffix: 'h/g' },
  ];

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <MaterialIcons name="print" size={24} color={colors.primary} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.title}>{t('printCalTitle')}</Text>
          <Text style={styles.subtitle}>{t('printCalSubtitle')}</Text>
        </View>
      </View>

      <View style={styles.monthCard}>
        <TouchableOpacity
          style={styles.monthButton}
          onPress={() => changeMonth(-1)}
          accessibilityRole="button"
          accessibilityLabel={t('printCalPreviousMonth')}
        >
          <MaterialIcons name="chevron-left" size={26} color={colors.primaryText} />
        </TouchableOpacity>
        <View style={styles.monthCopy}>
          <Text style={styles.monthEyebrow}>{t('printCalMonth')}</Text>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
        </View>
        <TouchableOpacity
          style={styles.monthButton}
          onPress={() => changeMonth(1)}
          accessibilityRole="button"
          accessibilityLabel={t('printCalNextMonth')}
        >
          <MaterialIcons name="chevron-right" size={26} color={colors.primaryText} />
        </TouchableOpacity>
      </View>

      {loadState === 'loading' ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.stateText}>{t('printCalLoading')}</Text>
        </View>
      ) : loadState === 'permission' ? (
        <View style={styles.stateCard}>
          <MaterialIcons name="event-busy" size={28} color={colors.warning} />
          <Text style={styles.stateTitle}>{t('calPermDenied')}</Text>
          <Text style={styles.stateText}>{t('calPermSettingsHint')}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => Linking.openSettings()}>
            <Text style={styles.secondaryButtonText}>{t('calOpenSettings')}</Text>
          </TouchableOpacity>
        </View>
      ) : loadState === 'unavailable' ? (
        <View style={styles.stateCard}>
          <MaterialIcons name="event-busy" size={28} color={colors.warning} />
          <Text style={styles.stateTitle}>{t('printCalNoCalendar')}</Text>
          <Text style={styles.stateText}>{t('calNoWritableCalendar')}</Text>
        </View>
      ) : loadState === 'error' ? (
        <View style={styles.stateCard}>
          <MaterialIcons name="error-outline" size={28} color={colors.danger} />
          <Text style={styles.stateTitle}>{t('printCalLoadError')}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={loadMonth}>
            <Text style={styles.secondaryButtonText}>{t('a11yRefresh')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{(summary.totalMinutes / 60).toFixed(1)} h</Text>
              <Text style={styles.summaryLabel}>{t('printCalTotalHours')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{summary.workShifts}</Text>
              <Text style={styles.summaryLabel}>{t('printCalWorkShifts')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{summary.restDays}</Text>
              <Text style={styles.summaryLabel}>{t('printCalRestDays')}</Text>
            </View>
          </View>

          <View style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <View>
                <Text style={styles.previewEyebrow}>{t('printCalPreview')}</Text>
                <Text style={styles.previewTitle}>{t('printCalA4Landscape')}</Text>
              </View>
              <MaterialIcons name="picture-as-pdf" size={24} color={colors.primary} />
            </View>
            <View style={styles.weekHeader}>
              {mondayFirstWeekDays.map(day => (
                <Text key={day} style={styles.weekHeaderText}>{day.slice(0, 2)}</Text>
              ))}
            </View>
            <View style={styles.previewGrid}>
              {previewCells.map((cell, index) => (
                <View
                  key={index}
                  style={[
                    styles.previewDay,
                    cell?.work && styles.previewWorkDay,
                    cell?.rest && styles.previewRestDay,
                  ]}
                >
                  {cell && (
                    <>
                      <Text style={styles.previewDayNumber}>{cell.day}</Text>
                      <View
                        style={[
                          styles.previewShiftMark,
                          cell.rest && styles.previewRestMark,
                        ]}
                      />
                    </>
                  )}
                </View>
              ))}
            </View>
            {summary.workShifts === 0 && summary.restDays === 0 && (
              <Text style={styles.emptyHint}>{t('printCalEmptyMonth')}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, actionDisabled && styles.buttonDisabled]}
            disabled={actionDisabled}
            onPress={printCalendar}
            activeOpacity={0.85}
          >
            {busyAction === 'print' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <MaterialIcons name="print" size={20} color="#fff" />
            )}
            <Text style={styles.primaryButtonText}>{t('printCalPrint')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shareButton, actionDisabled && styles.buttonDisabled]}
            disabled={actionDisabled}
            onPress={shareCalendar}
            activeOpacity={0.85}
          >
            {busyAction === 'share' ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <MaterialIcons name="picture-as-pdf" size={20} color={colors.primaryText} />
            )}
            <Text style={styles.shareButtonText}>{t('printCalShare')}</Text>
          </TouchableOpacity>

          <Text style={styles.privacyHint}>{t('printCalPrivacyHint')}</Text>

          <View style={styles.reportSection}>
            <View style={styles.reportHeader}>
              <View style={[styles.heroIcon, { width: 42, height: 42 }]}>
                <MaterialIcons name="payments" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>Consuntivo ore e indennità</Text>
                <Text style={styles.reportSubtitle}>Stima configurabile, esportabile in PDF o CSV</Text>
              </View>
            </View>

            <View style={styles.estimateCard}>
              <Text style={styles.estimateEyebrow}>STIMA DEL MESE</Text>
              <Text style={styles.estimateValue}>
                {compensationSummary.estimatedAmount.toLocaleString(locale, { style: 'currency', currency: 'EUR' })}
              </Text>
              <Text style={styles.estimateMeta}>{(compensationSummary.totalMinutes / 60).toFixed(1)} ore · {compensationSummary.shifts.length} turni</Text>
            </View>

            <View style={styles.compSummaryGrid}>
              {[
                ['Notturne', compensationSummary.nightMinutes],
                ['Festive', compensationSummary.holidayMinutes],
                ['Straordinario', compensationSummary.overtimeMinutes],
              ].map(([label, minutes]) => (
                <View key={String(label)} style={styles.compSummaryCard}>
                  <Text style={styles.compSummaryValue}>{(Number(minutes) / 60).toFixed(1)} h</Text>
                  <Text style={styles.compSummaryLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.rulesTitle}>REGOLE DI CALCOLO</Text>
            <View style={styles.rulesGrid}>
              {compensationFields.map(field => (
                <View key={field.key} style={styles.ruleField}>
                  <Text style={styles.ruleLabel}>{field.label}</Text>
                  <View style={styles.ruleInputRow}>
                    <TextInput
                      value={compensationDraft[field.key]}
                      onChangeText={value => setCompensationDraft(current => ({ ...current, [field.key]: value }))}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      style={styles.ruleInput}
                    />
                    <Text style={styles.ruleSuffix}>{field.suffix}</Text>
                  </View>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.saveRulesButton} onPress={saveCompensationRules}>
              <MaterialIcons name="save" size={18} color={colors.primaryText} />
              <Text style={styles.saveRulesText}>Salva e ricalcola</Text>
            </TouchableOpacity>

            <View style={styles.reportActions}>
              <TouchableOpacity
                style={[styles.reportActionButton, actionDisabled && styles.buttonDisabled]}
                disabled={actionDisabled}
                onPress={shareCompensationPdf}
              >
                {busyAction === 'reportPdf' ? <ActivityIndicator color="#fff" /> : <MaterialIcons name="picture-as-pdf" size={19} color="#fff" />}
                <Text style={styles.reportActionPrimaryText}>PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportActionButton, styles.reportActionSecondary, actionDisabled && styles.buttonDisabled]}
                disabled={actionDisabled}
                onPress={shareCompensationCsv}
              >
                {busyAction === 'reportCsv' ? <ActivityIndicator color={colors.primaryText} /> : <MaterialIcons name="table-view" size={19} color={colors.primaryText} />}
                <Text style={styles.reportActionSecondaryText}>CSV</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.reportDisclaimer}>Stima personale: non sostituisce busta paga, contratto o conteggio aziendale.</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1 },
    content: { padding: SPACING.lg, paddingBottom: 110 },
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.md,
      marginBottom: SPACING.lg,
    },
    heroIcon: {
      width: 48,
      height: 48,
      borderRadius: RADIUS.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryLight,
    },
    heroCopy: { flex: 1 },
    title: { ...TYPE.title, color: colors.text },
    subtitle: { ...TYPE.callout, color: colors.textSub, marginTop: 3 },
    monthCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: SPACING.sm,
      marginBottom: SPACING.md,
      borderRadius: RADIUS.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    monthButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADIUS.md,
      backgroundColor: colors.primaryLight,
    },
    monthCopy: { alignItems: 'center' },
    monthEyebrow: { ...TYPE.overline, color: colors.textMuted },
    monthLabel: { ...TYPE.headline, color: colors.text, marginTop: 2, textTransform: 'capitalize' },
    stateCard: {
      minHeight: 170,
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.sm,
      padding: SPACING.xl,
      borderRadius: RADIUS.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    stateTitle: { ...TYPE.subhead, color: colors.text, textAlign: 'center' },
    stateText: { ...TYPE.callout, color: colors.textSub, textAlign: 'center' },
    secondaryButton: {
      marginTop: SPACING.sm,
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: colors.primaryLight,
    },
    secondaryButtonText: { ...TYPE.callout, color: colors.primaryText, fontWeight: WEIGHT.semibold },
    summaryRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
    summaryCard: {
      flex: 1,
      minHeight: 78,
      justifyContent: 'center',
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    summaryValue: { ...TYPE.headline, color: colors.primaryText },
    summaryLabel: { ...TYPE.micro, color: colors.textSub, marginTop: 4, textTransform: 'uppercase' },
    previewCard: {
      padding: SPACING.md,
      marginBottom: SPACING.lg,
      borderRadius: RADIUS.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: SPACING.md,
    },
    previewEyebrow: { ...TYPE.overline, color: colors.textMuted },
    previewTitle: { ...TYPE.callout, color: colors.text, marginTop: 2 },
    weekHeader: { flexDirection: 'row', backgroundColor: colors.text, borderRadius: RADIUS.sm },
    weekHeaderText: {
      width: `${100 / 7}%`,
      paddingVertical: 6,
      color: colors.bg,
      fontSize: 9,
      fontWeight: WEIGHT.bold,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    previewGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
    previewDay: {
      width: `${100 / 7}%`,
      aspectRatio: 1,
      padding: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.cardSecondary,
    },
    previewWorkDay: { backgroundColor: colors.primaryLight },
    previewRestDay: { backgroundColor: colors.successSoft },
    previewDayNumber: { fontSize: 9, fontWeight: WEIGHT.semibold, color: colors.text },
    previewShiftMark: {
      width: 10,
      height: 3,
      marginTop: 4,
      borderRadius: RADIUS.pill,
      backgroundColor: colors.primary,
    },
    previewRestMark: { backgroundColor: colors.success },
    emptyHint: { ...TYPE.caption, color: colors.textMuted, textAlign: 'center', marginTop: SPACING.md },
    primaryButton: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: colors.primary,
    },
    primaryButtonText: { ...TYPE.subhead, color: '#fff' },
    shareButton: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.sm,
      marginTop: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: colors.primaryLight,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    shareButtonText: { ...TYPE.subhead, color: colors.primaryText },
    buttonDisabled: { opacity: 0.55 },
    privacyHint: { ...TYPE.caption, color: colors.textMuted, textAlign: 'center', marginTop: SPACING.md },
    reportSection: { marginTop: SPACING.xxl, paddingTop: SPACING.xl, borderTopWidth: 1, borderTopColor: colors.border },
    reportHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.md },
    reportTitle: { ...TYPE.headline, color: colors.text },
    reportSubtitle: { ...TYPE.caption, color: colors.textSub, marginTop: 2 },
    estimateCard: { padding: SPACING.lg, borderRadius: RADIUS.lg, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.primary },
    estimateEyebrow: { ...TYPE.overline, color: colors.primaryText },
    estimateValue: { color: colors.primaryText, fontSize: 30, fontWeight: WEIGHT.bold, marginTop: 3 },
    estimateMeta: { ...TYPE.caption, color: colors.textSub, marginTop: 3 },
    compSummaryGrid: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
    compSummaryCard: { flex: 1, minHeight: 70, justifyContent: 'center', padding: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    compSummaryValue: { ...TYPE.subhead, color: colors.text },
    compSummaryLabel: { ...TYPE.micro, color: colors.textMuted, marginTop: 3, textTransform: 'uppercase' },
    rulesTitle: { ...TYPE.overline, color: colors.textMuted, marginTop: SPACING.lg, marginBottom: SPACING.sm },
    rulesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
    ruleField: { width: '48%', padding: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    ruleLabel: { ...TYPE.micro, color: colors.textSub, minHeight: 28 },
    ruleInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    ruleInput: { flex: 1, minHeight: 36, color: colors.text, fontSize: 17, fontWeight: WEIGHT.semibold, paddingVertical: 0 },
    ruleSuffix: { ...TYPE.caption, color: colors.textMuted },
    saveRulesButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.primaryLight },
    saveRulesText: { ...TYPE.callout, color: colors.primaryText, fontWeight: WEIGHT.semibold },
    reportActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
    reportActionButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.primary },
    reportActionSecondary: { backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.primary },
    reportActionPrimaryText: { ...TYPE.subhead, color: '#fff' },
    reportActionSecondaryText: { ...TYPE.subhead, color: colors.primaryText },
    reportDisclaimer: { ...TYPE.micro, color: colors.textMuted, textAlign: 'center', marginTop: SPACING.sm, lineHeight: 16 },
  });
}
